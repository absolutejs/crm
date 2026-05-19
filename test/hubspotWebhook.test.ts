import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createCRMWebhookReceiver,
  createHubSpotCRMWebhookConfig,
  normalizeHubSpotWebhookPayload,
  verifyHubSpotWebhookV3Signature,
} from "../src";

const SECRET = "test-secret";

const signedHeaders = (rawBody: string) => {
  const timestamp = String(Date.now());
  const method = "POST";
  const uri = "/webhooks/hubspot";
  const source = `${method}${uri}${rawBody}${timestamp}`;
  const signature = createHmac("sha256", SECRET).update(source).digest("base64");
  return {
    "x-hubspot-request-method": method,
    "x-hubspot-request-timestamp": timestamp,
    "x-hubspot-request-uri": uri,
    "x-hubspot-signature-v3": signature,
  };
};

describe("verifyHubSpotWebhookV3Signature", () => {
  test("accepts a correctly-signed payload", () => {
    const rawBody = JSON.stringify([
      { eventId: 1, objectId: 42, subscriptionType: "contact.creation" },
    ]);
    const ok = verifyHubSpotWebhookV3Signature({
      headers: signedHeaders(rawBody),
      rawBody,
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  test("rejects a tampered body", () => {
    const rawBody = JSON.stringify([{ eventId: 1 }]);
    const ok = verifyHubSpotWebhookV3Signature({
      headers: signedHeaders(rawBody),
      rawBody: rawBody + "tampered",
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  test("rejects when signature header missing", () => {
    const ok = verifyHubSpotWebhookV3Signature({
      headers: {},
      rawBody: "{}",
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  test("rejects when no secret provided", () => {
    const ok = verifyHubSpotWebhookV3Signature({
      headers: signedHeaders("{}"),
      rawBody: "{}",
    });
    expect(ok).toBe(false);
  });

  test("rejects stale timestamp > 5 minutes", () => {
    const rawBody = "{}";
    const headers = signedHeaders(rawBody);
    headers["x-hubspot-request-timestamp"] = String(
      Date.now() - 10 * 60 * 1000,
    );
    const ok = verifyHubSpotWebhookV3Signature({
      headers,
      rawBody,
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });
});

describe("normalizeHubSpotWebhookPayload", () => {
  test("maps contact.creation entries to CRMChangeEvent[]", async () => {
    const entries = [
      {
        eventId: 1,
        objectId: 42,
        occurredAt: 1_500,
        subscriptionType: "contact.creation",
      },
      {
        eventId: 2,
        objectId: 99,
        propertyName: "email",
        propertyValue: "alex@example.com",
        subscriptionType: "contact.propertyChange",
      },
    ];
    const events = await normalizeHubSpotWebhookPayload({
      headers: {},
      parsed: entries,
      rawBody: JSON.stringify(entries),
      receivedAtMs: 2_000,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.entityType).toBe("contact");
    expect(events[1]?.payload?.email).toBe("alex@example.com");
  });

  test("ignores unknown subscriptionType", async () => {
    const events = await normalizeHubSpotWebhookPayload({
      headers: {},
      parsed: [{ eventId: 1, objectId: 1, subscriptionType: "weather.rain" }],
      rawBody: "[]",
      receivedAtMs: 0,
    });
    expect(events).toHaveLength(0);
  });

  test("deal.deletion maps to op=delete + entityType=deal", async () => {
    const events = await normalizeHubSpotWebhookPayload({
      headers: {},
      parsed: [
        { eventId: 1, objectId: 99, subscriptionType: "deal.deletion" },
      ],
      rawBody: "[]",
      receivedAtMs: 0,
    });
    expect(events[0]?.op).toBe("delete");
    expect(events[0]?.entityType).toBe("deal");
  });
});

describe("createHubSpotCRMWebhookConfig + receiver", () => {
  test("end-to-end: verified webhook flows through receiver to onChangeEvent", async () => {
    const fired: string[] = [];
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: (e) => {
        fired.push(e.entityId);
      },
      vendors: [createHubSpotCRMWebhookConfig({ signingSecret: SECRET })],
    });
    const rawBody = JSON.stringify([
      { eventId: 1, objectId: 42, subscriptionType: "contact.creation" },
    ]);
    const result = await receiver.handle({
      headers: signedHeaders(rawBody),
      rawBody,
      vendor: "hubspot",
    });
    expect(result.ok).toBe(true);
    expect(fired).toEqual(["42"]);
  });
});
