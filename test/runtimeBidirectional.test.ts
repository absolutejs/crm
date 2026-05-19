import { describe, expect, test } from "bun:test";
import {
  createCRMRuntime,
  createInMemoryCRMLocalEntityStore,
  createInMemoryCRMSyncQueue,
  createInMemoryCRMTokenStore,
} from "../src";
import type { CRMAdapter } from "../src";

const stubHubspot: CRMAdapter = {
  capabilities: {
    preferredIdField: "id",
    supportsBulkUpsert: false,
    supportsCustomFields: false,
    supportsLeads: true,
    supportsPipelines: true,
    supportsWebhooks: true,
    syncDirection: "bidirectional",
  },
  addNote: async () => ({ body: "x", id: "n", vendor: "hubspot" }),
  createContact: async (i) => ({ ...i, id: "c_99", vendor: "hubspot" }),
  createDeal: async (i) => ({ ...i, id: "d_99", vendor: "hubspot" }),
  createLead: async (i) => ({ ...i, id: "l_99", vendor: "hubspot" }),
  createTask: async (i) => ({ ...i, id: "t_99", vendor: "hubspot" }),
  getContact: async () => null,
  listPipelines: async () => [],
  logActivity: async (i) => ({ ...i, id: "a_99", vendor: "hubspot" }),
  lookupContactByEmail: async () => null,
  lookupContactByPhone: async () => null,
  searchContacts: async () => [],
  updateContact: async (id) => ({
    emails: [],
    id,
    phones: [],
    vendor: "hubspot",
  }),
  updateDeal: async (id, p) => ({
    id,
    title: p.title ?? "",
    vendor: "hubspot",
  }),
  vendor: "hubspot",
};

const seedToken = async () => {
  const tokenStore = createInMemoryCRMTokenStore();
  await tokenStore.put({
    accessToken: "tkn",
    createdAt: 0,
    updatedAt: 0,
    userId: "u_1",
    vendor: "hubspot",
  });
  return tokenStore;
};

describe("createCRMRuntime — bidirectional mode", () => {
  test("isBidirectional flips when localEntityStore is provided", async () => {
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => stubHubspot },
      localEntityStore: createInMemoryCRMLocalEntityStore(),
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seedToken(),
    });
    expect(runtime.isBidirectional).toBe(true);
  });

  test("createContact writes the result to the local entity store with origin=app", async () => {
    const localEntityStore = createInMemoryCRMLocalEntityStore();
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => stubHubspot },
      localEntityStore,
      now: () => 1_000,
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seedToken(),
    });
    await runtime.createContact("u_1", "hubspot", {
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      phones: [],
    });
    const stored = await localEntityStore.get("hubspot", "contact", "c_99");
    expect(stored?.origin).toBe("app");
    expect(stored?.data.firstName).toBe("Alex");
    expect(stored?.localUpdatedAt).toBe(1_000);
  });

  test("recordInboundChange triggers immediate reconciliation when bidirectional", async () => {
    const localEntityStore = createInMemoryCRMLocalEntityStore();
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => stubHubspot },
      localEntityStore,
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seedToken(),
    });
    await runtime.recordInboundChange({
      entityId: "c_42",
      entityType: "contact",
      id: "evt_1",
      op: "update",
      payload: { firstName: "Remote" },
      receivedAtMs: 1_500,
      vendor: "hubspot",
    });
    const stored = await localEntityStore.get("hubspot", "contact", "c_42");
    expect(stored?.origin).toBe("reconciled");
    expect(stored?.data.firstName).toBe("Remote");
  });

  test("echo suppression: inbound for own recent write is skipped", async () => {
    const localEntityStore = createInMemoryCRMLocalEntityStore();
    let t = 1_000;
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => stubHubspot },
      echoSuppressionWindowMs: 5_000,
      localEntityStore,
      now: () => t,
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seedToken(),
    });
    await runtime.createContact("u_1", "hubspot", {
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      phones: [],
    });
    t = 2_000;
    await runtime.recordInboundChange({
      entityId: "c_99",
      entityType: "contact",
      id: "evt_1",
      op: "update",
      payload: { firstName: "WebhookEcho" },
      receivedAtMs: 1_900,
      vendor: "hubspot",
    });
    const stored = await localEntityStore.get("hubspot", "contact", "c_99");
    expect(stored?.origin).toBe("app");
    expect(stored?.data.firstName).toBe("Alex");
  });

  test("processInboundChanges throws when localEntityStore is missing", async () => {
    const runtime = createCRMRuntime({
      adapters: { hubspot: () => stubHubspot },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seedToken(),
    });
    expect(runtime.isBidirectional).toBe(false);
    await expect(runtime.processInboundChanges()).rejects.toThrow(
      /bidirectional sync/,
    );
  });
});
