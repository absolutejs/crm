import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type AttioEvent = {
  id?: string;
  event_type?:
    | "record.created"
    | "record.updated"
    | "record.deleted"
    | "note.created"
    | "task.created"
    | string;
  actor?: { id: string; type: string };
  data?: {
    object_id?: string;
    object_api_slug?: string;
    record_id?: string;
    note_id?: string;
    task_id?: string;
    [key: string]: unknown;
  };
  timestamp?: number;
};

type AttioWebhookBody = { events?: AttioEvent[] } | AttioEvent[];

const SLUG_MAP: Record<string, CRMEntityType> = {
  companies: "account",
  deals: "deal",
  people: "contact",
};

const eventTypeToOp = (
  eventType: string | undefined,
): "create" | "update" | "delete" => {
  if (eventType?.endsWith(".created")) return "create";
  if (eventType?.endsWith(".deleted")) return "delete";
  return "update";
};

const eventsFromBody = (
  body: AttioWebhookBody | undefined,
): AttioEvent[] => {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (body.events) return body.events;
  return [];
};

export const verifyAttioWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(headers, "x-attio-signature");
  const timestamp = headerValue(headers, "x-attio-timestamp");
  if (!signature || !timestamp) return false;
  const age = Date.now() - Number(timestamp);
  if (Number.isNaN(age) || age > 5 * 60 * 1000) return false;
  const source = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(source).digest("hex");
  return timingSafeEqualString(signature, expected);
};

export const normalizeAttioWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const events = eventsFromBody(parsed as AttioWebhookBody | undefined);
  const out: CRMChangeEvent[] = [];
  for (const event of events) {
    const eventType = event.event_type ?? "";
    let entityType: CRMEntityType | null = null;
    let entityId = "";
    if (eventType.startsWith("record.")) {
      entityType = SLUG_MAP[event.data?.object_api_slug ?? ""] ?? null;
      entityId = event.data?.record_id ?? "";
    } else if (eventType.startsWith("note.")) {
      entityType = "note";
      entityId = event.data?.note_id ?? "";
    } else if (eventType.startsWith("task.")) {
      entityType = "task";
      entityId = event.data?.task_id ?? "";
    }
    if (!entityType || !entityId) continue;
    out.push({
      entityId,
      entityType,
      id: event.id ?? `attio:${entityId}:${event.timestamp ?? receivedAtMs}`,
      op: eventTypeToOp(eventType),
      payload: { ...(event.data ?? {}) },
      receivedAtMs: event.timestamp ?? receivedAtMs,
      vendor: "attio",
    });
  }
  return out;
};

export type CreateAttioCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createAttioCRMWebhookConfig = (
  options: CreateAttioCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeAttioWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "attio",
  verify: verifyAttioWebhookSignature,
});
