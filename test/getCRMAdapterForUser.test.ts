import { describe, expect, test } from "bun:test";
import { getCRMAdapterForUser } from "../src/auth";
import { createInMemoryCRMTokenStore } from "../src/stores";
import type { CRMAdapter } from "../src/types";

const stubAdapter: CRMAdapter = {
  capabilities: {
    preferredIdField: "id",
    supportsBulkUpsert: false,
    supportsCustomFields: false,
    supportsLeads: true,
    supportsPipelines: true,
    supportsWebhooks: true,
    syncDirection: "outbound-only",
  },
  addNote: async (i) => ({ ...i, id: "n", vendor: "hubspot" }),
  createContact: async (i) => ({ ...i, id: "c", vendor: "hubspot" }),
  createDeal: async (i) => ({ ...i, id: "d", vendor: "hubspot" }),
  createLead: async (i) => ({ ...i, id: "l", vendor: "hubspot" }),
  createTask: async (i) => ({ ...i, id: "t", vendor: "hubspot" }),
  getContact: async () => null,
  listPipelines: async () => [],
  logActivity: async (i) => ({ ...i, id: "a", vendor: "hubspot" }),
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

describe("getCRMAdapterForUser", () => {
  test("throws when no adapter registered for vendor", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({
      accessToken: "tkn",
      createdAt: 0,
      updatedAt: 0,
      userId: "u_1",
      vendor: "hubspot",
    });
    await expect(
      getCRMAdapterForUser({
        adapters: {},
        tokenStore: store,
        userId: "u_1",
        vendor: "hubspot",
      }),
    ).rejects.toThrow(/No CRM adapter registered/);
  });

  test("throws when no token stored", async () => {
    await expect(
      getCRMAdapterForUser({
        adapters: { hubspot: () => stubAdapter },
        tokenStore: createInMemoryCRMTokenStore(),
        userId: "u_1",
        vendor: "hubspot",
      }),
    ).rejects.toThrow(/No token stored/);
  });

  test("refreshes when token is within skew window", async () => {
    const store = createInMemoryCRMTokenStore();
    let t = 1_000_000;
    await store.put({
      accessToken: "old",
      createdAt: 0,
      expiresAt: t + 10_000,
      refreshToken: "rfsh",
      updatedAt: 0,
      userId: "u_1",
      vendor: "hubspot",
    });
    let refreshCalledWith: string | null = null;
    const factoryReceivedToken: string[] = [];
    await getCRMAdapterForUser({
      adapters: {
        hubspot: ({ accessToken }) => {
          factoryReceivedToken.push(accessToken);
          return stubAdapter;
        },
      },
      now: () => t,
      refreshOAuth: async ({ refreshToken }) => {
        refreshCalledWith = refreshToken;
        return {
          accessToken: "new",
          expiresAt: t + 3_600_000,
          refreshToken: "rfsh_new",
        };
      },
      refreshSkewMs: 60_000,
      tokenStore: store,
      userId: "u_1",
      vendor: "hubspot",
    });
    expect(refreshCalledWith).toBe("rfsh");
    expect(factoryReceivedToken[0]).toBe("new");
    const stored = await store.get("u_1", "hubspot");
    expect(stored?.accessToken).toBe("new");
    expect(stored?.refreshToken).toBe("rfsh_new");
  });

  test("skips refresh when token is fresh", async () => {
    const store = createInMemoryCRMTokenStore();
    const t = 1_000_000;
    await store.put({
      accessToken: "fresh",
      createdAt: 0,
      expiresAt: t + 60 * 60 * 1000,
      refreshToken: "rfsh",
      updatedAt: 0,
      userId: "u_1",
      vendor: "hubspot",
    });
    let refreshCalled = false;
    await getCRMAdapterForUser({
      adapters: { hubspot: () => stubAdapter },
      now: () => t,
      refreshOAuth: async () => {
        refreshCalled = true;
        return { accessToken: "x" };
      },
      tokenStore: store,
      userId: "u_1",
      vendor: "hubspot",
    });
    expect(refreshCalled).toBe(false);
  });

  test("propagates vendor context (instanceUrl etc) to factory", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({
      accessToken: "tkn",
      context: {
        apiDomain: "https://acme.pipedrive.com",
        instanceUrl: "https://acme.my.salesforce.com",
      },
      createdAt: 0,
      updatedAt: 0,
      userId: "u_1",
      vendor: "salesforce",
    });
    let receivedInstanceUrl: string | undefined;
    let receivedApiDomain: string | undefined;
    await getCRMAdapterForUser({
      adapters: {
        salesforce: ({ instanceUrl, apiDomain }) => {
          receivedInstanceUrl = instanceUrl;
          receivedApiDomain = apiDomain;
          return stubAdapter;
        },
      },
      tokenStore: store,
      userId: "u_1",
      vendor: "salesforce",
    });
    expect(receivedInstanceUrl).toBe("https://acme.my.salesforce.com");
    expect(receivedApiDomain).toBe("https://acme.pipedrive.com");
  });

  test("onTokenRefresh callback updates the store", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({
      accessToken: "tkn",
      createdAt: 0,
      updatedAt: 0,
      userId: "u_1",
      vendor: "hubspot",
    });
    await getCRMAdapterForUser({
      adapters: {
        hubspot: async ({ onTokenRefresh }) => {
          await onTokenRefresh?.({
            accessToken: "tkn_2",
            expiresAt: 999,
            refreshToken: "rfsh_2",
          });
          return stubAdapter;
        },
      },
      tokenStore: store,
      userId: "u_1",
      vendor: "hubspot",
    });
    const stored = await store.get("u_1", "hubspot");
    expect(stored?.accessToken).toBe("tkn_2");
    expect(stored?.refreshToken).toBe("rfsh_2");
    expect(stored?.expiresAt).toBe(999);
  });
});
