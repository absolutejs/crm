import type { CRMVendorTokenContext } from "../stores";
import type { CRMVendor } from "../types";

export type CRMOAuthTokenResponseLike = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
} & Record<string, unknown>;

export type CRMOAuthProfileLike = Record<string, unknown>;

export type CRMOAuthContextExtractor = (input: {
  tokenResponse: CRMOAuthTokenResponseLike;
  profile: CRMOAuthProfileLike;
}) => CRMVendorTokenContext;

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const extractSalesforce: CRMOAuthContextExtractor = ({ tokenResponse, profile }) => {
  const instanceUrl =
    stringOrUndefined(tokenResponse.instance_url) ??
    stringOrUndefined(
      (profile.urls as { rest?: string } | undefined)?.rest,
    )?.replace(/\/services\/data\/.*$/u, "");
  return {
    ...(instanceUrl !== undefined ? { instanceUrl } : {}),
  };
};

const extractHubSpot: CRMOAuthContextExtractor = ({ profile }) => {
  const hubId =
    profile.hub_id !== undefined && profile.hub_id !== null
      ? String(profile.hub_id)
      : undefined;
  return {
    ...(hubId !== undefined ? { subAccountId: hubId } : {}),
  };
};

const extractPipedrive: CRMOAuthContextExtractor = ({ tokenResponse }) => {
  const apiDomain = stringOrUndefined(tokenResponse.api_domain);
  return {
    ...(apiDomain !== undefined ? { apiDomain } : {}),
  };
};

const extractZoho: CRMOAuthContextExtractor = ({ tokenResponse }) => {
  const region =
    stringOrUndefined(tokenResponse.region) ??
    stringOrUndefined(tokenResponse.location);
  const apiDomain = stringOrUndefined(tokenResponse.api_domain);
  return {
    ...(region !== undefined ? { region } : {}),
    ...(apiDomain !== undefined ? { apiDomain } : {}),
  };
};

const extractGoHighLevel: CRMOAuthContextExtractor = ({ tokenResponse, profile }) => {
  const locationId =
    stringOrUndefined(tokenResponse.locationId) ??
    stringOrUndefined(profile.locationId);
  const companyId =
    stringOrUndefined(tokenResponse.companyId) ??
    stringOrUndefined(profile.companyId);
  return {
    ...(locationId !== undefined ? { subAccountId: locationId } : {}),
    ...(companyId !== undefined ? { region: companyId } : {}),
  };
};

const noopExtractor: CRMOAuthContextExtractor = () => ({});

export const DEFAULT_CRM_CONTEXT_EXTRACTORS: Record<
  CRMVendor,
  CRMOAuthContextExtractor
> = {
  attio: noopExtractor,
  close: noopExtractor,
  gohighlevel: extractGoHighLevel,
  hubspot: extractHubSpot,
  monday: noopExtractor,
  pipedrive: extractPipedrive,
  salesforce: extractSalesforce,
  zoho: extractZoho,
};
