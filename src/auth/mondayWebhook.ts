import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type MondayEvent = {
  type?:
    | "create_pulse"
    | "update_pulse"
    | "delete_pulse"
    | "change_column_value"
    | string;
  pulseId?: number;
  pulseName?: string;
  boardId?: number;
  columnId?: string;
  columnType?: string;
  columnTitle?: string;
  value?: unknown;
  previousValue?: unknown;
  userId?: number;
  triggerTime?: string;
};

type MondayWebhookBody = {
  event?: MondayEvent;
  challenge?: string;
};

const base64UrlToBuffer = (input: string): Buffer => {
  const padded =
    input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/gu, "+").replace(/_/gu, "/"),
    "base64",
  );
};

const typeToOp = (
  type: string | undefined,
): "create" | "update" | "delete" => {
  if (type === "create_pulse") return "create";
  if (type === "delete_pulse") return "delete";
  return "update";
};

export const verifyMondayWebhookSignature: CRMWebhookSignatureVerifier = ({
  headers,
  secret,
}) => {
  if (!secret) return false;
  const authorization = headerValue(headers, "authorization");
  if (!authorization) return false;
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : authorization;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
  const provided = signatureB64.replace(/=+$/u, "");
  return timingSafeEqualString(provided, expected) &&
    base64UrlToBuffer(payloadB64).length > 0;
};

export const normalizeMondayWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const body = parsed as MondayWebhookBody | undefined;
  const event = body?.event;
  if (!event?.pulseId) return [];
  const op = typeToOp(event.type);
  const occurredAt = event.triggerTime
    ? new Date(event.triggerTime).getTime()
    : receivedAtMs;
  const entityId = String(event.pulseId);
  const entityType: CRMEntityType = "contact";
  return [
    {
      entityId,
      entityType,
      id: `monday:${entityId}:${occurredAt}`,
      op,
      payload: { ...event },
      receivedAtMs: occurredAt,
      vendor: "monday",
    },
  ];
};

export type CreateMondayCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createMondayCRMWebhookConfig = (
  options: CreateMondayCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeMondayWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "monday",
  verify: verifyMondayWebhookSignature,
});
