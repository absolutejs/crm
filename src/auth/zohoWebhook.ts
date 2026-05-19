import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type ZohoNotificationModule =
  | "Contacts"
  | "Leads"
  | "Deals"
  | "Accounts"
  | "Tasks"
  | "Notes"
  | "Calls"
  | string;

type ZohoNotification = {
  operation?: "insert" | "update" | "delete" | string;
  module?: ZohoNotificationModule;
  ids?: string[];
  resource_uri?: string;
  channel_id?: string;
  token?: string;
};

type ZohoWebhookBody = ZohoNotification | { notifications?: ZohoNotification[] };

const ZOHO_MODULE_MAP: Partial<Record<ZohoNotificationModule, CRMEntityType>> = {
  Accounts: "account",
  Calls: "activity",
  Contacts: "contact",
  Deals: "deal",
  Leads: "lead",
  Notes: "note",
  Tasks: "task",
};

const notificationsFromBody = (
  body: ZohoWebhookBody | undefined,
): ZohoNotification[] => {
  if (!body) return [];
  if ("notifications" in body && Array.isArray(body.notifications)) {
    return body.notifications;
  }
  if ("module" in body) return [body];
  return [];
};

const opToCrmOp = (
  op: string | undefined,
): "create" | "update" | "delete" => {
  if (op === "insert") return "create";
  if (op === "delete") return "delete";
  return "update";
};

export const verifyZohoWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(
    headers,
    "x-zoho-signature",
    "x-zoho-webhook-signature",
  );
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualString(signature, expected);
};

export const normalizeZohoWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const notifications = notificationsFromBody(
    parsed as ZohoWebhookBody | undefined,
  );
  const events: CRMChangeEvent[] = [];
  for (const notification of notifications) {
    const entityType = ZOHO_MODULE_MAP[notification.module ?? ""];
    if (!entityType) continue;
    const op = opToCrmOp(notification.operation);
    for (const id of notification.ids ?? []) {
      events.push({
        entityId: id,
        entityType,
        id: `zoho:${notification.channel_id ?? id}:${receivedAtMs}`,
        op,
        payload: { ...notification },
        receivedAtMs,
        vendor: "zoho",
      });
    }
  }
  return events;
};

export type CreateZohoCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createZohoCRMWebhookConfig = (
  options: CreateZohoCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeZohoWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "zoho",
  verify: verifyZohoWebhookSignature,
});
