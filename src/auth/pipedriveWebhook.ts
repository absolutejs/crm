import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type PipedriveWebhookPayload = {
  meta?: {
    action?: "create" | "change" | "delete" | "updated" | "added";
    entity?: string;
    id?: number | string;
    timestamp?: number;
    timestamp_micro?: number;
    object?: string;
  };
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
};

const PIPEDRIVE_ENTITY_MAP: Record<string, CRMEntityType> = {
  activity: "activity",
  deal: "deal",
  note: "note",
  organization: "account",
  person: "contact",
};

const actionToOp = (
  action: string | undefined,
): "create" | "update" | "delete" => {
  if (action === "create" || action === "added") return "create";
  if (action === "delete") return "delete";
  return "update";
};

export const verifyPipedriveWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(
    headers,
    "x-pipedrive-signature",
    "x-signature",
  );
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualString(signature, expected);
};

export const normalizePipedriveWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const body = parsed as PipedriveWebhookPayload | undefined;
  if (!body?.meta) return [];
  const entityType = PIPEDRIVE_ENTITY_MAP[body.meta.entity ?? body.meta.object ?? ""];
  if (!entityType) return [];
  const entityId = body.meta.id !== undefined ? String(body.meta.id) : "";
  if (!entityId) return [];
  const occurredAt = body.meta.timestamp ?? receivedAtMs;
  return [
    {
      entityId,
      entityType,
      id: `pd:${entityId}:${occurredAt}`,
      op: actionToOp(body.meta.action),
      payload: body.current ?? {},
      receivedAtMs: occurredAt,
      vendor: "pipedrive",
    },
  ];
};

export type CreatePipedriveCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createPipedriveCRMWebhookConfig = (
  options: CreatePipedriveCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizePipedriveWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "pipedrive",
  verify: verifyPipedriveWebhookSignature,
});
