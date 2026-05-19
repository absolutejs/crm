import type {
  CRMAdapter,
  CRMAdapterFactory,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMVendor,
} from "./types";
import type {
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
  CRMTokenRecord,
  CRMTokenStore,
} from "./stores";
import type {
  CRMChangeEvent,
  CRMReconcileConflictResolver,
  CRMReconciler,
  CRMSyncJob,
  CRMSyncQueue,
} from "./sync";
import { createCRMReconciler } from "./sync";

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
  localEntityStore?: CRMLocalEntityStore;
  reconcileResolver?: CRMReconcileConflictResolver;
  echoSuppressionWindowMs?: number;
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

  const reconciler: CRMReconciler | null = options.localEntityStore
    ? createCRMReconciler({
        localStore: options.localEntityStore,
        syncQueue: options.syncQueue,
        ...(options.reconcileResolver !== undefined
          ? { conflictResolver: options.reconcileResolver }
          : {}),
        ...(options.echoSuppressionWindowMs !== undefined
          ? { echoSuppressionWindowMs: options.echoSuppressionWindowMs }
          : {}),
        now,
      })
    : null;

  const writeLocalEntityFromOutbound = async (
    vendor: CRMVendor,
    entityType: CRMLocalEntityRecord["entityType"],
    entityId: string,
    data: Record<string, unknown>,
  ) => {
    if (!options.localEntityStore) return;
    const record: CRMLocalEntityRecord = {
      data,
      entityId,
      entityType,
      localUpdatedAt: now(),
      origin: "app",
      vendor,
      vendorUpdatedAt: now(),
    };
    await options.localEntityStore.put(record);
  };

  return {
    adapterFor,
    async createContact(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMContact, "id" | "vendor">,
    ): Promise<CRMContact> {
      const adapter = await adapterFor(userId, vendor);
      const contact = await adapter.createContact(input);
      await writeLocalEntityFromOutbound(
        vendor,
        "contact",
        contact.id,
        contact as unknown as Record<string, unknown>,
      );
      return contact;
    },
    async createDeal(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMDeal, "id" | "vendor">,
    ): Promise<CRMDeal> {
      const adapter = await adapterFor(userId, vendor);
      const deal = await adapter.createDeal(input);
      await writeLocalEntityFromOutbound(
        vendor,
        "deal",
        deal.id,
        deal as unknown as Record<string, unknown>,
      );
      return deal;
    },
    async createLead(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMLead, "id" | "vendor">,
    ): Promise<CRMLead> {
      const adapter = await adapterFor(userId, vendor);
      const lead = await adapter.createLead(input);
      await writeLocalEntityFromOutbound(
        vendor,
        "lead",
        lead.id,
        lead as unknown as Record<string, unknown>,
      );
      return lead;
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
    get isBidirectional() {
      return options.localEntityStore !== undefined;
    },
    invalidateAdapter,
    localEntityStore: options.localEntityStore ?? null,
    async processInboundChanges(limit?: number) {
      if (!reconciler) {
        throw new Error(
          "CRM runtime is not configured for inbound sync — pass localEntityStore in createCRMRuntime options to activate bidirectional sync",
        );
      }
      return reconciler.processPending(limit);
    },
    reconciler,
    async recordInboundChange(event: CRMChangeEvent) {
      await options.syncQueue.recordChange(event);
      notifyInbound(event);
      if (reconciler) {
        await reconciler.reconcileChange(event);
      }
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
