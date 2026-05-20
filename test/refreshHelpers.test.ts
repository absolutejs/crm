import { describe, expect, test } from "bun:test";
import {
  createCRMRefreshOAuth,
  createGoHighLevelCRMRefreshOAuth,
  createHubSpotCRMRefreshOAuth,
  createInMemoryCRMTokenStore,
  createPipedriveCRMRefreshOAuth,
  createSalesforceCRMRefreshOAuth,
  createZohoCRMRefreshOAuth,
  getCRMAdapterForUser,
} from "../src";
import type {
  CRMAdapter,
  CRMCitraOAuth2ClientLike,
  CRMRefreshOAuthInput,
} from "../src";
import type { CRMOAuthTokenResponseLike } from "../src/auth";

const fakeClient = (
  response: CRMOAuthTokenResponseLike,
  calls: { args: unknown[] }[] = [],
): CRMCitraOAuth2ClientLike => ({
  async refreshAccessToken(refreshToken: string) {
    calls.push({ args: [refreshToken] });
    return response;
  },
});

const baseInput = (vendor: "hubspot" | "salesforce" | "pipedrive" | "zoho" | "gohighlevel"): CRMRefreshOAuthInput => ({
  currentRecord: {
    accessToken: "old",
    createdAt: 0,
    refreshToken: "rfsh_old",
    updatedAt: 0,
    userId: "u_1",
    vendor,
  },
  refreshToken: "rfsh_old",
  vendor,
});

describe("single-vendor refresh helpers", () => {
  test("Salesforce: pulls instance_url into context", async () => {
    const refresh = createSalesforceCRMRefreshOAuth({
      client: fakeClient({
        access_token: "new",
        expires_in: 3_600,
        instance_url: "https://acme.my.salesforce.com",
      }),
      now: () => 1_000_000,
    });
    const result = await refresh(baseInput("salesforce"));
    expect(result.accessToken).toBe("new");
    expect(result.expiresAt).toBe(1_000_000 + 3_600_000);
    expect(result.context?.instanceUrl).toBe(
      "https://acme.my.salesforce.com",
    );
  });

  test("HubSpot: rotates refresh_token + captures hub_id from token response", async () => {
    const refresh = createHubSpotCRMRefreshOAuth({
      client: fakeClient({
        access_token: "new",
        expires_in: 3_600,
        refresh_token: "rfsh_new",
      }),
    });
    const result = await refresh(baseInput("hubspot"));
    expect(result.refreshToken).toBe("rfsh_new");
  });

  test("Pipedrive: captures api_domain rotation", async () => {
    const refresh = createPipedriveCRMRefreshOAuth({
      client: fakeClient({
        access_token: "new",
        api_domain: "https://acme2.pipedrive.com",
        expires_in: 3_600,
        refresh_token: "rfsh_new",
      }),
    });
    const result = await refresh(baseInput("pipedrive"));
    expect(result.context?.apiDomain).toBe("https://acme2.pipedrive.com");
  });

  test("Zoho: keeps original refresh_token when response omits it", async () => {
    const refresh = createZohoCRMRefreshOAuth({
      client: fakeClient({
        access_token: "new",
        expires_in: 3_600,
      }),
    });
    const result = await refresh(baseInput("zoho"));
    expect(result.refreshToken).toBe("rfsh_old");
  });

  test("GoHighLevel: extracts locationId as subAccountId", async () => {
    const refresh = createGoHighLevelCRMRefreshOAuth({
      client: fakeClient({
        access_token: "new",
        expires_in: 3_600,
        locationId: "loc_42",
      }),
    });
    const result = await refresh(baseInput("gohighlevel"));
    expect(result.context?.subAccountId).toBe("loc_42");
  });

  test("custom extractContext overrides default per-vendor extractor", async () => {
    const refresh = createHubSpotCRMRefreshOAuth({
      client: fakeClient({ access_token: "new", expires_in: 60 }),
      extractContext: () => ({ region: "custom" }),
    });
    const result = await refresh(baseInput("hubspot"));
    expect(result.context?.region).toBe("custom");
  });
});

