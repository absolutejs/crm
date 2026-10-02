import { verifyHubSpotWebhookV3Signature } from "./hubspotWebhook";

export type HubSpotAppContext = {
  appId: string;
  portalId: string;
  userId: string;
};

/** Call with the configured public origin, not untrusted forwarded headers. */
export const verifyHubSpotAppRequest = async (input: {
  url: string;
  method: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret: string;
  appId: string;
}): Promise<HubSpotAppContext | null> => {
  const url = new URL(input.url);
  const id = (key: string) => {
    const values = url.searchParams.getAll(key);
    return values.length === 1 && /^[1-9]\d*$/.test(values[0] ?? "")
      ? values[0]!
      : null;
  };
  const appId = id("appId"),
    portalId = id("portalId"),
    userId = id("userId");
  if (!appId || appId !== input.appId || !portalId || !userId) return null;
  const valid = await verifyHubSpotWebhookV3Signature({
    rawBody: input.rawBody,
    secret: input.secret,
    headers: {
      ...input.headers,
      "x-hubspot-request-method": input.method,
      "x-hubspot-request-uri": input.url,
    },
  });
  return valid ? { appId, portalId, userId } : null;
};

/** Uninstall before erasing credentials. Revocation by itself does not uninstall. */
export const uninstallHubSpotApp = async (input: {
  accessToken: string;
  fetch?: typeof fetch;
}) => {
  const response = await (input.fetch ?? fetch)(
    "https://api.hubapi.com/appinstalls/2026-09/external-install",
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 204)
    throw new Error(`HubSpot uninstall failed (${response.status})`);
};
