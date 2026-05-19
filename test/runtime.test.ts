import { describe, expect, test } from "bun:test";
import { createInMemoryCRMTokenStore, type CRMTokenStore } from "../src/stores";
import { createInMemoryCRMSyncQueue } from "../src/sync";
import { createCRMRuntime } from "../src/runtime";
import type { CRMAdapter, CRMContact } from "../src/types";

const stubAdapter = (vendor: "hubspot" | "salesforce"): CRMAdapter => ({
  capabilities: {
    preferredIdField: "id",
    supportsBulkUpsert: false,
    supportsCustomFields: true,
    supportsLeads: true,
    supportsPipelines: true,
    supportsWebhooks: true,
    syncDirection: "outbound-only",
  },
  async addNote(input) {
    return { ...input, id: "n_1", vendor };
  },
  async createContact(input) {
    return { ...input, id: "c_1", vendor };
  },
  async createDeal(input) {
    return { ...input, id: "d_1", vendor };
  },
  async createLead(input) {
    return { ...input, id: "l_1", vendor };
  },
  async createTask(input) {
    return { ...input, id: "t_1", vendor };
  },
  async getContact() {
    return null;
  },
  async listPipelines() {
    return [];
  },
  async logActivity(input) {
    return { ...input, id: "a_1", vendor };
  },
  async lookupContactByEmail() {
    return null;
  },
  async lookupContactByPhone() {
    return null;
  },
  async searchContacts() {
    return [];
  },
  async updateContact(id, patch) {
    return { ...patch, emails: [], id, phones: [], vendor } as CRMContact;
  },
  async updateDeal(id, patch) {
    return { ...patch, id, title: patch.title ?? "", vendor };
  },
  vendor,
});

const seededStore = async (): Promise<CRMTokenStore> => {
  const store = createInMemoryCRMTokenStore();
  await store.put({
    accessToken: "tkn",
    createdAt: 0,
    updatedAt: 0,
    userId: "user_1",
    vendor: "hubspot",
  });
  return store;
};

describe("createCRMRuntime", () => {
  test("adapterFor instantiates from token + factory", async () => {
    const runtime = createCRMRuntime({
      adapters: {
        hubspot: () => stubAdapter("hubspot"),
      },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seededStore(),
    });
    const adapter = await runtime.adapterFor("user_1", "hubspot");
    expect(adapter.vendor).toBe("hubspot");
  });

  test("createContact routes through the adapter", async () => {
    const runtime = createCRMRuntime({
      adapters: {
        hubspot: () => stubAdapter("hubspot"),
      },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seededStore(),
    });
    const contact = await runtime.createContact("user_1", "hubspot", {
      emails: [{ address: "a@b.com" }],
      firstName: "Alex",
      phones: [],
    });
    expect(contact.id).toBe("c_1");
  });

  test("throws when vendor has no adapter registered", async () => {
    const runtime = createCRMRuntime({
      adapters: {},
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seededStore(),
    });
    await expect(runtime.adapterFor("user_1", "hubspot")).rejects.toThrow(
      /No CRM adapter registered/,
    );
  });

  test("throws when user has no token for vendor", async () => {
    const runtime = createCRMRuntime({
      adapters: {
        hubspot: () => stubAdapter("hubspot"),
      },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: createInMemoryCRMTokenStore(),
    });
    await expect(runtime.adapterFor("user_1", "hubspot")).rejects.toThrow(
      /No token stored/,
    );
  });

  test("enqueueOutboundCreate writes to the sync queue", async () => {
    const queue = createInMemoryCRMSyncQueue();
    const runtime = createCRMRuntime({
      adapters: {
        hubspot: () => stubAdapter("hubspot"),
      },
      syncQueue: queue,
      tokenStore: await seededStore(),
    });
    await runtime.enqueueOutboundCreate("user_1", "hubspot", {
      emails: [{ address: "a@b.com" }],
      firstName: "Alex",
      phones: [],
    });
    const jobs = await queue.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("outbound.create");
  });

  test("recordInboundChange logs to queue and fires subscribers", async () => {
    const runtime = createCRMRuntime({
      adapters: {},
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: await seededStore(),
    });
    const events: string[] = [];
    runtime.subscribe((evt) => events.push(evt.type));
    await runtime.recordInboundChange({
      entityId: "x",
      entityType: "contact",
      id: "evt_1",
      op: "update",
      receivedAtMs: 0,
      vendor: "hubspot",
    });
    expect(events).toEqual(["inbound"]);
  });

  test("token refresh callback updates the store", async () => {
    const store = await seededStore();
    const runtime = createCRMRuntime({
      adapters: {
        hubspot: async ({ onTokenRefresh }) => {
          await onTokenRefresh?.({
            accessToken: "tkn_2",
            expiresAt: 999,
            refreshToken: "rfsh_2",
          });
          return stubAdapter("hubspot");
        },
      },
      syncQueue: createInMemoryCRMSyncQueue(),
      tokenStore: store,
    });
    await runtime.adapterFor("user_1", "hubspot");
    const record = await store.get("user_1", "hubspot");
    expect(record?.accessToken).toBe("tkn_2");
    expect(record?.refreshToken).toBe("rfsh_2");
  });
});
