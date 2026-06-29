import type {
  CRMAdapter,
  CRMEntityType,
  CRMVendor,
} from "../types";
import type {
  CRMSyncEntityPayload,
  CRMSyncJob,
  CRMSyncJobKind,
  CRMSyncQueue,
} from "./index";

/**
 * The set of job kinds the outbound worker is responsible for draining. The
 * inbound reconciler (`createCRMReconciler`) owns `inbound.change`; passing this
 * list to `claimNext` keeps the two drainers from stealing each other's jobs
 * when they run against the same queue.
 */
export const OUTBOUND_JOB_KINDS: readonly CRMSyncJobKind[] = [
  "outbound.create",
  "outbound.update",
  "outbound.delete",
  "outbound.log-activity",
];

/**
 * A local-mirror instruction emitted after a successful outbound write so the
 * runtime (when configured for bidirectional sync) can keep its local entity
 * store consistent. `vendor` is injected by the worker from the job.
 */
export type CRMOutboundLocalMirror =
  | {
      op: "put";
      vendor: CRMVendor;
      entityType: CRMEntityType;
      entityId: string;
      data: Record<string, unknown>;
    }
  | {
      op: "remove";
      vendor: CRMVendor;
      entityType: CRMEntityType;
      entityId: string;
    };

export type CRMOutboundResult =
  | { action: "completed"; job: CRMSyncJob; resultEntityId?: string }
  | { action: "skipped-unsupported"; job: CRMSyncJob; reason: string }
  | { action: "failed"; job: CRMSyncJob; error: string };

export type CRMOutboundWorkerEvent =
  | {
      type: "completed";
      job: CRMSyncJob;
      resultEntityId?: string;
    }
  | { type: "skipped-unsupported"; job: CRMSyncJob; reason: string }
  | { type: "failed"; job: CRMSyncJob; error: string };

export type CreateCRMOutboundWorkerOptions = {
  syncQueue: CRMSyncQueue;
  /**
   * Resolves (and caches) the vendor adapter for a given installer. The runtime
   * passes its own `adapterFor` so token refresh + per-user caching are shared.
   */
  resolveAdapter: (
    userId: string,
    vendor: CRMVendor,
  ) => Promise<CRMAdapter>;
  now?: () => number;
  /**
   * Optional hook called after a successful outbound write so the caller can
   * mirror the change into a local entity store. No-op when omitted.
   */
  mirrorLocalEntity?: (
    mirror: CRMOutboundLocalMirror,
  ) => void | Promise<void>;
};

type ExecMirror =
  | { op: "put"; entityType: CRMEntityType; entityId: string; data: Record<string, unknown> }
  | { op: "remove"; entityType: CRMEntityType; entityId: string };

type ExecResult =
  | { status: "completed"; resultEntityId?: string; mirror?: ExecMirror }
  | { status: "skipped"; reason: string };

const requireId = (
  payload: CRMSyncEntityPayload,
  kind: CRMSyncJobKind,
): string => {
  const id = payload.entity.id;
  if (!id) {
    throw new Error(
      `${kind} job for ${payload.entityType} is missing entity.id`,
    );
  }
  return id;
};