describe("createCRMRefreshOAuth (multi-vendor dispatcher)", () => {
  test("routes to the configured per-vendor client", async () => {
    const hsCalls: { args: unknown[] }[] = [];
    const refresh = createCRMRefreshOAuth({
      vendors: {
        hubspot: {
          client: fakeClient(
            { access_token: "hs_new", expires_in: 60 },
            hsCalls,
          ),
        },
        salesforce: {
          client: fakeClient({
            access_token: "sf_new",
            expires_in: 60,
            instance_url: "https://x.my.salesforce.com",
          }),
        },
      },
    });
    const hsResult = await refresh(baseInput("hubspot"));
    expect(hsResult.accessToken).toBe("hs_new");
    expect(hsCalls).toHaveLength(1);
    const sfResult = await refresh(baseInput("salesforce"));
    expect(sfResult.accessToken).toBe("sf_new");
    expect(sfResult.context?.instanceUrl).toBe("https://x.my.salesforce.com");
  });

  test("throws when vendor has no configured client", async () => {
    const refresh = createCRMRefreshOAuth({
      vendors: { hubspot: { client: fakeClient({ access_token: "x" }) } },
    });
    await expect(refresh(baseInput("salesforce"))).rejects.toThrow(
      /No CRM OAuth refresh helper/,
    );
  });
});

describe("end-to-end: getCRMAdapterForUser refresh flow", () => {
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
    addNote: async () => ({ body: "x", id: "n", vendor: "pipedrive" }),
    createContact: async (i) => ({ ...i, id: "c", vendor: "pipedrive" }),
    createDeal: async (i) => ({ ...i, id: "d", vendor: "pipedrive" }),
    createLead: async (i) => ({ ...i, id: "l", vendor: "pipedrive" }),
    createTask: async (i) => ({ ...i, id: "t", vendor: "pipedrive" }),
    getContact: async () => null,
    listPipelines: async () => [],
    logActivity: async (i) => ({ ...i, id: "a", vendor: "pipedrive" }),
    lookupContactByEmail: async () => null,
    lookupContactByPhone: async () => null,
    searchContacts: async () => [],
    updateContact: async (id) => ({
      emails: [],
      id,
      phones: [],
      vendor: "pipedrive",
    }),
    updateDeal: async (id, p) => ({
      id,
      title: p.title ?? "",
      vendor: "pipedrive",
    }),
    vendor: "pipedrive",
  };

  test("Pipedrive refresh writes new apiDomain into token store context", async () => {
    const tokenStore = createInMemoryCRMTokenStore();
    const now = 10_000_000;
    await tokenStore.put({
      accessToken: "old",
      context: { apiDomain: "https://old.pipedrive.com" },
      createdAt: 0,
      expiresAt: now + 10_000,
      refreshToken: "rfsh_old",
      updatedAt: 0,
      userId: "u_1",
      vendor: "pipedrive",
    });
    let receivedApiDomain: string | undefined;
    await getCRMAdapterForUser({
      adapters: {
        pipedrive: ({ apiDomain }) => {
          receivedApiDomain = apiDomain;
          return stubAdapter;
        },
      },
      now: () => now,
      refreshOAuth: createCRMRefreshOAuth({
        now: () => now,
        vendors: {
          pipedrive: {
            client: fakeClient({
              access_token: "new",
              api_domain: "https://acme2.pipedrive.com",
              expires_in: 3_600,
              refresh_token: "rfsh_new",
            }),
          },
        },
      }),
      refreshSkewMs: 60_000,
      tokenStore,
      userId: "u_1",
      vendor: "pipedrive",
    });
    expect(receivedApiDomain).toBe("https://acme2.pipedrive.com");
    const stored = await tokenStore.get("u_1", "pipedrive");
    expect(stored?.accessToken).toBe("new");
    expect(stored?.context?.apiDomain).toBe("https://acme2.pipedrive.com");
  });
});
