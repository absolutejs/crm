import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import {
  headerValue,
  timingSafeEqualString,
} from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type SalesforcePubSubEvent = {
  ChangeEventHeader?: {
    changeType?: "CREATE" | "UPDATE" | "DELETE" | "UNDELETE" | string;
    entityName?: string;
    recordIds?: string[];
    transactionKey?: string;
    commitTimestamp?: number;
  };
} & Record<string, unknown>;

type SalesforceWebhookBody =
  | { events?: SalesforcePubSubEvent[] }
  | SalesforcePubSubEvent[]
  | SalesforcePubSubEvent;

const SALESFORCE_ENTITY_MAP: Record<string, CRMEntityType> = {
  Account: "account",
  Contact: "contact",
  Lead: "lead",
  Note: "note",
  Opportunity: "deal",
  Task: "task",
};

const eventsFromBody = (
  body: SalesforceWebhookBody | undefined,
): SalesforcePubSubEvent[] => {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if ("events" in body && Array.isArray(body.events)) return body.events;
  if ("ChangeEventHeader" in body) return [body];
  return [];
};

const changeTypeToOp = (
  changeType: string | undefined,
): "create" | "update" | "delete" => {
  if (changeType === "CREATE") return "create";
  if (changeType === "DELETE") return "delete";
  return "update";
};

export const verifySalesforceWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(
    headers,
    "x-sfdc-signature",
    "x-salesforce-signature",
  );
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  return timingSafeEqualString(signature, expected);
};

export const normalizeSalesforceWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const events = eventsFromBody(parsed as SalesforceWebhookBody);
  const out: CRMChangeEvent[] = [];
  for (const event of events) {
    const header = event.ChangeEventHeader;
    if (!header) continue;
    const entityType = SALESFORCE_ENTITY_MAP[header.entityName ?? ""];
    if (!entityType) continue;
    const op = changeTypeToOp(header.changeType);
    const recordIds = header.recordIds ?? [];
    const occurredAt = header.commitTimestamp ?? receivedAtMs;
    for (const recordId of recordIds) {
      out.push({
        entityId: recordId,
        entityType,
        id: `sf:${header.transactionKey ?? recordId}:${occurredAt}`,
        op,
        payload: { ...event },
        receivedAtMs: occurredAt,
        vendor: "salesforce",
      });
    }
  }
  return out;
};

export type CreateSalesforceCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createSalesforceCRMWebhookConfig = (
  options: CreateSalesforceCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeSalesforceWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "salesforce",
  verify: verifySalesforceWebhookSignature,
});
