import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type HubSpotWebhookEntry = {
  eventId?: number;
  appId?: number;
  subscriptionId?: number;
  subscriptionType?: string;
  objectId?: number | string;
  propertyName?: string;
  propertyValue?: unknown;
  occurredAt?: number;
  changeFlag?: string;
  portalId?: number | string;
};

const subscriptionToEntityType = (
  subscriptionType: string | undefined,
): CRMEntityType | null => {
  if (!subscriptionType) return null;
  if (subscriptionType.startsWith("contact.")) return "contact";
  if (subscriptionType.startsWith("company.")) return "account";
  if (subscriptionType.startsWith("deal.")) return "deal";
  if (subscriptionType.startsWith("ticket.")) return "task";
  return null;
};

const subscriptionToOp = (
  subscriptionType: string | undefined,
): "create" | "update" | "delete" => {
  if (!subscriptionType) return "update";
  if (subscriptionType.endsWith(".creation")) return "create";
  if (
    subscriptionType.endsWith(".deletion") ||
    subscriptionType.endsWith(".privacyDeletion")
  )
    return "delete";
  return "update";
};

export const verifyHubSpotWebhookV3Signature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature =
    headers["x-hubspot-signature-v3"] ?? headers["X-HubSpot-Signature-v3"];
  const timestamp =
    headers["x-hubspot-request-timestamp"] ??
    headers["X-HubSpot-Request-Timestamp"];
  const method = headers["x-hubspot-request-method"] ?? "POST";
  const uri = headers["x-hubspot-request-uri"] ?? "/";
  if (!signature || !timestamp) return false;
  const ageMs = Date.now() - Number(timestamp);
  if (
    !/^\d+$/.test(timestamp) ||
    !Number.isSafeInteger(Number(timestamp)) ||
    Math.abs(ageMs) > 5 * 60 * 1000
  )
    return false;
  const decodedUri = uri.replace(
    /%3a|%2f|%3f|%40|%21|%24|%27|%28|%29|%2a|%2c|%3b/gi,
    (encoded) => decodeURIComponent(encoded),
  );
  const sourceString = `${method}${decodedUri}${rawBody}${timestamp}`;
  const expected = createHmac("sha256", secret)
    .update(sourceString)
    .digest("base64");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
};

export const normalizeHubSpotWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const entries: HubSpotWebhookEntry[] = Array.isArray(parsed)
    ? (parsed as HubSpotWebhookEntry[])
    : [];
  const events: CRMChangeEvent[] = [];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.subscriptionType !== "string"
    )
      continue;
    if (
      typeof entry.objectId !== "number" &&
      typeof entry.objectId !== "string"
    )
      continue;
    const entityType = subscriptionToEntityType(entry.subscriptionType);
    if (!entityType) continue;
    const entityId = entry.objectId !== undefined ? String(entry.objectId) : "";
    if (!entityId) continue;
    const op = subscriptionToOp(entry.subscriptionType);
    const payload: Record<string, unknown> = {
      ...(entry.propertyName !== undefined
        ? { [entry.propertyName]: entry.propertyValue }
        : {}),
      ...(entry.changeFlag !== undefined
        ? { changeFlag: entry.changeFlag }
        : {}),
    };
    events.push({
      ...(entry.portalId !== undefined
        ? { accountRef: String(entry.portalId) }
        : {}),
      entityId,
      entityType,
      // eventId is not globally unique; retry counters and receipt time must not affect identity.
      id: `hs:${createHash("sha256")
        .update(
          JSON.stringify([
            entry.appId ?? null,
            entry.portalId === undefined ? null : String(entry.portalId),
            entry.subscriptionId ?? null,
            entry.eventId ?? null,
            entry.subscriptionType,
            entityId,
            entry.occurredAt ?? null,
            entry.propertyName ?? null,
            entry.propertyValue ?? null,
            entry.changeFlag ?? null,
          ]),
        )
        .digest("hex")}`,
      op,
      payload,
      receivedAtMs: entry.occurredAt ?? receivedAtMs,
      vendor: "hubspot",
    });
  }
  return events;
};

export type CreateHubSpotCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createHubSpotCRMWebhookConfig = (
  options: CreateHubSpotCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeHubSpotWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "hubspot",
  verify: verifyHubSpotWebhookV3Signature,
});
