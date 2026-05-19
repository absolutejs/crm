import type { CRMTokenStore, CRMTokenRecord } from "../stores";
import type {
  CRMAdapter,
  CRMAdapterFactory,
  CRMAdapterFactoryInput,
  CRMVendor,
} from "../types";

export type CRMRefreshOAuthInput = {
  vendor: CRMVendor;
  refreshToken: string;
  currentRecord: CRMTokenRecord;
};

export type CRMRefreshedToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type CRMRefreshOAuth = (
  input: CRMRefreshOAuthInput,
) => Promise<CRMRefreshedToken>;

export type GetCRMAdapterForUserOptions = {
  userId: string;
  vendor: CRMVendor;
  tokenStore: CRMTokenStore;
  adapters: Partial<Record<CRMVendor, CRMAdapterFactory>>;
  refreshOAuth?: CRMRefreshOAuth;
  refreshSkewMs?: number;
  now?: () => number;
};

export const getCRMAdapterForUser = async (
  options: GetCRMAdapterForUserOptions,
): Promise<CRMAdapter> => {
  const now = options.now ?? (() => Date.now());
  const skew = options.refreshSkewMs ?? 60_000;
  const factory = options.adapters[options.vendor];
  if (!factory) {
    throw new Error(
      `No CRM adapter registered for vendor: ${options.vendor}`,
    );
  }
  const initial = await options.tokenStore.get(
    options.userId,
    options.vendor,
  );
  if (!initial) {
    throw new Error(
      `No token stored for user=${options.userId} vendor=${options.vendor}; complete OAuth flow first`,
    );
  }
  let record: CRMTokenRecord = initial;

  const needsRefresh =
    record.expiresAt !== undefined &&
    record.expiresAt - skew <= now() &&
    record.refreshToken !== undefined &&
    options.refreshOAuth !== undefined;

  if (needsRefresh && options.refreshOAuth && record.refreshToken) {
    const refreshed = await options.refreshOAuth({
      currentRecord: record,
      refreshToken: record.refreshToken,
      vendor: options.vendor,
    });
    record = {
      ...record,
      accessToken: refreshed.accessToken,
      updatedAt: now(),
      ...(refreshed.refreshToken !== undefined
        ? { refreshToken: refreshed.refreshToken }
        : {}),
      ...(refreshed.expiresAt !== undefined
        ? { expiresAt: refreshed.expiresAt }
        : {}),
    };
    await options.tokenStore.put(record);
  }

  const factoryInput: CRMAdapterFactoryInput = {
    accessToken: record.accessToken,
    onTokenRefresh: async (next) => {
      const current = record;
      const updated: CRMTokenRecord = {
        accessToken: next.accessToken,
        createdAt: current.createdAt,
        updatedAt: now(),
        userId: current.userId,
        vendor: current.vendor,
        ...(current.context !== undefined ? { context: current.context } : {}),
        ...(current.scopes !== undefined ? { scopes: current.scopes } : {}),
        ...(next.refreshToken !== undefined
          ? { refreshToken: next.refreshToken }
          : current.refreshToken !== undefined
            ? { refreshToken: current.refreshToken }
            : {}),
        ...(next.expiresAt !== undefined
          ? { expiresAt: next.expiresAt }
          : current.expiresAt !== undefined
            ? { expiresAt: current.expiresAt }
            : {}),
      };
      await options.tokenStore.put(updated);
      record = updated;
    },
    ...(record.refreshToken !== undefined
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(record.expiresAt !== undefined
      ? { expiresAt: record.expiresAt }
      : {}),
    ...(record.context?.instanceUrl !== undefined
      ? { instanceUrl: record.context.instanceUrl }
      : {}),
    ...(record.context?.apiDomain !== undefined
      ? { apiDomain: record.context.apiDomain }
      : {}),
    ...(record.context?.region !== undefined
      ? { region: record.context.region }
      : {}),
    ...(record.context?.subAccountId !== undefined
      ? { subAccountId: record.context.subAccountId }
      : {}),
  };
  return factory(factoryInput);
};
