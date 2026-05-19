import type {
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
} from "../stores";
import type { CRMEntityType, CRMVendor } from "../types";
import type { CRMChangeEvent, CRMSyncJob, CRMSyncQueue } from "./index";

export type CRMReconcileConflictResolution = {
  winner: "local" | "remote" | "merged";
  resolved: Record<string, unknown>;
  rationale?: string;
};

export type CRMReconcileConflictResolverInput = {
  vendor: CRMVendor;
  entityType: CRMEntityType;
  entityId: string;
  local: CRMLocalEntityRecord | null;
  remote: { data: Record<string, unknown>; receivedAtMs: number };
};

export type CRMReconcileConflictResolver = (
  input: CRMReconcileConflictResolverInput,
) =>
  | CRMReconcileConflictResolution
  | Promise<CRMReconcileConflictResolution>;

export const remoteWinsReconcileResolver: CRMReconcileConflictResolver = ({
  remote,
}) => ({
  rationale: "remote-wins default policy",
  resolved: remote.data,
  winner: "remote",
});

export const lastWriteWinsReconcileResolver: CRMReconcileConflictResolver = ({
  local,
  remote,
}) => {
  const localTs = local?.vendorUpdatedAt ?? local?.localUpdatedAt ?? 0;
  if (localTs > remote.receivedAtMs) {
    return {
      rationale: `local wrote at ${localTs} which is newer than remote ${remote.receivedAtMs}`,
      resolved: local?.data ?? {},
      winner: "local",
    };
  }
  return {
    rationale: `remote received at ${remote.receivedAtMs} is newer`,
    resolved: remote.data,
    winner: "remote",
  };
};

export type CRMReconcileResult =
  | {
      action: "applied";
      record: CRMLocalEntityRecord;
      resolution: CRMReconcileConflictResolution;
    }
  | {
      action: "skipped-echo";
      reason: string;
    }
  | {
      action: "deleted";
      vendor: CRMVendor;
      entityType: CRMEntityType;
      entityId: string;
    };

export type CRMReconcilerEvent =
  | { type: "applied"; result: Extract<CRMReconcileResult, { action: "applied" }> }
  | { type: "skipped-echo"; entityId: string; reason: string }
  | { type: "deleted"; entityId: string; vendor: CRMVendor };

export type CreateCRMReconcilerOptions = {
  localStore: CRMLocalEntityStore;
  syncQueue: CRMSyncQueue;
  conflictResolver?: CRMReconcileConflictResolver;
  echoSuppressionWindowMs?: number;
  now?: () => number;
};

export const createCRMReconciler = (
  options: CreateCRMReconcilerOptions,
) => {
  const now = options.now ?? (() => Date.now());
  const resolver = options.conflictResolver ?? remoteWinsReconcileResolver;
  const echoWindow = options.echoSuppressionWindowMs ?? 5_000;
  const listeners = new Set<(event: CRMReconcilerEvent) => void>();

  const emit = (event: CRMReconcilerEvent) => {
    for (const listener of listeners) listener(event);
  };

  const reconcileChange = async (
    event: CRMChangeEvent,
  ): Promise<CRMReconcileResult> => {
    if (event.op === "delete") {
      await options.localStore.remove(
        event.vendor,
        event.entityType,
        event.entityId,
      );
      emit({ entityId: event.entityId, type: "deleted", vendor: event.vendor });
      return {
        action: "deleted",
        entityId: event.entityId,
        entityType: event.entityType,
        vendor: event.vendor,
      };
    }

    const local = await options.localStore.get(
      event.vendor,
      event.entityType,
      event.entityId,
    );

    if (
      local &&
      local.origin === "app" &&
      now() - local.localUpdatedAt <= echoWindow
    ) {
      const reason = `local wrote ${now() - local.localUpdatedAt}ms ago (≤ echo window ${echoWindow}ms)`;
      emit({ entityId: event.entityId, reason, type: "skipped-echo" });
      return { action: "skipped-echo", reason };
    }

    const resolution = await resolver({
      entityId: event.entityId,
      entityType: event.entityType,
      local,
      remote: {
        data: event.payload ?? {},
        receivedAtMs: event.receivedAtMs,
      },
      vendor: event.vendor,
    });

    const next: CRMLocalEntityRecord = {
      data: resolution.resolved,
      entityId: event.entityId,
      entityType: event.entityType,
      lastReconciledAt: now(),
      localUpdatedAt: now(),
      origin: "reconciled",
      vendor: event.vendor,
      vendorUpdatedAt: event.receivedAtMs,
    };
    await options.localStore.put(next);
    const stored = await options.localStore.get(
      event.vendor,
      event.entityType,
      event.entityId,
    );
    const result: Extract<CRMReconcileResult, { action: "applied" }> = {
      action: "applied",
      record: stored ?? next,
      resolution,
    };
    emit({ result, type: "applied" });
    return result;
  };

  const processPending = async (limit = 50): Promise<CRMReconcileResult[]> => {
    const jobs = await options.syncQueue.list({ status: "pending" });
    const inboundJobs = jobs
      .filter((j) => j.kind === "inbound.change")
      .slice(0, limit);
    const out: CRMReconcileResult[] = [];
    for (const job of inboundJobs) {
      const change = jobToChangeEvent(job);
      if (!change) continue;
      const result = await reconcileChange(change);
      await options.syncQueue.markCompleted(job.id);
      out.push(result);
    }
    return out;
  };

  return {
    processPending,
    reconcileChange,
    subscribe(listener: (event: CRMReconcilerEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const jobToChangeEvent = (job: CRMSyncJob): CRMChangeEvent | null => {
  if (job.kind !== "inbound.change") return null;
  return {
    entityId: job.resultEntityId ?? job.idempotencyKey.split("::").at(-1) ?? "",
    entityType: job.payload.entityType,
    id: job.id,
    op: "update",
    payload: job.payload.entity as Record<string, unknown>,
    receivedAtMs: job.enqueuedAtMs,
    vendor: job.vendor,
    ...(job.userId ? { userId: job.userId } : {}),
  };
};

export type CRMReconciler = ReturnType<typeof createCRMReconciler>;
