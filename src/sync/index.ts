import type {
  CRMAccount,
  CRMActivity,
  CRMContact,
  CRMDeal,
  CRMEntityType,
  CRMLead,
  CRMNote,
  CRMTask,
  CRMVendor,
} from "../types";

export type CRMSyncJobKind =
  | "outbound.create"
  | "outbound.update"
  | "outbound.delete"
  | "outbound.log-activity"
  | "inbound.change"
  | "reconcile.conflict";

export type CRMSyncJobStatus =
  | "pending"
  | "in-flight"
  | "completed"
  | "failed"
  | "dead-letter"
  | "cancelled";

export type CRMSyncEntityPayload =
  | { entityType: "contact"; entity: Partial<CRMContact> }
  | { entityType: "lead"; entity: Partial<CRMLead> }
  | { entityType: "deal"; entity: Partial<CRMDeal> }
  | { entityType: "account"; entity: Partial<CRMAccount> }
  | { entityType: "activity"; entity: Partial<CRMActivity> }
  | { entityType: "note"; entity: Partial<CRMNote> }
  | { entityType: "task"; entity: Partial<CRMTask> };

export type CRMSyncJob = {
  id: string;
  userId: string;
  vendor: CRMVendor;
  kind: CRMSyncJobKind;
  idempotencyKey: string;
  payload: CRMSyncEntityPayload;
  status: CRMSyncJobStatus;
  attempts: number;
  maxAttempts: number;
  notBeforeMs: number;
  enqueuedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  lastError?: string;
  resultEntityId?: string;
};

export type CRMChangeEvent = {
  id: string;
  vendor: CRMVendor;
  userId?: string;
  // The vendor-side account/tenant the change belongs to (HubSpot portalId,
  // Salesforce instance, etc.). Essential for routing a webhook to the right
  // installer in a multi-tenant app.
  accountRef?: string;
  entityType: CRMEntityType;
  entityId: string;
  op: "create" | "update" | "delete";
  payload?: Record<string, unknown>;
  receivedAtMs: number;
  signedPayload?: string;
};

export type EnqueueCRMSyncJobInput = Omit<
  CRMSyncJob,
  "id" | "status" | "attempts" | "enqueuedAtMs" | "startedAtMs" | "completedAtMs"
> & {
  status?: CRMSyncJobStatus;
  attempts?: number;
  enqueuedAtMs?: number;
};

export type CRMSyncQueue = {
  enqueue(input: EnqueueCRMSyncJobInput): Promise<CRMSyncJob>;
  /**
   * Lease the next due `pending` job, transitioning it to `in-flight` and
   * incrementing `attempts`. When `kinds` is supplied, only jobs whose `kind`
   * is in the list are eligible — this lets independent drainers (the inbound
   * reconciler vs. the outbound worker) share one queue without stealing each
   * other's jobs. Omitting `kinds` leases any kind (back-compat).
   */
  claimNext(
    at?: number,
    kinds?: readonly CRMSyncJobKind[],
  ): Promise<CRMSyncJob | null>;
  markCompleted(jobId: string, resultEntityId?: string): Promise<void>;
  markFailed(
    jobId: string,
    error: string,
    options?: { retryAtMs?: number },
  ): Promise<void>;
  cancel(jobId: string): Promise<boolean>;
  list(filter?: {
    status?: CRMSyncJobStatus;
    vendor?: CRMVendor;
    userId?: string;
  }): Promise<CRMSyncJob[]>;
  recordChange(event: CRMChangeEvent): Promise<void>;
  subscribe?(listener: (job: CRMSyncJob) => void): () => void;
};

export { createInMemoryCRMSyncQueue } from "./inMemorySyncQueue";
export type { CreateInMemoryCRMSyncQueueOptions } from "./inMemorySyncQueue";
export { createSqliteCRMSyncQueue } from "./sqliteSyncQueue";
export type { CreateSqliteCRMSyncQueueOptions } from "./sqliteSyncQueue";
export { createRedisCRMSyncQueue } from "./redisSyncQueue";
export type {
  CreateRedisCRMSyncQueueOptions,
  RedisSortedSetClient,
} from "./redisSyncQueue";
export { createPostgresCRMSyncQueue } from "./postgresSyncQueue";
export type { CreatePostgresCRMSyncQueueOptions } from "./postgresSyncQueue";
export {
  createCRMReconciler,
  lastWriteWinsReconcileResolver,
  remoteWinsReconcileResolver,
} from "./reconciler";
export { createCRMOutboundWorker, OUTBOUND_JOB_KINDS } from "./outbound";
export type {
  CreateCRMOutboundWorkerOptions,
  CRMOutboundLocalMirror,
  CRMOutboundResult,
  CRMOutboundWorker,
  CRMOutboundWorkerEvent,
} from "./outbound";
export type {
  CreateCRMReconcilerOptions,
  CRMReconcileConflictResolution,
  CRMReconcileConflictResolver,
  CRMReconcileConflictResolverInput,
  CRMReconcileResult,
  CRMReconciler,
  CRMReconcilerEvent,
} from "./reconciler";
