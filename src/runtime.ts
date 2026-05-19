import type {
  CRMAdapter,
  CRMAdapterFactory,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMVendor,
} from "./types";
import type { CRMTokenRecord, CRMTokenStore } from "./stores";
import type {
  CRMChangeEvent,
  CRMSyncJob,
  CRMSyncQueue,
} from "./sync";

export type CRMConflictResolution<T> =
  | { winner: "local"; entity: T }
  | { winner: "remote"; entity: T }
  | { winner: "merged"; entity: T };

export type CRMConflictResolver = <T>(input: {
  local: T;
  remote: T;
  vendor: CRMVendor;
  entityType: "contact" | "lead" | "deal" | "account";
}) => CRMConflictResolution<T> | Promise<CRMConflictResolution<T>>;

export type CRMRuntimeOptions = {
  tokenStore: CRMTokenStore;
  syncQueue: CRMSyncQueue;
  adapters: Partial<Record<CRMVendor, CRMAdapterFactory>>;
  conflictResolver?: CRMConflictResolver;
  now?: () => number;
};

export type CRMRuntimeChangeListener = (
  event:
    | { type: "outbound"; job: CRMSyncJob }
    | { type: "inbound"; change: CRMChangeEvent },
) => void;

const remoteWinsResolver: CRMConflictResolver = ({ remote }) => ({
  entity: remote,
  winner: "remote",
});

export const createCRMRuntime = (options: CRMRuntimeOptions) => {
  const now = options.now ?? (() => Date.now());
  const resolver = options.conflictResolver ?? remoteWinsResolver;
  const listeners = new Set<CRMRuntimeChangeListener>();
  const adapterCache = new Map<string, CRMAdapter>();

  const adapterKey = (userId: string, vendor: CRMVendor) =>
    `${userId}::${vendor}`;

  const adapterFor = async (
    userId: string,
    vendor: CRMVendor,
  ): Promise<CRMAdapter> => {
    const cached = adapterCache.get(adapterKey(userId, vendor));
    if (cached) return cached;
    const factory = options.adapters[vendor];
    if (!factory) {
      throw new Error(`No CRM adapter registered for vendor: ${vendor}`);
    }
    const record = await options.tokenStore.get(userId, vendor);
    if (!record) {
      throw new Error(
        `No token stored for user=${userId} vendor=${vendor}; complete OAuth flow first`,
      );
    }
    const adapter = await factory({
      accessToken: record.accessToken,
      onTokenRefresh: async (next) => {
        const updated: CRMTokenRecord = {
          ...record,
          accessToken: next.accessToken,
          updatedAt: now(),
          ...(next.refreshToken !== undefined
            ? { refreshToken: next.refreshToken }
            : {}),
          ...(next.expiresAt !== undefined
            ? { expiresAt: next.expiresAt }
            : {}),
        };
        await options.tokenStore.put(updated);
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
    });
    adapterCache.set(adapterKey(userId, vendor), adapter);
    return adapter;
  };

  const invalidateAdapter = (userId: string, vendor: CRMVendor) => {
    adapterCache.delete(adapterKey(userId, vendor));
  };

  const notifyOutbound = (job: CRMSyncJob) => {
    for (const listener of listeners) listener({ job, type: "outbound" });
  };
  const notifyInbound = (change: CRMChangeEvent) => {
    for (const listener of listeners) listener({ change, type: "inbound" });
  };

  options.syncQueue.subscribe?.((job) => {
    if (job.status === "completed" || job.status === "dead-letter") {
      notifyOutbound(job);
    }
  });

  return {
    adapterFor,
    async createContact(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMContact, "id" | "vendor">,
    ): Promise<CRMContact> {
      const adapter = await adapterFor(userId, vendor);
      const contact = await adapter.createContact(input);
      return contact;
    },
    async createDeal(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMDeal, "id" | "vendor">,
    ): Promise<CRMDeal> {
      const adapter = await adapterFor(userId, vendor);
      return adapter.createDeal(input);
    },
    async createLead(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMLead, "id" | "vendor">,
    ): Promise<CRMLead> {
      const adapter = await adapterFor(userId, vendor);
      return adapter.createLead(input);
    },
    async enqueueOutboundCreate(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMContact, "id" | "vendor">,
    ) {
      return options.syncQueue.enqueue({
        idempotencyKey: `${userId}::${vendor}::contact::${input.emails[0]?.address ?? input.phones[0]?.number ?? Math.random()}`,
        kind: "outbound.create",
        maxAttempts: 3,
        notBeforeMs: now(),
        payload: { entity: input, entityType: "contact" },
        userId,
        vendor,
      });
    },
    invalidateAdapter,
    async recordInboundChange(event: CRMChangeEvent) {
      await options.syncQueue.recordChange(event);
      notifyInbound(event);
    },
    resolver,
    subscribe(listener: CRMRuntimeChangeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncQueue: options.syncQueue,
    tokenStore: options.tokenStore,
  };
};

export type CRMRuntime = ReturnType<typeof createCRMRuntime>;
