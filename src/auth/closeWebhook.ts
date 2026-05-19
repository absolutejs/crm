import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type CloseWebhookEvent = {
  event?: {
    id?: string;
    object_type?: "contact" | "lead" | "opportunity" | "activity" | "note" | "task" | string;
    object_id?: string;
    action?: "created" | "updated" | "deleted" | string;
    date_created?: string;
    data?: Record<string, unknown>;
    previous_data?: Record<string, unknown>;
  };
  subscription_id?: string;
};

const CLOSE_OBJECT_MAP: Record<string, CRMEntityType> = {
  activity: "activity",
  contact: "contact",
  lead: "lead",
  note: "note",
  opportunity: "deal",
  task: "task",
};

const actionToOp = (
  action: string | undefined,
): "create" | "update" | "delete" => {
  if (action === "created") return "create";
  if (action === "deleted") return "delete";
  return "update";
};

export const verifyCloseWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(
    headers,
    "close-sig-hash",
    "x-close-signature",
  );
  const timestamp = headerValue(
    headers,
    "close-sig-timestamp",
    "x-close-timestamp",
  );
  if (!signature) return false;
  const source = timestamp ? `${timestamp}${rawBody}` : rawBody;
  const expected = createHmac("sha256", secret).update(source).digest("hex");
  return timingSafeEqualString(signature, expected);
};

export const normalizeCloseWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const body = parsed as CloseWebhookEvent | undefined;
  const event = body?.event;
  if (!event?.object_type || !event.object_id) return [];
  const entityType = CLOSE_OBJECT_MAP[event.object_type];
  if (!entityType) return [];
  const occurredAt = event.date_created
    ? new Date(event.date_created).getTime()
    : receivedAtMs;
  return [
    {
      entityId: event.object_id,
      entityType,
      id: event.id ?? `close:${event.object_id}:${occurredAt}`,
      op: actionToOp(event.action),
      payload: event.data ?? {},
      receivedAtMs: occurredAt,
      vendor: "close",
    },
  ];
};

export type CreateCloseCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createCloseCRMWebhookConfig = (
  options: CreateCloseCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeCloseWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "close",
  verify: verifyCloseWebhookSignature,
});
