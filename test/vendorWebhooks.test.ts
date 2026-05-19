import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createAttioCRMWebhookConfig,
  createCloseCRMWebhookConfig,
  createCRMWebhookReceiver,
  createGoHighLevelCRMWebhookConfig,
  createMondayCRMWebhookConfig,
  createPipedriveCRMWebhookConfig,
  createSalesforceCRMWebhookConfig,
  createZohoCRMWebhookConfig,
  normalizeAttioWebhookPayload,
  normalizeCloseWebhookPayload,
  normalizeGoHighLevelWebhookPayload,
  normalizeMondayWebhookPayload,
  normalizePipedriveWebhookPayload,
  normalizeSalesforceWebhookPayload,
  normalizeZohoWebhookPayload,
  verifyAttioWebhookSignature,
  verifyCloseWebhookSignature,
  verifyGoHighLevelWebhookSignature,
  verifyMondayWebhookSignature,
  verifyPipedriveWebhookSignature,
  verifySalesforceWebhookSignature,
  verifyZohoWebhookSignature,
} from "../src";

const SECRET = "test-secret";

const hmacHex = (body: string) =>
  createHmac("sha256", SECRET).update(body).digest("hex");

const hmacB64 = (body: string) =>
  createHmac("sha256", SECRET).update(body).digest("base64");

