import type { PostgresQueryRunner } from "../stores/postgresTokenStore";
import type {
  CRMChangeEvent,
  CRMSyncJob,
  CRMSyncJobStatus,
  CRMSyncQueue,
} from "./index";

export type CreatePostgresCRMSyncQueueOptions = {
  query: PostgresQueryRunner;
  jobsTable?: string;
  changesTable?: string;
  defaultMaxAttempts?: number;
  retryBackoffMs?: number;
  generateId?: () => string;
  now?: () => number;
  autoMigrate?: boolean;
};

const ensureSchema = async (
  query: PostgresQueryRunner,
  jobs: string,
  changes: string,
) => {
  await query(`
    CREATE TABLE IF NOT EXISTS ${jobs} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      not_before_ms BIGINT NOT NULL,
      enqueued_at_ms BIGINT NOT NULL,
      started_at_ms BIGINT,
      completed_at_ms BIGINT,
      last_error TEXT,
      result_entity_id TEXT
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_${jobs}_pending ON ${jobs}(status, not_before_ms)`,
  );
  await query(`
    CREATE TABLE IF NOT EXISTS ${changes} (
      id TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      user_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      payload_json JSONB,
      received_at_ms BIGINT NOT NULL,
      signed_payload TEXT
    )
  `);
};

type JobRow = {
  id: string;
  user_id: string;
  vendor: string;
  kind: string;
  idempotency_key: string;
  payload_json: CRMSyncJob["payload"];
  status: string;
  attempts: number;
  max_attempts: number;
  not_before_ms: string | number;
  enqueued_at_ms: string | number;
  started_at_ms: string | number | null;
  completed_at_ms: string | number | null;
  last_error: string | null;
  result_entity_id: string | null;
};

const toNumber = (v: string | number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const rowToJob = (row: JobRow): CRMSyncJob => {
  const completedAtMs = toNumber(row.completed_at_ms);
  const startedAtMs = toNumber(row.started_at_ms);
  return {
    attempts: row.attempts,
    ...(completedAtMs !== undefined ? { completedAtMs } : {}),
    enqueuedAtMs: Number(row.enqueued_at_ms),
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind as CRMSyncJob["kind"],
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    maxAttempts: row.max_attempts,
    notBeforeMs: Number(row.not_before_ms),
    payload: row.payload_json,
    ...(row.result_entity_id !== null
      ? { resultEntityId: row.result_entity_id }
      : {}),
    ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    status: row.status as CRMSyncJobStatus,
    userId: row.user_id,
    vendor: row.vendor as CRMSyncJob["vendor"],
  };
};

export const createPostgresCRMSyncQueue = async (
  options: CreatePostgresCRMSyncQueueOptions,
): Promise<CRMSyncQueue> => {
  const jobs = options.jobsTable ?? "crm_sync_jobs";
  const changes = options.changesTable ?? "crm_change_events";
  if (options.autoMigrate !== false) {
    await ensureSchema(options.query, jobs, changes);
  }
  const defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
  const retryBackoff = options.retryBackoffMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const generateId =
    options.generateId ??
    (() => `job_${Math.random().toString(36).slice(2, 10)}`);
  const query = options.query;
  const listeners = new Set<(job: CRMSyncJob) => void>();
  const notify = (job: CRMSyncJob) => {
    for (const l of listeners) l(job);
  };

  return {
    async cancel(jobId) {
      const rows = await query<JobRow>(
        `UPDATE ${jobs} SET status = 'cancelled'
         WHERE id = $1 AND status NOT IN ('completed', 'cancelled')
         RETURNING *`,
        [jobId],
      );
      const row = rows[0];
      if (!row) return false;
      notify(rowToJob(row));
      return true;
    },
    async claimNext(at = now()) {
      const rows = await query<JobRow>(
        `UPDATE ${jobs} SET
          status = 'in-flight',
          attempts = attempts + 1,
          started_at_ms = $1
         WHERE id = (
           SELECT id FROM ${jobs}
           WHERE status = 'pending' AND not_before_ms <= $1
           ORDER BY not_before_ms ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [at],
      );
      const row = rows[0];
      if (!row) return null;
      const job = rowToJob(row);
      notify(job);
      return job;
    },
    async enqueue(input) {
      const existing = await query<JobRow>(
        `SELECT * FROM ${jobs} WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing[0]) return rowToJob(existing[0]);
      const at = input.enqueuedAtMs ?? now();
      const id = generateId();
      const job: CRMSyncJob = {
        attempts: input.attempts ?? 0,
        enqueuedAtMs: at,
        id,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
        notBeforeMs: input.notBeforeMs ?? at,
        payload: input.payload,
        status: input.status ?? "pending",
        userId: input.userId,
        vendor: input.vendor,
      };
      await query(
        `INSERT INTO ${jobs}
         (id, user_id, vendor, kind, idempotency_key, payload_json, status,
          attempts, max_attempts, not_before_ms, enqueued_at_ms)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
        [
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
        ],
      );
      notify(job);
      return job;
    },
    async list(filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter?.status) {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }
      if (filter?.vendor) {
        params.push(filter.vendor);
        conditions.push(`vendor = $${params.length}`);
      }
      if (filter?.userId) {
        params.push(filter.userId);
        conditions.push(`user_id = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await query<JobRow>(
        `SELECT * FROM ${jobs} ${where}`,
        params,
      );
      return rows.map(rowToJob);
    },
    async markCompleted(jobId, resultEntityId) {
      const rows = await query<JobRow>(
        `UPDATE ${jobs} SET
          status = 'completed',
          completed_at_ms = $1,
          result_entity_id = $2
         WHERE id = $3
         RETURNING *`,
        [now(), resultEntityId ?? null, jobId],
      );
      if (rows[0]) notify(rowToJob(rows[0]));
    },
    async markFailed(jobId, error, opts) {
      const rowsCurrent = await query<JobRow>(
        `SELECT attempts, max_attempts FROM ${jobs} WHERE id = $1`,
        [jobId],
      );
      const current = rowsCurrent[0];
      if (!current) return;
      const exhausted = current.attempts >= current.max_attempts;
      const updated = await query<JobRow>(
        `UPDATE ${jobs} SET
          status = $1,
          last_error = $2,
          not_before_ms = $3,
          completed_at_ms = $4
         WHERE id = $5
         RETURNING *`,
        [
          exhausted ? "dead-letter" : "pending",
          error,
          opts?.retryAtMs ?? now() + retryBackoff,
          exhausted ? now() : null,
          jobId,
        ],
      );
      if (updated[0]) notify(rowToJob(updated[0]));
    },
    async recordChange(event: CRMChangeEvent) {
      await query(
        `INSERT INTO ${changes}
         (id, vendor, user_id, entity_type, entity_id, op, payload_json,
          received_at_ms, signed_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          event.vendor,
          event.userId ?? null,
          event.entityType,
          event.entityId,
          event.op,
          event.payload ? JSON.stringify(event.payload) : null,
          event.receivedAtMs,
          event.signedPayload ?? null,
        ],
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
