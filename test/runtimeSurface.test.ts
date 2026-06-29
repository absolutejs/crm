import { describe, expect, test } from "bun:test";
import {
  createInMemoryCRMLocalEntityStore,
  createInMemoryCRMTokenStore,
} from "../src/stores";
import { createInMemoryCRMSyncQueue } from "../src/sync";
import { createCRMRuntime } from "../src/runtime";
import { createRecordingCRMAdapter } from "./helpers/recordingCRMAdapter";

const setup = (
  capabilities: Parameters<typeof createRecordingCRMAdapter>[1] = {},
) => {
  const { adapter, calls } = createRecordingCRMAdapter("hubspot", capabilities);
  const tokenStore = createInMemoryCRMTokenStore();
  const localEntityStore = createInMemoryCRMLocalEntityStore();
  const syncQueue = createInMemoryCRMSyncQueue({ now: () => 1_000 });
  const runtime = createCRMRuntime({
    adapters: { hubspot: () => adapter },
    localEntityStore,
    now: () => 1_000,
    syncQueue,
    tokenStore,
  });
  return { adapter, calls, localEntityStore, runtime, syncQueue };
};

const seed = async (runtime: ReturnType<typeof createCRMRuntime>) => {
  await runtime.tokenStore.put({
    accessToken: "tkn",
    createdAt: 0,
    updatedAt: 0,
    userId: "u",
    vendor: "hubspot",
  });
};

describe("createCRMRuntime widened surface", () => {
  test("read verbs delegate to the adapter", async () => {
    const { runtime, calls } = setup();
    await seed(runtime);
    expect((await runtime.getContact("u", "hubspot", "c_1"))?.id).toBe("c_1");
    expect((await runtime.listContacts("u", "hubspot")).items).toHaveLength(1);
    expect(await runtime.searchContacts("u", "hubspot", "ax")).toHaveLength(1);
    expect((await runtime.getDeal("u", "hubspot", "d_1"))?.id).toBe("d_1");
    expect(await runtime.listPipelines("u", "hubspot")).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual([
      "getContact",
      "listContacts",
      "searchContacts",
      "getDeal",
      "listPipelines",
    ]);
  });

  test("updateContact delegates and mirrors into the local store", async () => {
    const { runtime, calls, localEntityStore } = setup();
    await seed(runtime);
    const updated = await runtime.updateContact("u", "hubspot", "c_1", {
      firstName: "Renamed",
    });
    expect(updated.firstName).toBe("Renamed");
    expect(calls[0]?.method).toBe("updateContact");
    const stored = await localEntityStore.get("hubspot", "contact", "c_1");
    expect(stored?.origin).toBe("app");
    expect(stored?.data.firstName).toBe("Renamed");
  });

  test("deleteDeal delegates and removes the local mirror", async () => {
    const { runtime, calls, localEntityStore } = setup();
    await seed(runtime);
    await localEntityStore.put({
      data: { title: "x" },
      entityId: "d_1",
      entityType: "deal",
      localUpdatedAt: 0,
      origin: "app",
      vendor: "hubspot",
    });
    await runtime.deleteDeal("u", "hubspot", "d_1");
    expect(calls[0]?.method).toBe("deleteDeal");
    expect(await localEntityStore.get("hubspot", "deal", "d_1")).toBeNull();
  });

  test("createAccount + logActivity write through to the local store", async () => {
    const { runtime, localEntityStore } = setup();
    await seed(runtime);
    const acct = await runtime.createAccount("u", "hubspot", { name: "Acme" });
    expect(acct.id).toBe("acct_1");
    expect(await localEntityStore.get("hubspot", "account", "acct_1")).not.toBeNull();
    const act = await runtime.logActivity("u", "hubspot", {
      occurredAt: 0,
      type: "call",
    });
    expect(act.id).toBe("activity_1");
    expect(await localEntityStore.get("hubspot", "activity", "activity_1")).not.toBeNull();
  });

  test("convertLead delegates when supported and throws when adapter lacks it", async () => {
    const supported = setup();
    await seed(supported.runtime);
    const out = await supported.runtime.convertLead("u", "hubspot", "l_1");
    expect(out.contact.id).toBe("c_conv");
    expect(supported.calls.some((c) => c.method === "convertLead")).toBe(true);

    const { adapter } = createRecordingCRMAdapter("hubspot");
    const tokenStore = createInMemoryCRMTokenStore();
    await tokenStore.put({
      accessToken: "tkn",
      createdAt: 0,
      updatedAt: 0,
      userId: "u",
      vendor: "hubspot",
    });
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => ({ ...adapter, convertLead: undefined }) },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore,
    });
    await expect(
      runtime.convertLead("u", "hubspot", "l_2"),
    ).rejects.toThrow(/does not support lead conversion/);
  });

  test("processOutboundJobs drains the queue end-to-end through the runtime", async () => {
    const { runtime, calls, syncQueue } = setup();
    await seed(runtime);
    await runtime.enqueueOutboundCreate("u", "hubspot", {
      emails: [{ address: "x@y.com" }],
      firstName: "Queued",
      phones: [],
    });
    const results = await runtime.processOutboundJobs();
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe("completed");
    expect(calls.map((c) => c.method)).toContain("createContact");
    expect(await syncQueue.list({ status: "pending" })).toHaveLength(0);
  });

  test("enqueueOutboundUpdate / Delete / LogActivity enqueue the right kinds", async () => {
    const { runtime, syncQueue } = setup();
    await seed(runtime);
    await runtime.enqueueOutboundUpdate("u", "hubspot", {
      entity: { firstName: "Patched", id: "c_1" },
      entityType: "contact",
    });
    await runtime.enqueueOutboundDelete("u", "hubspot", "deal", "d_1");
    await runtime.enqueueOutboundLogActivity("u", "hubspot", {
      occurredAt: 0,
      type: "email",
    });
    const kinds = (await syncQueue.list()).map((j) => j.kind).sort();
    expect(kinds).toEqual([
      "outbound.delete",
      "outbound.log-activity",
      "outbound.update",
    ]);
  });
});
