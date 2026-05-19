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
  claimNext(at?: number): Promise<CRMSyncJob | null>;
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
