import type {
  CRMAccount,
  CRMActivity,
  CRMAdapter,
  CRMAdapterFactory,
  CRMContact,
  CRMDeal,
  CRMEntityType,
  CRMLead,
  CRMListOptions,
  CRMListResult,
  CRMNote,
  CRMPipeline,
  CRMTask,
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
  CRMOutboundLocalMirror,
  CRMReconcileConflictResolver,
  CRMReconciler,
  CRMSyncEntityPayload,
  CRMSyncJob,
  CRMSyncQueue,
} from "./sync";
import { createCRMOutboundWorker, createCRMReconciler } from "./sync";

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
    entityType: CRMEntityType,
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

  const removeLocalEntity = async (
    vendor: CRMVendor,
    entityType: CRMEntityType,
    entityId: string,
  ) => {
    if (!options.localEntityStore) return;
    await options.localEntityStore.remove(vendor, entityType, entityId);
  };

  const mirrorLocalEntity = async (mirror: CRMOutboundLocalMirror) => {
    if (mirror.op === "remove") {
      await removeLocalEntity(mirror.vendor, mirror.entityType, mirror.entityId);
      return;
    }
    await writeLocalEntityFromOutbound(
      mirror.vendor,
      mirror.entityType,
      mirror.entityId,
      mirror.data,
    );
  };

  const outboundWorker = createCRMOutboundWorker({
    mirrorLocalEntity,
    now,
    resolveAdapter: adapterFor,
    syncQueue: options.syncQueue,
  });

  // Build a correctly-narrowed delete payload (entity carries only the id) for
  // the outbound queue without resorting to a cast.
  const deletePayload = (
    entityType: CRMEntityType,
    entityId: string,
  ): CRMSyncEntityPayload => {
    switch (entityType) {
      case "contact":
        return { entity: { id: entityId }, entityType: "contact" };
      case "lead":
        return { entity: { id: entityId }, entityType: "lead" };
      case "deal":
        return { entity: { id: entityId }, entityType: "deal" };
      case "account":
        return { entity: { id: entityId }, entityType: "account" };
      case "activity":
        return { entity: { id: entityId }, entityType: "activity" };
      case "note":
        return { entity: { id: entityId }, entityType: "note" };
      case "task":
        return { entity: { id: entityId }, entityType: "task" };
    }
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
      await writeLocalEntityFromOutbound(vendor, "contact", contact.id, contact);
      return contact;
    },
    async createDeal(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMDeal, "id" | "vendor">,
    ): Promise<CRMDeal> {
      const adapter = await adapterFor(userId, vendor);
      const deal = await adapter.createDeal(input);
      await writeLocalEntityFromOutbound(vendor, "deal", deal.id, deal);
      return deal;
    },
    async createLead(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMLead, "id" | "vendor">,
    ): Promise<CRMLead> {
      const adapter = await adapterFor(userId, vendor);
      const lead = await adapter.createLead(input);
      await writeLocalEntityFromOutbound(vendor, "lead", lead.id, lead);
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
    async enqueueOutboundUpdate(
      userId: string,
      vendor: CRMVendor,
      payload: CRMSyncEntityPayload,
      enqueueOptions?: { idempotencyKey?: string; maxAttempts?: number },
    ) {
      const entityId = payload.entity.id;
      return options.syncQueue.enqueue({
        idempotencyKey:
          enqueueOptions?.idempotencyKey ??
          `${userId}::${vendor}::${payload.entityType}::update::${entityId ?? Math.random()}::${now()}`,
        kind: "outbound.update",
        maxAttempts: enqueueOptions?.maxAttempts ?? 3,
        notBeforeMs: now(),
        payload,
        userId,
        vendor,
      });
    },
    async enqueueOutboundDelete(
      userId: string,
      vendor: CRMVendor,
      entityType: CRMEntityType,
      entityId: string,
      enqueueOptions?: { idempotencyKey?: string; maxAttempts?: number },
    ) {
      return options.syncQueue.enqueue({
        idempotencyKey:
          enqueueOptions?.idempotencyKey ??
          `${userId}::${vendor}::${entityType}::delete::${entityId}`,
        kind: "outbound.delete",
        maxAttempts: enqueueOptions?.maxAttempts ?? 3,
        notBeforeMs: now(),
        payload: deletePayload(entityType, entityId),
        userId,
        vendor,
      });
    },
    async enqueueOutboundLogActivity(
      userId: string,
      vendor: CRMVendor,
      activity: Omit<CRMActivity, "id" | "vendor">,
      enqueueOptions?: { idempotencyKey?: string; maxAttempts?: number },
    ) {
      return options.syncQueue.enqueue({
        idempotencyKey:
          enqueueOptions?.idempotencyKey ??
          `${userId}::${vendor}::activity::${now()}::${Math.random()}`,
        kind: "outbound.log-activity",
        maxAttempts: enqueueOptions?.maxAttempts ?? 3,
        notBeforeMs: now(),
        payload: { entity: activity, entityType: "activity" },
        userId,
        vendor,
      });
    },
    outboundWorker,
    async processOutboundJobs(limit?: number) {
      return outboundWorker.processPending(limit);
    },

    // --- Contacts (read / search / update / delete) ---
    async getContact(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMContact | null> {
      return (await adapterFor(userId, vendor)).getContact(id);
    },
    async listContacts(
      userId: string,
      vendor: CRMVendor,
      opts?: CRMListOptions,
    ): Promise<CRMListResult<CRMContact>> {
      return (await adapterFor(userId, vendor)).listContacts(opts);
    },
    async searchContacts(
      userId: string,
      vendor: CRMVendor,
      query: string,
      limit?: number,
    ): Promise<CRMContact[]> {
      return (await adapterFor(userId, vendor)).searchContacts(query, limit);
    },
    async lookupContactByEmail(
      userId: string,
      vendor: CRMVendor,
      email: string,
    ): Promise<CRMContact | null> {
      return (await adapterFor(userId, vendor)).lookupContactByEmail(email);
    },
    async lookupContactByPhone(
      userId: string,
      vendor: CRMVendor,
      phone: string,
    ): Promise<CRMContact | null> {
      return (await adapterFor(userId, vendor)).lookupContactByPhone(phone);
    },
    async updateContact(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMContact, "id" | "vendor">>,
    ): Promise<CRMContact> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateContact(id, patch);
      await writeLocalEntityFromOutbound(vendor, "contact", updated.id, updated);
      return updated;
    },
    async deleteContact(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteContact(id);
      await removeLocalEntity(vendor, "contact", id);
    },

    // --- Leads (read / update / delete / convert) ---
    async getLead(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMLead | null> {
      return (await adapterFor(userId, vendor)).getLead(id);
    },
    async listLeads(
      userId: string,
      vendor: CRMVendor,
      opts?: CRMListOptions,
    ): Promise<CRMListResult<CRMLead>> {
      return (await adapterFor(userId, vendor)).listLeads(opts);
    },
    async updateLead(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMLead, "id" | "vendor">>,
    ): Promise<CRMLead> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateLead(id, patch);
      await writeLocalEntityFromOutbound(vendor, "lead", updated.id, updated);
      return updated;
    },
    async deleteLead(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteLead(id);
      await removeLocalEntity(vendor, "lead", id);
    },
    async convertLead(
      userId: string,
      vendor: CRMVendor,
      leadId: string,
      conversionOptions?: { dealAmount?: number; dealTitle?: string },
    ): Promise<{ contact: CRMContact; deal?: CRMDeal }> {
      const adapter = await adapterFor(userId, vendor);
      if (!adapter.convertLead) {
        throw new Error(
          `${vendor} adapter does not support lead conversion (capabilities.supportsLeadConversion is false)`,
        );
      }
      return adapter.convertLead(leadId, conversionOptions);
    },

    // --- Deals (read / update / delete) ---
    async getDeal(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMDeal | null> {
      return (await adapterFor(userId, vendor)).getDeal(id);
    },
    async listDeals(
      userId: string,
      vendor: CRMVendor,
      opts?: CRMListOptions,
    ): Promise<CRMListResult<CRMDeal>> {
      return (await adapterFor(userId, vendor)).listDeals(opts);
    },
    async updateDeal(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMDeal, "id" | "vendor">>,
    ): Promise<CRMDeal> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateDeal(id, patch);
      await writeLocalEntityFromOutbound(vendor, "deal", updated.id, updated);
      return updated;
    },
    async deleteDeal(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteDeal(id);
      await removeLocalEntity(vendor, "deal", id);
    },

    // --- Accounts (full CRUD) ---
    async getAccount(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMAccount | null> {
      return (await adapterFor(userId, vendor)).getAccount(id);
    },
    async listAccounts(
      userId: string,
      vendor: CRMVendor,
      opts?: CRMListOptions,
    ): Promise<CRMListResult<CRMAccount>> {
      return (await adapterFor(userId, vendor)).listAccounts(opts);
    },
    async createAccount(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMAccount, "id" | "vendor">,
    ): Promise<CRMAccount> {
      const created = await (await adapterFor(userId, vendor)).createAccount(
        input,
      );
      await writeLocalEntityFromOutbound(vendor, "account", created.id, created);
      return created;
    },
    async updateAccount(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMAccount, "id" | "vendor">>,
    ): Promise<CRMAccount> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateAccount(id, patch);
      await writeLocalEntityFromOutbound(vendor, "account", updated.id, updated);
      return updated;
    },
    async deleteAccount(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteAccount(id);
      await removeLocalEntity(vendor, "account", id);
    },

    // --- Activities ---
    async getActivity(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMActivity | null> {
      return (await adapterFor(userId, vendor)).getActivity(id);
    },
    async logActivity(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMActivity, "id" | "vendor">,
    ): Promise<CRMActivity> {
      const created = await (await adapterFor(userId, vendor)).logActivity(
        input,
      );
      await writeLocalEntityFromOutbound(
        vendor,
        "activity",
        created.id,
        created,
      );
      return created;
    },
    async updateActivity(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMActivity, "id" | "vendor">>,
    ): Promise<CRMActivity> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateActivity(id, patch);
      await writeLocalEntityFromOutbound(
        vendor,
        "activity",
        updated.id,
        updated,
      );
      return updated;
    },

    // --- Notes ---
    async getNote(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMNote | null> {
      return (await adapterFor(userId, vendor)).getNote(id);
    },
    async addNote(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMNote, "id" | "vendor">,
    ): Promise<CRMNote> {
      const created = await (await adapterFor(userId, vendor)).addNote(input);
      await writeLocalEntityFromOutbound(vendor, "note", created.id, created);
      return created;
    },
    async updateNote(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMNote, "id" | "vendor">>,
    ): Promise<CRMNote> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateNote(id, patch);
      await writeLocalEntityFromOutbound(vendor, "note", updated.id, updated);
      return updated;
    },
    async deleteNote(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteNote(id);
      await removeLocalEntity(vendor, "note", id);
    },

    // --- Tasks ---
    async getTask(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMTask | null> {
      return (await adapterFor(userId, vendor)).getTask(id);
    },
    async createTask(
      userId: string,
      vendor: CRMVendor,
      input: Omit<CRMTask, "id" | "vendor">,
    ): Promise<CRMTask> {
      const created = await (await adapterFor(userId, vendor)).createTask(input);
      await writeLocalEntityFromOutbound(vendor, "task", created.id, created);
      return created;
    },
    async updateTask(
      userId: string,
      vendor: CRMVendor,
      id: string,
      patch: Partial<Omit<CRMTask, "id" | "vendor">>,
    ): Promise<CRMTask> {
      const updated = await (
        await adapterFor(userId, vendor)
      ).updateTask(id, patch);
      await writeLocalEntityFromOutbound(vendor, "task", updated.id, updated);
      return updated;
    },
    async deleteTask(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<void> {
      await (await adapterFor(userId, vendor)).deleteTask(id);
      await removeLocalEntity(vendor, "task", id);
    },

    // --- Pipelines ---
    async getPipeline(
      userId: string,
      vendor: CRMVendor,
      id: string,
    ): Promise<CRMPipeline | null> {
      return (await adapterFor(userId, vendor)).getPipeline(id);
    },
    async listPipelines(
      userId: string,
      vendor: CRMVendor,
    ): Promise<CRMPipeline[]> {
      return (await adapterFor(userId, vendor)).listPipelines();
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
