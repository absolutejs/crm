import type { SqliteLikeDatabase } from "../stores/sqliteTokenStore";
import type {
  CRMChangeEvent,
  CRMSyncJob,
  CRMSyncJobStatus,
  CRMSyncQueue,
} from "./index";

export type CreateSqliteCRMSyncQueueOptions = {
  db: SqliteLikeDatabase;
  jobsTable?: string;
  changesTable?: string;
  defaultMaxAttempts?: number;
  retryBackoffMs?: number;
  generateId?: () => string;
  now?: () => number;
};

const ensureSchema = (
  db: SqliteLikeDatabase,
  jobs: string,
  changes: string,
) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${jobs} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      not_before_ms INTEGER NOT NULL,
      enqueued_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      completed_at_ms INTEGER,
      last_error TEXT,
      result_entity_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_${jobs}_pending
      ON ${jobs}(status, not_before_ms);
    CREATE INDEX IF NOT EXISTS idx_${jobs}_vendor_user
      ON ${jobs}(vendor, user_id);
    CREATE TABLE IF NOT EXISTS ${changes} (
      id TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      user_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload_json TEXT,
      received_at_ms INTEGER NOT NULL,
      signed_payload TEXT
    );
  `);
};

type JobRow = {
  id: string;
  user_id: string;
  vendor: string;
  kind: string;
  idempotency_key: string;
  payload_json: string;
  status: string;
  attempts: number;
  max_attempts: number;
  not_before_ms: number;
  enqueued_at_ms: number;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  last_error: string | null;
  result_entity_id: string | null;
};

const rowToJob = (row: JobRow): CRMSyncJob => ({
  attempts: row.attempts,
  ...(row.completed_at_ms !== null ? { completedAtMs: row.completed_at_ms } : {}),
  enqueuedAtMs: row.enqueued_at_ms,
  id: row.id,
  idempotencyKey: row.idempotency_key,
  kind: row.kind as CRMSyncJob["kind"],
  ...(row.last_error !== null ? { lastError: row.last_error } : {}),
  maxAttempts: row.max_attempts,
  notBeforeMs: row.not_before_ms,
  payload: JSON.parse(row.payload_json) as CRMSyncJob["payload"],
  ...(row.result_entity_id !== null
    ? { resultEntityId: row.result_entity_id }
    : {}),
  ...(row.started_at_ms !== null ? { startedAtMs: row.started_at_ms } : {}),
  status: row.status as CRMSyncJobStatus,
  userId: row.user_id,
  vendor: row.vendor as CRMSyncJob["vendor"],
});

export const createSqliteCRMSyncQueue = (
  options: CreateSqliteCRMSyncQueueOptions,
): CRMSyncQueue => {
  const jobs = options.jobsTable ?? "crm_sync_jobs";
  const changes = options.changesTable ?? "crm_change_events";
  const defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
  const retryBackoff = options.retryBackoffMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const generateId =
    options.generateId ??
    (() => `job_${Math.random().toString(36).slice(2, 10)}`);
  ensureSchema(options.db, jobs, changes);

  const findByIdempotency = options.db.prepare(
    `SELECT * FROM ${jobs} WHERE idempotency_key = ?`,
  );
  const findById = options.db.prepare(
    `SELECT * FROM ${jobs} WHERE id = ?`,
  );
  const claimNextStmt = options.db.prepare(
    `SELECT * FROM ${jobs} WHERE status = 'pending' AND not_before_ms <= ?
     ORDER BY not_before_ms ASC LIMIT 1`,
  );
  const insertStmt = options.db.prepare(
    `INSERT INTO ${jobs}
     (id, user_id, vendor, kind, idempotency_key, payload_json, status,
      attempts, max_attempts, not_before_ms, enqueued_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = options.db.prepare(
    `UPDATE ${jobs} SET
      status = ?, attempts = ?, not_before_ms = ?,
      started_at_ms = ?, completed_at_ms = ?, last_error = ?,
      result_entity_id = ?
     WHERE id = ?`,
  );
  const listStmt = options.db.prepare(`SELECT * FROM ${jobs}`);
  const listByStatusStmt = options.db.prepare(
    `SELECT * FROM ${jobs} WHERE status = ?`,
  );
  const insertChangeStmt = options.db.prepare(
    `INSERT INTO ${changes}
     (id, vendor, user_id, entity_type, entity_id, op, payload_json,
      received_at_ms, signed_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const listeners = new Set<(job: CRMSyncJob) => void>();
  const notify = (job: CRMSyncJob) => {
    for (const l of listeners) l(job);
  };

  const writeJob = (job: CRMSyncJob) => {
    updateStmt.run(
      job.status,
      job.attempts,
      job.notBeforeMs,
      job.startedAtMs ?? null,
      job.completedAtMs ?? null,
      job.lastError ?? null,
      job.resultEntityId ?? null,
      job.id,
    );
    notify(job);
  };

  return {
    async cancel(jobId) {
      const row = findById.get(jobId) as JobRow | undefined;
      if (!row) return false;
      if (row.status === "completed" || row.status === "cancelled") return false;
      const job = rowToJob(row);
      job.status = "cancelled";
      writeJob(job);
      return true;
    },
    async claimNext(at = now()) {
      const row = claimNextStmt.get(at) as JobRow | undefined;
      if (!row) return null;
      const job = rowToJob(row);
      job.status = "in-flight";
      job.attempts += 1;
      job.startedAtMs = at;
      writeJob(job);
      return job;
    },
    async enqueue(input) {
      const existing = findByIdempotency.get(input.idempotencyKey) as
        | JobRow
        | undefined;
      if (existing) return rowToJob(existing);
      const at = input.enqueuedAtMs ?? now();
      const job: CRMSyncJob = {
        attempts: input.attempts ?? 0,
        enqueuedAtMs: at,
        id: generateId(),
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
        notBeforeMs: input.notBeforeMs ?? at,
        payload: input.payload,
        status: input.status ?? "pending",
        userId: input.userId,
        vendor: input.vendor,
      };
      insertStmt.run(
        job.id,
        job.userId,
        job.vendor,
        job.kind,
        job.idempotencyKey,
        JSON.stringify(job.payload),
        job.status,
        job.attempts,
        job.maxAttempts,
        job.notBeforeMs,
        job.enqueuedAtMs,
      );
      notify(job);
      return job;
    },
    async list(filter) {
      const rows = filter?.status
        ? (listByStatusStmt.all(filter.status) as JobRow[])
        : (listStmt.all() as JobRow[]);
      return rows
        .map(rowToJob)
        .filter((j) => !filter?.vendor || j.vendor === filter.vendor)
        .filter((j) => !filter?.userId || j.userId === filter.userId);
    },
    async markCompleted(jobId, resultEntityId) {
      const row = findById.get(jobId) as JobRow | undefined;
      if (!row) return;
      const job = rowToJob(row);
      job.status = "completed";
      job.completedAtMs = now();
      if (resultEntityId) job.resultEntityId = resultEntityId;
      writeJob(job);
    },
    async markFailed(jobId, error, opts) {
      const row = findById.get(jobId) as JobRow | undefined;
      if (!row) return;
      const job = rowToJob(row);
      job.lastError = error;
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead-letter";
        job.completedAtMs = now();
      } else {
        job.status = "pending";
        job.notBeforeMs = opts?.retryAtMs ?? now() + retryBackoff;
      }
      writeJob(job);
    },
    async recordChange(event: CRMChangeEvent) {
      insertChangeStmt.run(
        event.id,
        event.vendor,
        event.userId ?? null,
        event.entityType,
        event.entityId,
        event.op,
        event.payload ? JSON.stringify(event.payload) : null,
        event.receivedAtMs,
        event.signedPayload ?? null,
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
