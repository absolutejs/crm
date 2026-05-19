import { describe, expect, test } from "bun:test";
import { createCRMOAuthHandler } from "../src/auth";
import { createInMemoryCRMTokenStore } from "../src/stores";

describe("createCRMOAuthHandler", () => {
  test("isEnabledVendor narrows authProvider strings to CRMVendor", () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { hubspot: {}, salesforce: {} },
    });
    expect(handler.isEnabledVendor("hubspot")).toBe(true);
    expect(handler.isEnabledVendor("google")).toBe(false);
    expect(handler.enabledVendors.sort()).toEqual(["hubspot", "salesforce"]);
  });

  test("persist writes a record with computed expiresAt + scopes", async () => {
    const store = createInMemoryCRMTokenStore();
    const handler = createCRMOAuthHandler({
      now: () => 1_000_000,
      tokenStore: store,
      vendors: { hubspot: {} },
    });
    const record = await handler.persist({
      tokenResponse: {
        access_token: "tkn",
        expires_in: 3_600,
        refresh_token: "rfsh",
        scope: "crm.objects.contacts.read crm.objects.contacts.write",
        token_type: "Bearer",
      },
      userId: "u_1",
      vendor: "hubspot",
    });
    expect(record.expiresAt).toBe(1_000_000 + 3_600_000);
    expect(record.scopes).toEqual([
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
    ]);
    const stored = await store.get("u_1", "hubspot");
    expect(stored?.accessToken).toBe("tkn");
  });

  test("salesforce extractor pulls instanceUrl from token response", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { salesforce: {} },
    });
    const record = await handler.persist({
      tokenResponse: {
        access_token: "tkn",
        instance_url: "https://acme.my.salesforce.com",
      },
      userId: "u_1",
      vendor: "salesforce",
    });
    expect(record.context?.instanceUrl).toBe(
      "https://acme.my.salesforce.com",
    );
  });

  test("salesforce extractor falls back to profile.urls.rest", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { salesforce: {} },
    });
    const record = await handler.persist({
      profile: {
        urls: {
          rest: "https://acme.my.salesforce.com/services/data/v60.0",
        },
      },
      tokenResponse: { access_token: "tkn" },
      userId: "u_1",
      vendor: "salesforce",
    });
    expect(record.context?.instanceUrl).toBe(
      "https://acme.my.salesforce.com",
    );
  });

  test("pipedrive extractor pulls api_domain", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { pipedrive: {} },
    });
    const record = await handler.persist({
      tokenResponse: {
        access_token: "tkn",
        api_domain: "https://acme.pipedrive.com",
      },
      userId: "u_1",
      vendor: "pipedrive",
    });
    expect(record.context?.apiDomain).toBe("https://acme.pipedrive.com");
  });

  test("hubspot extractor captures hub_id as subAccountId", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { hubspot: {} },
    });
    const record = await handler.persist({
      profile: { hub_id: 12345 },
      tokenResponse: { access_token: "tkn" },
      userId: "u_1",
      vendor: "hubspot",
    });
    expect(record.context?.subAccountId).toBe("12345");
  });

  test("zoho extractor captures region and api_domain", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { zoho: {} },
    });
    const record = await handler.persist({
      tokenResponse: {
        access_token: "tkn",
        api_domain: "https://www.zohoapis.eu",
        location: "eu",
      },
      userId: "u_1",
      vendor: "zoho",
    });
    expect(record.context?.region).toBe("eu");
    expect(record.context?.apiDomain).toBe("https://www.zohoapis.eu");
  });

  test("custom extractor override beats default", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: {
        hubspot: {
          extractContext: () => ({ region: "custom-region" }),
        },
      },
    });
    const record = await handler.persist({
      tokenResponse: { access_token: "tkn" },
      userId: "u_1",
      vendor: "hubspot",
    });
    expect(record.context?.region).toBe("custom-region");
  });

  test("fromAbsoluteAuthCallback returns null for non-CRM provider", async () => {
    const handler = createCRMOAuthHandler({
      tokenStore: createInMemoryCRMTokenStore(),
      vendors: { hubspot: {} },
    });
    const result = await handler.fromAbsoluteAuthCallback({
      authProvider: "google",
      tokenResponse: { access_token: "tkn" },
      userId: "u_1",
    });
    expect(result).toBeNull();
  });

  test("fromAbsoluteAuthCallback persists when provider is CRM-enabled", async () => {
    const store = createInMemoryCRMTokenStore();
    const handler = createCRMOAuthHandler({
      tokenStore: store,
      vendors: { hubspot: {} },
    });
    await handler.fromAbsoluteAuthCallback({
      authProvider: "hubspot",
      tokenResponse: { access_token: "tkn" },
      userId: "u_1",
    });
    const stored = await store.get("u_1", "hubspot");
    expect(stored?.accessToken).toBe("tkn");
  });
});
