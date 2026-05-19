import { createHmac } from "node:crypto";
import type { CRMChangeEvent } from "../sync";
import type { CRMEntityType } from "../types";
import { headerValue, timingSafeEqualString } from "./_webhookHelpers";
import type {
  CRMWebhookNormalizer,
  CRMWebhookSignatureVerifier,
  CRMWebhookVendorConfig,
} from "./webhookReceiver";

type GHLWebhookBody = {
  type?:
    | "ContactCreate"
    | "ContactUpdate"
    | "ContactDelete"
    | "ContactTagUpdate"
    | "OpportunityCreate"
    | "OpportunityUpdate"
    | "OpportunityDelete"
    | "OpportunityStageUpdate"
    | "InboundMessage"
    | "OutboundMessage"
    | string;
  locationId?: string;
  contactId?: string;
  opportunityId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

const TYPE_TO_ENTITY: Record<string, CRMEntityType> = {
  ContactCreate: "contact",
  ContactDelete: "contact",
  ContactTagUpdate: "contact",
  ContactUpdate: "contact",
  InboundMessage: "activity",
  OpportunityCreate: "deal",
  OpportunityDelete: "deal",
  OpportunityStageUpdate: "deal",
  OpportunityUpdate: "deal",
  OutboundMessage: "activity",
};

const typeToOp = (
  type: string | undefined,
): "create" | "update" | "delete" => {
  if (!type) return "update";
  if (type.endsWith("Create")) return "create";
  if (type.endsWith("Delete")) return "delete";
  return "update";
};

export const verifyGoHighLevelWebhookSignature: CRMWebhookSignatureVerifier = ({
  rawBody,
  headers,
  secret,
}) => {
  if (!secret) return false;
  const signature = headerValue(
    headers,
    "x-wh-signature",
    "x-ghl-signature",
  );
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualString(signature, expected);
};

export const normalizeGoHighLevelWebhookPayload: CRMWebhookNormalizer = ({
  parsed,
  receivedAtMs,
}) => {
  const body = parsed as GHLWebhookBody | undefined;
  if (!body?.type) return [];
  const entityType = TYPE_TO_ENTITY[body.type];
  if (!entityType) return [];
  const entityId =
    body.contactId ?? body.opportunityId ?? body.payload?.id ?? "";
  if (typeof entityId !== "string" || entityId.length === 0) return [];
  const occurredAt = body.timestamp
    ? new Date(body.timestamp).getTime()
    : receivedAtMs;
  return [
    {
      entityId,
      entityType,
      id: `ghl:${entityId}:${occurredAt}`,
      op: typeToOp(body.type),
      payload: body.payload ?? {},
      receivedAtMs: occurredAt,
      vendor: "gohighlevel",
    },
  ];
};

export type CreateGoHighLevelCRMWebhookConfigOptions = {
  signingSecret: string;
};

export const createGoHighLevelCRMWebhookConfig = (
  options: CreateGoHighLevelCRMWebhookConfigOptions,
): CRMWebhookVendorConfig => ({
  normalize: normalizeGoHighLevelWebhookPayload,
  signingSecret: options.signingSecret,
  vendor: "gohighlevel",
  verify: verifyGoHighLevelWebhookSignature,
});
