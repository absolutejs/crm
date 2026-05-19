import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type HubSpotWebhookEntry = {
  eventId?: number;
  subscriptionType?: string;
  objectId?: number | string;
  propertyName?: string;
  propertyValue?: unknown;
  occurredAt?: number;
  changeFlag?: string;
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
  if (subscriptionType.endsWith(".deletion")) return "delete";
  return "update";
};

export const verifyHubSpotWebhookV3Signature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature =
    headers["x-hubspot-signature-v3"] ??
    headers["X-HubSpot-Signature-v3"];
  const timestamp =
    headers["x-hubspot-request-timestamp"] ??
    headers["X-HubSpot-Request-Timestamp"];
  const method = headers["x-hubspot-request-method"] ?? "POST";
  const uri = headers["x-hubspot-request-uri"] ?? "/";
  if (!signature || !timestamp) return false;
  const ageMs = Date.now() - Number(timestamp);
  if (Number.isNaN(ageMs) || ageMs > 5 * 60 * 1000) return false;
  const sourceString = `${method}${uri}${rawBody}${timestamp}`;
  const expected = createHmac("sha256", secret)
    .update(sourceString)
    .digest("base64");
  return expected === signature;
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
    const entityType = subscriptionToEntityType(entry.subscriptionType);
    if (!entityType) continue;
    const entityId =
      entry.objectId !== undefined ? String(entry.objectId) : "";
    if (!entityId) continue;
    const op = subscriptionToOp(entry.subscriptionType);
    const payload: Record<string, unknown> = {
      ...(entry.propertyName !== undefined
        ? { [entry.propertyName]: entry.propertyValue }
        : {}),
      ...(entry.changeFlag !== undefined ? { changeFlag: entry.changeFlag } : {}),
    };
    events.push({
      entityId,
      entityType,
      id: entry.eventId !== undefined ? `hs:${entry.eventId}` : `hs:${entityId}:${entry.occurredAt ?? receivedAtMs}`,
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
