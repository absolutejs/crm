import type { CRMChangeEvent } from "../sync";
import type { CRMVendor } from "../types";

export type CRMWebhookSignatureVerifier = (input: {
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret?: string;
}) => boolean | Promise<boolean>;

export type CRMWebhookNormalizer = (input: {
  rawBody: string;
  headers: Record<string, string | undefined>;
  parsed: unknown;
  receivedAtMs: number;
}) => CRMChangeEvent[] | Promise<CRMChangeEvent[]>;

export type CRMWebhookVendorConfig = {
  vendor: CRMVendor;
  verify: CRMWebhookSignatureVerifier;
  normalize: CRMWebhookNormalizer;
  signingSecret?: string;
};

export type CRMWebhookReceiverOptions = {
  vendors: CRMWebhookVendorConfig[];
  onChangeEvent: (event: CRMChangeEvent) => void | Promise<void>;
  onVerificationFailed?: (input: {
    vendor: CRMVendor;
    rawBody: string;
    headers: Record<string, string | undefined>;
  }) => void | Promise<void>;
  now?: () => number;
};

export type CRMWebhookInvocation = {
  vendor: CRMVendor;
  rawBody: string;
  headers: Record<string, string | undefined>;
};

export type CRMWebhookHandleResult =
  | { ok: true; events: CRMChangeEvent[] }
  | { ok: false; reason: "unknown-vendor" | "signature-invalid" | "parse-error" };

export const createCRMWebhookReceiver = (
  options: CRMWebhookReceiverOptions,
) => {
  const byVendor = new Map<CRMVendor, CRMWebhookVendorConfig>();
  for (const cfg of options.vendors) byVendor.set(cfg.vendor, cfg);
  const now = options.now ?? (() => Date.now());

  const handle = async (
    invocation: CRMWebhookInvocation,
  ): Promise<CRMWebhookHandleResult> => {
    const cfg = byVendor.get(invocation.vendor);
    if (!cfg) return { ok: false, reason: "unknown-vendor" };
    const verified = await cfg.verify({
      headers: invocation.headers,
      rawBody: invocation.rawBody,
      ...(cfg.signingSecret !== undefined ? { secret: cfg.signingSecret } : {}),
    });
    if (!verified) {
      await options.onVerificationFailed?.({
        headers: invocation.headers,
        rawBody: invocation.rawBody,
        vendor: invocation.vendor,
      });
      return { ok: false, reason: "signature-invalid" };
    }
    let parsed: unknown;
    try {
      parsed = invocation.rawBody.length > 0 ? JSON.parse(invocation.rawBody) : null;
    } catch {
      return { ok: false, reason: "parse-error" };
    }
    const events = await cfg.normalize({
      headers: invocation.headers,
      parsed,
      rawBody: invocation.rawBody,
      receivedAtMs: now(),
    });
    for (const event of events) {
      await options.onChangeEvent(event);
    }
    return { events, ok: true };
  };

  return {
    handle,
    register(config: CRMWebhookVendorConfig) {
      byVendor.set(config.vendor, config);
    },
    vendors: () => Array.from(byVendor.keys()),
  };
};

export type CRMWebhookReceiver = ReturnType<typeof createCRMWebhookReceiver>;

export const createPermissiveCRMWebhookVerifier =
  (): CRMWebhookSignatureVerifier =>
  () =>
    true;