export const createCRMOutboundWorker = (
  options: CreateCRMOutboundWorkerOptions,
) => {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(event: CRMOutboundWorkerEvent) => void>();

  const emit = (event: CRMOutboundWorkerEvent) => {
    for (const listener of listeners) listener(event);
  };

  const executeCreate = async (
    adapter: CRMAdapter,
    payload: CRMSyncEntityPayload,
  ): Promise<ExecResult> => {
    switch (payload.entityType) {
      case "contact": {
        const { id: _id, vendor: _vendor, emails, phones, ...rest } =
          payload.entity;
        const created = await adapter.createContact({
          emails: emails ?? [],
          phones: phones ?? [],
          ...rest,
        });
        return {
          mirror: { data: created, entityId: created.id, entityType: "contact", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "lead": {
        if (!adapter.capabilities.supportsLeads) {
          return { reason: `${adapter.vendor} does not support leads`, status: "skipped" };
        }
        const { id: _id, vendor: _vendor, emails, phones, ...rest } =
          payload.entity;
        const created = await adapter.createLead({
          emails: emails ?? [],
          phones: phones ?? [],
          ...rest,
        });
        return {
          mirror: { data: created, entityId: created.id, entityType: "lead", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "deal": {
        const { id: _id, vendor: _vendor, title, ...rest } = payload.entity;
        const created = await adapter.createDeal({ title: title ?? "", ...rest });
        return {
          mirror: { data: created, entityId: created.id, entityType: "deal", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "account": {
        if (!adapter.capabilities.supportsAccounts) {
          return { reason: `${adapter.vendor} does not support accounts`, status: "skipped" };
        }
        const { id: _id, vendor: _vendor, name, ...rest } = payload.entity;
        const created = await adapter.createAccount({ name: name ?? "", ...rest });
        return {
          mirror: { data: created, entityId: created.id, entityType: "account", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "activity": {
        const { id: _id, vendor: _vendor, type, occurredAt, ...rest } =
          payload.entity;
        const created = await adapter.logActivity({
          occurredAt: occurredAt ?? now(),
          type: type ?? "other",
          ...rest,
        });
        return {
          mirror: { data: created, entityId: created.id, entityType: "activity", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "note": {
        const { id: _id, vendor: _vendor, body, ...rest } = payload.entity;
        const created = await adapter.addNote({ body: body ?? "", ...rest });
        return {
          mirror: { data: created, entityId: created.id, entityType: "note", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
      case "task": {
        const { id: _id, vendor: _vendor, subject, ...rest } = payload.entity;
        const created = await adapter.createTask({ subject: subject ?? "", ...rest });
        return {
          mirror: { data: created, entityId: created.id, entityType: "task", op: "put" },
          resultEntityId: created.id,
          status: "completed",
        };
      }
    }
  };

  const executeUpdate = async (
    adapter: CRMAdapter,
    payload: CRMSyncEntityPayload,
  ): Promise<ExecResult> => {
    const entityId = requireId(payload, "outbound.update");
    switch (payload.entityType) {
      case "contact": {
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateContact(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "contact", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "lead": {
        if (!adapter.capabilities.supportsLeads) {
          return { reason: `${adapter.vendor} does not support leads`, status: "skipped" };
        }
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateLead(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "lead", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "deal": {
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateDeal(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "deal", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "account": {
        if (!adapter.capabilities.supportsAccounts) {
          return { reason: `${adapter.vendor} does not support accounts`, status: "skipped" };
        }
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateAccount(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "account", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "activity": {
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateActivity(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "activity", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "note": {
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateNote(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "note", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
      case "task": {
        const { id: _id, vendor: _vendor, ...patch } = payload.entity;
        const updated = await adapter.updateTask(entityId, patch);
        return {
          mirror: { data: updated, entityId: updated.id, entityType: "task", op: "put" },
          resultEntityId: updated.id,
          status: "completed",
        };
      }
    }
  };

  const executeDelete = async (
    adapter: CRMAdapter,
    payload: CRMSyncEntityPayload,
  ): Promise<ExecResult> => {
    const entityId = requireId(payload, "outbound.delete");
    if (!adapter.capabilities.supportsDelete) {
      return { reason: `${adapter.vendor} does not support deletion`, status: "skipped" };
    }
    switch (payload.entityType) {
      case "contact":
        await adapter.deleteContact(entityId);
        return {
          mirror: { entityId, entityType: "contact", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "lead":
        await adapter.deleteLead(entityId);
        return {
          mirror: { entityId, entityType: "lead", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "deal":
        await adapter.deleteDeal(entityId);
        return {
          mirror: { entityId, entityType: "deal", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "account":
        if (!adapter.capabilities.supportsAccounts) {
          return { reason: `${adapter.vendor} does not support accounts`, status: "skipped" };
        }
        await adapter.deleteAccount(entityId);
        return {
          mirror: { entityId, entityType: "account", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "note":
        await adapter.deleteNote(entityId);
        return {
          mirror: { entityId, entityType: "note", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "task":
        await adapter.deleteTask(entityId);
        return {
          mirror: { entityId, entityType: "task", op: "remove" },
          resultEntityId: entityId,
          status: "completed",
        };
      case "activity":
        return {
          reason: "activities have no delete verb on the CRM adapter contract",
          status: "skipped",
        };
    }
  };

  const executeLogActivity = async (
    adapter: CRMAdapter,
    payload: CRMSyncEntityPayload,
  ): Promise<ExecResult> => {
    if (payload.entityType !== "activity") {
      return {
        reason: `outbound.log-activity carried entityType ${payload.entityType}; expected activity`,
        status: "skipped",
      };
    }
    const { id: _id, vendor: _vendor, type, occurredAt, ...rest } =
      payload.entity;
    const created = await adapter.logActivity({
      occurredAt: occurredAt ?? now(),
      type: type ?? "other",
      ...rest,
    });
    return {
      mirror: { data: created, entityId: created.id, entityType: "activity", op: "put" },
      resultEntityId: created.id,
      status: "completed",
    };
  };

  const execute = async (
    adapter: CRMAdapter,
    job: CRMSyncJob,
  ): Promise<ExecResult> => {
    switch (job.kind) {
      case "outbound.create":
        return executeCreate(adapter, job.payload);
      case "outbound.update":
        return executeUpdate(adapter, job.payload);
      case "outbound.delete":
        return executeDelete(adapter, job.payload);
      case "outbound.log-activity":
        return executeLogActivity(adapter, job.payload);
      default:
        return {
          reason: `outbound worker received non-outbound job kind ${job.kind}`,
          status: "skipped",
        };
    }
  };

  const applyMirror = async (
    vendor: CRMVendor,
    mirror: ExecMirror,
  ): Promise<void> => {
    if (!options.mirrorLocalEntity) return;
    if (mirror.op === "remove") {
      await options.mirrorLocalEntity({
        entityId: mirror.entityId,
        entityType: mirror.entityType,
        op: "remove",
        vendor,
      });
      return;
    }
    await options.mirrorLocalEntity({
      data: mirror.data,
      entityId: mirror.entityId,
      entityType: mirror.entityType,
      op: "put",
      vendor,
    });
  };

  const processJob = async (job: CRMSyncJob): Promise<CRMOutboundResult> => {
    try {
      const adapter = await options.resolveAdapter(job.userId, job.vendor);
      const exec = await execute(adapter, job);
      if (exec.status === "skipped") {
        await options.syncQueue.markCompleted(job.id);
        emit({ job, reason: exec.reason, type: "skipped-unsupported" });
        return { action: "skipped-unsupported", job, reason: exec.reason };
      }
      if (exec.mirror) await applyMirror(job.vendor, exec.mirror);
      await options.syncQueue.markCompleted(job.id, exec.resultEntityId);
      emit({
        job,
        type: "completed",
        ...(exec.resultEntityId !== undefined
          ? { resultEntityId: exec.resultEntityId }
          : {}),
      });
      return {
        action: "completed",
        job,
        ...(exec.resultEntityId !== undefined
          ? { resultEntityId: exec.resultEntityId }
          : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await options.syncQueue.markFailed(job.id, message);
      emit({ error: message, job, type: "failed" });
      return { action: "failed", error: message, job };
    }
  };

  const processPending = async (
    limit = 50,
  ): Promise<CRMOutboundResult[]> => {
    const out: CRMOutboundResult[] = [];
    for (let i = 0; i < limit; i += 1) {
      const job = await options.syncQueue.claimNext(now(), OUTBOUND_JOB_KINDS);
      if (!job) break;
      out.push(await processJob(job));
    }
    return out;
  };

  return {
    processPending,
    subscribe(listener: (event: CRMOutboundWorkerEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type CRMOutboundWorker = ReturnType<typeof createCRMOutboundWorker>;
