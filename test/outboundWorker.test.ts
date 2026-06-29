import { describe, expect, test } from "bun:test";
import {
  createCRMOutboundWorker,
  createInMemoryCRMSyncQueue,
  type CRMOutboundLocalMirror,
} from "../src/sync";
import { createRecordingCRMAdapter } from "./helpers/recordingCRMAdapter";

const make = (
  capabilities: Parameters<typeof createRecordingCRMAdapter>[1] = {},
) => {
  const { adapter, calls } = createRecordingCRMAdapter("hubspot", capabilities);
  const syncQueue = createInMemoryCRMSyncQueue({ now: () => 1_000 });
  const mirrors: CRMOutboundLocalMirror[] = [];
  const worker = createCRMOutboundWorker({
    mirrorLocalEntity: (m) => {
      mirrors.push(m);
    },
    now: () => 1_000,
    resolveAdapter: async () => adapter,
    syncQueue,
  });
  return { adapter, calls, mirrors, syncQueue, worker };
};

describe("createCRMOutboundWorker", () => {
  test("drains outbound.create → calls createContact → marks completed", async () => {
    const { calls, mirrors, syncQueue, worker } = make();
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::contact::a",
      kind: "outbound.create",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: {
        entity: { emails: [{ address: "a@b.com" }], firstName: "Alex", phones: [] },
        entityType: "contact",
      },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe("completed");
    expect(calls.map((c) => c.method)).toEqual(["createContact"]);

    const completed = await syncQueue.list({ status: "completed" });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.resultEntityId).toBe("contact_1");
    expect(await syncQueue.list({ status: "pending" })).toHaveLength(0);

    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({
      entityId: "contact_1",
      entityType: "contact",
      op: "put",
      vendor: "hubspot",
    });
  });

  test("outbound.update routes to updateDeal with stripped id/vendor patch", async () => {
    const { calls, syncQueue, worker } = make();
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::deal::update::d_1",
      kind: "outbound.update",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: {
        entity: { amount: 500, id: "d_1", title: "Renewal", vendor: "hubspot" },
        entityType: "deal",
      },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results[0]?.action).toBe("completed");
    expect(calls[0]?.method).toBe("updateDeal");
    expect(calls[0]?.args[0]).toBe("d_1");
    expect(calls[0]?.args[1]).toEqual({ amount: 500, title: "Renewal" });
  });

  test("outbound.delete calls deleteContact and emits a remove mirror", async () => {
    const { calls, mirrors, syncQueue, worker } = make();
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::contact::delete::c_9",
      kind: "outbound.delete",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: { entity: { id: "c_9" }, entityType: "contact" },
      userId: "u",
      vendor: "hubspot",
    });

    await worker.processPending();
    expect(calls).toEqual([{ args: ["c_9"], method: "deleteContact" }]);
    expect(mirrors[0]).toEqual({
      entityId: "c_9",
      entityType: "contact",
      op: "remove",
      vendor: "hubspot",
    });
  });

  test("outbound.log-activity routes to logActivity", async () => {
    const { calls, syncQueue, worker } = make();
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::activity::1",
      kind: "outbound.log-activity",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: {
        entity: { occurredAt: 5, subject: "Call", type: "call" },
        entityType: "activity",
      },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results[0]?.action).toBe("completed");
    expect(calls[0]?.method).toBe("logActivity");
  });

  test("respects capabilities: skips delete when supportsDelete is false", async () => {
    const { calls, syncQueue, worker } = make({ supportsDelete: false });
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::contact::delete::c_1",
      kind: "outbound.delete",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: { entity: { id: "c_1" }, entityType: "contact" },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results[0]?.action).toBe("skipped-unsupported");
    expect(calls).toHaveLength(0);
    // skipped jobs still leave the queue (marked completed).
    expect(await syncQueue.list({ status: "completed" })).toHaveLength(1);
  });

  test("retries on adapter error via markFailed (stays pending until exhausted)", async () => {
    const syncQueue = createInMemoryCRMSyncQueue({
      now: () => 1_000,
      retryBackoffMs: 100,
    });
    const worker = createCRMOutboundWorker({
      now: () => 1_000,
      resolveAdapter: async () => {
        throw new Error("token expired");
      },
      syncQueue,
    });
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::contact::a",
      kind: "outbound.create",
      maxAttempts: 2,
      notBeforeMs: 0,
      payload: { entity: { emails: [], phones: [] }, entityType: "contact" },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results[0]?.action).toBe("failed");
    const pending = await syncQueue.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastError).toBe("token expired");
  });

  test("does not steal inbound.change jobs (coexists with reconciler)", async () => {
    const { calls, syncQueue, worker } = make();
    await syncQueue.enqueue({
      idempotencyKey: "inbound::contact::c_1",
      kind: "inbound.change",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: { entity: { firstName: "Remote" }, entityType: "contact" },
      userId: "u",
      vendor: "hubspot",
    });
    await syncQueue.enqueue({
      idempotencyKey: "u::hubspot::contact::a",
      kind: "outbound.create",
      maxAttempts: 3,
      notBeforeMs: 0,
      payload: { entity: { emails: [], phones: [] }, entityType: "contact" },
      userId: "u",
      vendor: "hubspot",
    });

    const results = await worker.processPending();
    expect(results).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["createContact"]);

    const pending = await syncQueue.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe("inbound.change");
  });
});
