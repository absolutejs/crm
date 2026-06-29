import type { RedisLikeClient } from "../stores/redisTokenStore";
import type {
  CRMChangeEvent,
  CRMSyncJob,
  CRMSyncJobStatus,
  CRMSyncQueue,
} from "./index";

export type RedisSortedSetClient = RedisLikeClient & {
  zadd(key: string, score: number, member: string): Promise<unknown> | unknown;
  zrem(key: string, member: string): Promise<unknown> | unknown;
  zrangebyscore(
    key: string,
    min: number,
    max: number,
    options?: { limit?: { offset: number; count: number } },
  ): Promise<string[]> | string[];
};

export type CreateRedisCRMSyncQueueOptions = {
  client: RedisSortedSetClient;
  keyPrefix?: string;
  defaultMaxAttempts?: number;
  retryBackoffMs?: number;
  generateId?: () => string;
  now?: () => number;
};

const jobKey = (prefix: string, id: string) => `${prefix}:job:${id}`;
const idempotencyKey = (prefix: string, key: string) =>
  `${prefix}:idem:${key}`;
const pendingZsetKey = (prefix: string) => `${prefix}:pending`;
const statusSetKey = (prefix: string, status: CRMSyncJobStatus) =>
  `${prefix}:status:${status}`;
const changeStreamKey = (prefix: string) => `${prefix}:changes`;

export const createRedisCRMSyncQueue = (
  options: CreateRedisCRMSyncQueueOptions,
): CRMSyncQueue => {
  const prefix = options.keyPrefix ?? "crm";
  const defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
  const retryBackoff = options.retryBackoffMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const generateId =
    options.generateId ??
    (() => `job_${Math.random().toString(36).slice(2, 10)}`);
  const client = options.client;
  const listeners = new Set<(job: CRMSyncJob) => void>();
  const notify = (job: CRMSyncJob) => {
    for (const l of listeners) l(job);
  };

  const persist = async (job: CRMSyncJob) => {
    await client.set(jobKey(prefix, job.id), JSON.stringify(job));
    if (job.status === "pending") {
      await client.zadd(pendingZsetKey(prefix), job.notBeforeMs, job.id);
    } else {
      await client.zrem(pendingZsetKey(prefix), job.id);
    }
    await client.sadd(statusSetKey(prefix, job.status), job.id);
  };

  const load = async (id: string): Promise<CRMSyncJob | null> => {
    const raw = await client.get(jobKey(prefix, id));
    return raw ? (JSON.parse(raw) as CRMSyncJob) : null;
  };

  const clearOldStatus = async (jobId: string, old: CRMSyncJobStatus) => {
    await client.srem(statusSetKey(prefix, old), jobId);
  };

  return {
    async cancel(jobId) {
      const job = await load(jobId);
      if (!job) return false;
      if (job.status === "completed" || job.status === "cancelled") return false;
      await clearOldStatus(jobId, job.status);
      job.status = "cancelled";
      await persist(job);
      notify(job);
      return true;
    },
    async claimNext(at = now(), kinds) {
      const filterByKind = kinds !== undefined && kinds.length > 0;
      const ids = await client.zrangebyscore(pendingZsetKey(prefix), 0, at, {
        limit: { count: filterByKind ? 100 : 1, offset: 0 },
      });
      for (const id of ids) {
        const job = await load(id);
        if (!job) continue;
        if (filterByKind && !kinds.includes(job.kind)) continue;
        await clearOldStatus(id, job.status);
        job.status = "in-flight";
        job.attempts += 1;
        job.startedAtMs = at;
        await persist(job);
        notify(job);
        return job;
      }
      return null;
    },
    async enqueue(input) {
      const existingId = await client.get(
        idempotencyKey(prefix, input.idempotencyKey),
      );
      if (existingId) {
        const existing = await load(existingId);
        if (existing) return existing;
      }
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
      await client.set(idempotencyKey(prefix, job.idempotencyKey), job.id);
      await persist(job);
      notify(job);
      return job;
    },
    async list(filter) {
      const ids = filter?.status
        ? await client.smembers(statusSetKey(prefix, filter.status))
        : await client.smembers(`${prefix}:status:pending`);
      const out: CRMSyncJob[] = [];
      for (const id of ids) {
        const job = await load(id);
        if (!job) continue;
        if (filter?.vendor && job.vendor !== filter.vendor) continue;
        if (filter?.userId && job.userId !== filter.userId) continue;
        out.push(job);
      }
      return out;
    },
    async markCompleted(jobId, resultEntityId) {
      const job = await load(jobId);
      if (!job) return;
      await clearOldStatus(jobId, job.status);
      job.status = "completed";
      job.completedAtMs = now();
      if (resultEntityId) job.resultEntityId = resultEntityId;
      await persist(job);
      notify(job);
    },
    async markFailed(jobId, error, opts) {
      const job = await load(jobId);
      if (!job) return;
      await clearOldStatus(jobId, job.status);
      job.lastError = error;
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead-letter";
        job.completedAtMs = now();
      } else {
        job.status = "pending";
        job.notBeforeMs = opts?.retryAtMs ?? now() + retryBackoff;
      }
      await persist(job);
      notify(job);
    },
    async recordChange(event: CRMChangeEvent) {
      await client.set(
        `${changeStreamKey(prefix)}:${event.id}`,
        JSON.stringify(event),
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