describe("Salesforce webhook", () => {
  test("verifies valid HMAC signature (base64)", () => {
    const body = JSON.stringify({ events: [] });
    expect(
      verifySalesforceWebhookSignature({
        headers: { "x-sfdc-signature": hmacB64(body) },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes Change Data Capture events into per-recordId entries", async () => {
    const body = {
      events: [
        {
          ChangeEventHeader: {
            changeType: "CREATE",
            commitTimestamp: 1_500,
            entityName: "Contact",
            recordIds: ["003abc", "003def"],
          },
        },
      ],
    };
    const events = await normalizeSalesforceWebhookPayload({
      headers: {},
      parsed: body,
      rawBody: JSON.stringify(body),
      receivedAtMs: 0,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.entityType).toBe("contact");
  });
});

describe("Pipedrive webhook", () => {
  test("verifies HMAC-hex signature", () => {
    const body = JSON.stringify({ meta: { entity: "person", id: 42 } });
    expect(
      verifyPipedriveWebhookSignature({
        headers: { "x-pipedrive-signature": hmacHex(body) },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes person added action", async () => {
    const events = await normalizePipedriveWebhookPayload({
      headers: {},
      parsed: {
        current: { name: "Alex" },
        meta: { action: "added", entity: "person", id: 42, timestamp: 1500 },
      },
      rawBody: "{}",
      receivedAtMs: 0,
    });
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.entityId).toBe("42");
  });
});

describe("Zoho webhook", () => {
  test("verifies HMAC signature", () => {
    const body = JSON.stringify({ ids: ["1"], module: "Contacts" });
    expect(
      verifyZohoWebhookSignature({
        headers: { "x-zoho-signature": hmacHex(body) },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes insert operation across multiple ids", async () => {
    const events = await normalizeZohoWebhookPayload({
      headers: {},
      parsed: { ids: ["100", "101"], module: "Leads", operation: "insert" },
      rawBody: "{}",
      receivedAtMs: 1000,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.entityType).toBe("lead");
    expect(events[0]?.op).toBe("create");
  });
});

describe("Attio webhook", () => {
  test("verifies HMAC over timestamp.body", () => {
    const body = "{}";
    const timestamp = String(Date.now());
    const sig = createHmac("sha256", SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    expect(
      verifyAttioWebhookSignature({
        headers: {
          "x-attio-signature": sig,
          "x-attio-timestamp": timestamp,
        },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("rejects stale timestamp", () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000);
    const sig = createHmac("sha256", SECRET).update(`${timestamp}.{}`).digest("hex");
    expect(
      verifyAttioWebhookSignature({
        headers: {
          "x-attio-signature": sig,
          "x-attio-timestamp": timestamp,
        },
        rawBody: "{}",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  test("normalizes record.created with people slug → contact", async () => {
    const events = await normalizeAttioWebhookPayload({
      headers: {},
      parsed: {
        events: [
          {
            data: { object_api_slug: "people", record_id: "p_42" },
            event_type: "record.created",
            id: "evt_1",
            timestamp: 2000,
          },
        ],
      },
      rawBody: "{}",
      receivedAtMs: 0,
    });
    expect(events[0]?.entityType).toBe("contact");
    expect(events[0]?.op).toBe("create");
  });
});

describe("Close webhook", () => {
  test("verifies HMAC signature", () => {
    const body = JSON.stringify({
      event: { action: "created", object_id: "ld_1", object_type: "lead" },
    });
    expect(
      verifyCloseWebhookSignature({
        headers: { "close-sig-hash": hmacHex(body) },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes opportunity.updated event", async () => {
    const events = await normalizeCloseWebhookPayload({
      headers: {},
      parsed: {
        event: {
          action: "updated",
          data: { value: 5000 },
          object_id: "opp_42",
          object_type: "opportunity",
        },
      },
      rawBody: "{}",
      receivedAtMs: 1500,
    });
    expect(events[0]?.entityType).toBe("deal");
    expect(events[0]?.op).toBe("update");
  });
});

describe("monday webhook", () => {
  test("verifies JWT-style HS256 signature", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" }))
      .toString("base64")
      .replace(/=+$/u, "")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_");
    const payload = Buffer.from(JSON.stringify({ pulseId: 42 }))
      .toString("base64")
      .replace(/=+$/u, "")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_");
    const sig = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64")
      .replace(/=+$/u, "")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_");
    expect(
      verifyMondayWebhookSignature({
        headers: { authorization: `Bearer ${header}.${payload}.${sig}` },
        rawBody: "",
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes create_pulse to create op on contact", async () => {
    const events = await normalizeMondayWebhookPayload({
      headers: {},
      parsed: {
        event: {
          boardId: 1,
          pulseId: 42,
          pulseName: "Alex",
          triggerTime: "2026-05-19T10:00:00Z",
          type: "create_pulse",
        },
      },
      rawBody: "{}",
      receivedAtMs: 0,
    });
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.entityType).toBe("contact");
  });
});

describe("GoHighLevel webhook", () => {
  test("verifies HMAC hex signature", () => {
    const body = JSON.stringify({ contactId: "c_42", type: "ContactCreate" });
    expect(
      verifyGoHighLevelWebhookSignature({
        headers: { "x-wh-signature": hmacHex(body) },
        rawBody: body,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  test("normalizes OpportunityCreate → create op on deal", async () => {
    const events = await normalizeGoHighLevelWebhookPayload({
      headers: {},
      parsed: {
        opportunityId: "opp_42",
        payload: { name: "Acme" },
        timestamp: "2026-05-19T10:00:00Z",
        type: "OpportunityCreate",
      },
      rawBody: "{}",
      receivedAtMs: 0,
    });
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.entityType).toBe("deal");
    expect(events[0]?.entityId).toBe("opp_42");
  });

  test("ignores unknown event types", async () => {
    const events = await normalizeGoHighLevelWebhookPayload({
      headers: {},
      parsed: { contactId: "c_1", type: "WeatherChange" },
      rawBody: "{}",
      receivedAtMs: 0,
    });
    expect(events).toHaveLength(0);
  });
});

describe("createCRMWebhookReceiver with all vendor configs", () => {
  test("end-to-end: registers all 8 vendors and routes by name", async () => {
    const fired: string[] = [];
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: (e) => fired.push(e.vendor),
      vendors: [
        createSalesforceCRMWebhookConfig({ signingSecret: SECRET }),
        createPipedriveCRMWebhookConfig({ signingSecret: SECRET }),
        createZohoCRMWebhookConfig({ signingSecret: SECRET }),
        createAttioCRMWebhookConfig({ signingSecret: SECRET }),
        createCloseCRMWebhookConfig({ signingSecret: SECRET }),
        createMondayCRMWebhookConfig({ signingSecret: SECRET }),
        createGoHighLevelCRMWebhookConfig({ signingSecret: SECRET }),
      ],
    });
    expect(receiver.vendors().sort()).toEqual([
      "attio",
      "close",
      "gohighlevel",
      "monday",
      "pipedrive",
      "salesforce",
      "zoho",
    ]);
    const body = JSON.stringify({
      meta: { action: "added", entity: "person", id: 42 },
    });
    await receiver.handle({
      headers: { "x-pipedrive-signature": hmacHex(body) },
      rawBody: body,
      vendor: "pipedrive",
    });
    expect(fired).toEqual(["pipedrive"]);
  });
});
