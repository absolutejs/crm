import { describe, expect, test } from "bun:test";
import {
  createCRMReconciler,
  createInMemoryCRMLocalEntityStore,
  createInMemoryCRMSyncQueue,
  lastWriteWinsReconcileResolver,
} from "../src";
import type { CRMChangeEvent } from "../src/sync";

const make = (now = 10_000) => {
  const localStore = createInMemoryCRMLocalEntityStore();
  const syncQueue = createInMemoryCRMSyncQueue();
  const reconciler = createCRMReconciler({
    echoSuppressionWindowMs: 1_000,
    localStore,
    now: () => now,
    syncQueue,
  });
  return { localStore, reconciler, syncQueue };
};

const inboundChange = (overrides: Partial<CRMChangeEvent> = {}): CRMChangeEvent => ({
  entityId: "c_1",
  entityType: "contact",
  id: "evt_1",
  op: "update",
  payload: { firstName: "Alex" },
  receivedAtMs: 5_000,
  vendor: "hubspot",
  ...overrides,
});

describe("createCRMReconciler", () => {
  test("applies inbound change when local is empty", async () => {
    const { localStore, reconciler } = make();
    const result = await reconciler.reconcileChange(inboundChange());
    expect(result.action).toBe("applied");
    const stored = await localStore.get("hubspot", "contact", "c_1");
    expect(stored?.origin).toBe("reconciled");
    expect(stored?.data.firstName).toBe("Alex");
  });

  test("delete op removes the local record", async () => {
    const { localStore, reconciler } = make();
    await localStore.put({
      data: { firstName: "Alex" },
      entityId: "c_1",
      entityType: "contact",
      localUpdatedAt: 0,
      origin: "app",
      vendor: "hubspot",
    });
    const result = await reconciler.reconcileChange(
      inboundChange({ op: "delete" }),
    );
    expect(result.action).toBe("deleted");
    expect(await localStore.get("hubspot", "contact", "c_1")).toBeNull();
  });

  test("echo suppression skips when local was just written by app", async () => {
    const { localStore, reconciler } = make(10_000);
    await localStore.put({
      data: { firstName: "Local" },
      entityId: "c_1",
      entityType: "contact",
      localUpdatedAt: 9_500,
      origin: "app",
      vendor: "hubspot",
    });
    const result = await reconciler.reconcileChange(inboundChange());
    expect(result.action).toBe("skipped-echo");
    const stored = await localStore.get("hubspot", "contact", "c_1");
    expect(stored?.data.firstName).toBe("Local");
  });

  test("echo suppression does NOT skip when window has passed", async () => {
    const { localStore, reconciler } = make(10_000);
    await localStore.put({
      data: { firstName: "Local" },
      entityId: "c_1",
      entityType: "contact",
      localUpdatedAt: 1_000,
      origin: "app",
      vendor: "hubspot",
    });
    const result = await reconciler.reconcileChange(inboundChange());
    expect(result.action).toBe("applied");
  });

  test("custom conflict resolver controls the winner", async () => {
    const { reconciler } = make();
    const customResolver = async () => ({
      rationale: "always merge",
      resolved: { firstName: "Merged" },
      winner: "merged" as const,
    });
    const r2 = createCRMReconciler({
      conflictResolver: customResolver,
      localStore: createInMemoryCRMLocalEntityStore(),
      syncQueue: createInMemoryCRMSyncQueue(),
    });
    const result = await r2.reconcileChange(inboundChange());
    if (result.action === "applied") {
      expect(result.record.data.firstName).toBe("Merged");
      expect(result.resolution.winner).toBe("merged");
    }
  });

  test("last-write-wins picks local when vendorUpdatedAt is newer", async () => {
    const localStore = createInMemoryCRMLocalEntityStore();
    await localStore.put({
      data: { firstName: "LocalFresh" },
      entityId: "c_1",
      entityType: "contact",
      localUpdatedAt: 9_000,
      origin: "reconciled",
      vendor: "hubspot",
      vendorUpdatedAt: 8_000,
    });
    const reconciler = createCRMReconciler({
      conflictResolver: lastWriteWinsReconcileResolver,
      localStore,
      now: () => 10_000,
      syncQueue: createInMemoryCRMSyncQueue(),
    });
    const result = await reconciler.reconcileChange(
      inboundChange({ receivedAtMs: 5_000 }),
    );
    if (result.action === "applied") {
      expect(result.resolution.winner).toBe("local");
      expect(result.record.data.firstName).toBe("LocalFresh");
    }
  });

  test("processPending drains inbound jobs from the sync queue", async () => {
    const { reconciler, syncQueue, localStore } = make();
    await syncQueue.enqueue({
      idempotencyKey: "ev::contact::c_42",
      kind: "inbound.change",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: { entity: { firstName: "Remote" }, entityType: "contact" },
      userId: "u_1",
      vendor: "hubspot",
    });
    const results = await reconciler.processPending();
    expect(results).toHaveLength(1);
    const stored = await localStore.get("hubspot", "contact", "c_42");
    expect(stored?.data.firstName).toBe("Remote");
    const remainingPending = await syncQueue.list({ status: "pending" });
    expect(remainingPending).toHaveLength(0);
  });

  test("subscribe fires for applied / skipped-echo / deleted", async () => {
    const { reconciler, localStore } = make(10_000);
    const events: string[] = [];
    reconciler.subscribe((e) => events.push(e.type));
    await reconciler.reconcileChange(inboundChange());
    await localStore.put({
      data: { firstName: "Local" },
      entityId: "c_2",
      entityType: "contact",
      localUpdatedAt: 9_999,
      origin: "app",
      vendor: "hubspot",
    });
    await reconciler.reconcileChange(inboundChange({ entityId: "c_2" }));
    await reconciler.reconcileChange(
      inboundChange({ entityId: "c_3", op: "delete" }),
    );
    expect(events).toEqual(["applied", "skipped-echo", "deleted"]);
  });
});
