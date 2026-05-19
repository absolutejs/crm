import type { CRMTokenRecord, CRMTokenStore } from "../stores";
import type { CRMVendor } from "../types";
import {
  DEFAULT_CRM_CONTEXT_EXTRACTORS,
  type CRMOAuthContextExtractor,
  type CRMOAuthProfileLike,
  type CRMOAuthTokenResponseLike,
} from "./contextExtractors";

export type CRMOAuthVendorConfig = {
  extractContext?: CRMOAuthContextExtractor;
};

export type CRMOAuthPersistInput = {
  userId: string;
  vendor: CRMVendor;
  tokenResponse: CRMOAuthTokenResponseLike;
  profile?: CRMOAuthProfileLike;
  scopes?: string[];
};

export type CRMOAuthHandlerOptions = {
  tokenStore: CRMTokenStore;
  vendors: Partial<Record<CRMVendor, CRMOAuthVendorConfig>>;
  now?: () => number;
};

export type CRMOAuthHandler = {
  readonly enabledVendors: CRMVendor[];
  isEnabledVendor(vendor: string): vendor is CRMVendor;
  persist(input: CRMOAuthPersistInput): Promise<CRMTokenRecord>;
  fromAbsoluteAuthCallback(input: {
    userId: string;
    authProvider: string;
    tokenResponse: CRMOAuthTokenResponseLike;
    profile?: CRMOAuthProfileLike;
  }): Promise<CRMTokenRecord | null>;
};

export const createCRMOAuthHandler = (
  options: CRMOAuthHandlerOptions,
): CRMOAuthHandler => {
  const now = options.now ?? (() => Date.now());
  const enabledVendors = Object.keys(options.vendors) as CRMVendor[];
  const enabledSet = new Set<CRMVendor>(enabledVendors);

  const extractorFor = (vendor: CRMVendor): CRMOAuthContextExtractor => {
    const override = options.vendors[vendor]?.extractContext;
    return override ?? DEFAULT_CRM_CONTEXT_EXTRACTORS[vendor];
  };

  const persist = async (
    input: CRMOAuthPersistInput,
  ): Promise<CRMTokenRecord> => {
    const at = now();
    const context = extractorFor(input.vendor)({
      profile: input.profile ?? {},
      tokenResponse: input.tokenResponse,
    });
    const record: CRMTokenRecord = {
      accessToken: input.tokenResponse.access_token,
      createdAt: at,
      updatedAt: at,
      userId: input.userId,
      vendor: input.vendor,
      ...(input.tokenResponse.refresh_token !== undefined
        ? { refreshToken: input.tokenResponse.refresh_token }
        : {}),
      ...(input.tokenResponse.expires_in !== undefined
        ? { expiresAt: at + input.tokenResponse.expires_in * 1000 }
        : {}),
      ...(input.scopes
        ? { scopes: input.scopes }
        : input.tokenResponse.scope
          ? { scopes: input.tokenResponse.scope.split(" ").filter(Boolean) }
          : {}),
      ...(Object.keys(context).length > 0 ? { context } : {}),
    };
    await options.tokenStore.put(record);
    return record;
  };

  return {
    enabledVendors,
    async fromAbsoluteAuthCallback({ userId, authProvider, tokenResponse, profile }) {
      if (!enabledSet.has(authProvider as CRMVendor)) return null;
      return persist({
        profile,
        tokenResponse,
        userId,
        vendor: authProvider as CRMVendor,
      });
    },
    isEnabledVendor(vendor: string): vendor is CRMVendor {
      return enabledSet.has(vendor as CRMVendor);
    },
    persist,
  };
};
