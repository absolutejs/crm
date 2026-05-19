import { describe, expect, test } from "bun:test";
import {
  createCRMWebhookReceiver,
  createPermissiveCRMWebhookVerifier,
} from "../src/auth/webhookReceiver";
import type { CRMChangeEvent } from "../src/sync";

const fakeNormalize = () => async () => [
  {
    entityId: "contact_1",
    entityType: "contact" as const,
    id: "evt_1",
    op: "update" as const,
    receivedAtMs: 0,
    vendor: "hubspot" as const,
  } satisfies CRMChangeEvent,
];

describe("createCRMWebhookReceiver", () => {
  test("verified webhook normalizes + fires onChangeEvent", async () => {
    const events: CRMChangeEvent[] = [];
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: (e) => {
        events.push(e);
      },
      vendors: [
        {
          normalize: fakeNormalize(),
          vendor: "hubspot",
          verify: createPermissiveCRMWebhookVerifier(),
        },
      ],
    });
    const result = await receiver.handle({
      headers: {},
      rawBody: "{}",
      vendor: "hubspot",
    });
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
  });

  test("invalid signature returns reason and skips normalization", async () => {
    const events: CRMChangeEvent[] = [];
    let failureCount = 0;
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: (e) => {
        events.push(e);
      },
      onVerificationFailed: () => {
        failureCount += 1;
      },
      vendors: [
        {
          normalize: fakeNormalize(),
          vendor: "hubspot",
          verify: () => false,
        },
      ],
    });
    const result = await receiver.handle({
      headers: {},
      rawBody: "{}",
      vendor: "hubspot",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature-invalid");
    expect(events).toHaveLength(0);
    expect(failureCount).toBe(1);
  });

  test("unknown vendor returns reason", async () => {
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: () => {},
      vendors: [],
    });
    const result = await receiver.handle({
      headers: {},
      rawBody: "{}",
      vendor: "salesforce",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown-vendor");
  });

  test("malformed body returns parse-error", async () => {
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: () => {},
      vendors: [
        {
          normalize: fakeNormalize(),
          vendor: "hubspot",
          verify: createPermissiveCRMWebhookVerifier(),
        },
      ],
    });
    const result = await receiver.handle({
      headers: {},
      rawBody: "{not json",
      vendor: "hubspot",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parse-error");
  });

  test("register adds a vendor at runtime", async () => {
    const receiver = createCRMWebhookReceiver({
      onChangeEvent: () => {},
      vendors: [],
    });
    expect(receiver.vendors()).toEqual([]);
    receiver.register({
      normalize: fakeNormalize(),
      vendor: "attio",
      verify: createPermissiveCRMWebhookVerifier(),
    });
    expect(receiver.vendors()).toEqual(["attio"]);
  });
});
