import type {
  CRMOAuthContextExtractor,
  CRMOAuthTokenResponseLike,
} from "./contextExtractors";
import { DEFAULT_CRM_CONTEXT_EXTRACTORS } from "./contextExtractors";
import type {
  CRMRefreshOAuth,
  CRMRefreshedToken,
} from "./getCRMAdapterForUser";
import type { CRMVendor } from "../types";

export type CRMCitraOAuth2ClientLike = {
  refreshAccessToken(
    refreshToken: string,
  ): Promise<CRMOAuthTokenResponseLike>;
};

const refreshedTokenFromResponse = (
  response: CRMOAuthTokenResponseLike,
  fallbackRefreshToken: string,
  extractor?: CRMOAuthContextExtractor,
  now: () => number = () => Date.now(),
): CRMRefreshedToken => {
  const expiresAt =
    response.expires_in !== undefined
      ? now() + response.expires_in * 1000
      : undefined;
  const refreshToken = response.refresh_token ?? fallbackRefreshToken;
  const context = extractor
    ? extractor({ profile: {}, tokenResponse: response })
    : undefined;
  const result: CRMRefreshedToken = {
    accessToken: response.access_token,
    refreshToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
  return result;
};

export type CreateSingleVendorRefreshOAuthOptions = {
  client: CRMCitraOAuth2ClientLike;
  extractContext?: CRMOAuthContextExtractor;
  now?: () => number;
};

const buildVendorRefresh =
  (
  vendor: CRMVendor,
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth =>
  async ({ refreshToken }) => {
    const response = await options.client.refreshAccessToken(refreshToken);
    const extractor =
      options.extractContext ?? DEFAULT_CRM_CONTEXT_EXTRACTORS[vendor];
    return refreshedTokenFromResponse(
      response,
      refreshToken,
      extractor,
      options.now,
    );
  };

export const createSalesforceCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("salesforce", options);

export const createHubSpotCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("hubspot", options);

export const createPipedriveCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("pipedrive", options);

export const createZohoCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("zoho", options);

export const createAttioCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("attio", options);

export const createCloseCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("close", options);

export const createMondayCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("monday", options);

export const createGoHighLevelCRMRefreshOAuth = (
  options: CreateSingleVendorRefreshOAuthOptions,
): CRMRefreshOAuth => buildVendorRefresh("gohighlevel", options);

export type CRMMultiVendorRefreshOptions = {
  vendors: Partial<
    Record<CRMVendor, CreateSingleVendorRefreshOAuthOptions>
  >;
  now?: () => number;
};

export const createCRMRefreshOAuth = (
  options: CRMMultiVendorRefreshOptions,
): CRMRefreshOAuth => {
  const perVendor = new Map<CRMVendor, CRMRefreshOAuth>();
  for (const [vendor, opts] of Object.entries(options.vendors)) {
    if (!opts) continue;
    const merged: CreateSingleVendorRefreshOAuthOptions = {
      ...opts,
      ...(options.now !== undefined ? { now: opts.now ?? options.now } : {}),
    };
    perVendor.set(
      vendor as CRMVendor,
      buildVendorRefresh(vendor as CRMVendor, merged),
    );
  }
  return async (input) => {
    const handler = perVendor.get(input.vendor);
    if (!handler) {
      throw new Error(
        `No CRM OAuth refresh helper configured for vendor: ${input.vendor}`,
      );
    }
    return handler(input);
  };
};
