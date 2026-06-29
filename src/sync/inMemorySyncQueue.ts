import type {
  CRMChangeEvent,
  CRMSyncJob,
  CRMSyncJobStatus,
  CRMSyncQueue,
  EnqueueCRMSyncJobInput,
} from "./index";

export type CreateInMemoryCRMSyncQueueOptions = {
  generateId?: () => string;
  defaultMaxAttempts?: number;
  retryBackoffMs?: number;
  now?: () => number;
};

const cloneJob = (job: CRMSyncJob): CRMSyncJob => ({
  ...job,
  payload: { ...job.payload, entity: { ...job.payload.entity } } as CRMSyncJob["payload"],
});

export const createInMemoryCRMSyncQueue = (
  options: CreateInMemoryCRMSyncQueueOptions = {},
): CRMSyncQueue => {
  const now = options.now ?? (() => Date.now());
  const generateId =
    options.generateId ??
    (() => `job_${Math.random().toString(36).slice(2, 10)}`);
  const defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
  const retryBackoff = options.retryBackoffMs ?? 5 * 60 * 1000;
  const jobs = new Map<string, CRMSyncJob>();
  const byIdempotency = new Map<string, string>();
  const changeLog: CRMChangeEvent[] = [];
  const listeners = new Set<(job: CRMSyncJob) => void>();
  const notify = (job: CRMSyncJob) => {
    for (const listener of listeners) listener(cloneJob(job));
  };

  return {
    async cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) return false;
      if (job.status === "completed" || job.status === "cancelled") return false;
      job.status = "cancelled";
      notify(job);
      return true;
    },
    async claimNext(at = now(), kinds) {
      let nextJob: CRMSyncJob | undefined;
      for (const job of jobs.values()) {
        if (job.status !== "pending") continue;
        if (job.notBeforeMs > at) continue;
        if (kinds && kinds.length > 0 && !kinds.includes(job.kind)) continue;
        if (!nextJob || job.notBeforeMs < nextJob.notBeforeMs) {
          nextJob = job;
        }
      }
      if (!nextJob) return null;
      nextJob.status = "in-flight";
      nextJob.attempts += 1;
      nextJob.startedAtMs = at;
      notify(nextJob);
      return cloneJob(nextJob);
    },
    async enqueue(input) {
      const existingId = byIdempotency.get(input.idempotencyKey);
      if (existingId) {
        const existing = jobs.get(existingId);
        if (existing) return cloneJob(existing);
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
      jobs.set(job.id, job);
      byIdempotency.set(job.idempotencyKey, job.id);
      notify(job);
      return cloneJob(job);
    },
    async list(filter) {
      const out: CRMSyncJob[] = [];
      for (const job of jobs.values()) {
        if (filter?.status && job.status !== filter.status) continue;
        if (filter?.vendor && job.vendor !== filter.vendor) continue;
        if (filter?.userId && job.userId !== filter.userId) continue;
        out.push(cloneJob(job));
      }
      return out;
    },
    async markCompleted(jobId, resultEntityId) {
      const job = jobs.get(jobId);
      if (!job) return;
      job.status = "completed";
      job.completedAtMs = now();
      if (resultEntityId) job.resultEntityId = resultEntityId;
      notify(job);
    },
    async markFailed(jobId, error, options) {
      const job = jobs.get(jobId);
      if (!job) return;
      job.lastError = error;
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead-letter";
        job.completedAtMs = now();
      } else {
        job.status = "pending";
        job.notBeforeMs = options?.retryAtMs ?? now() + retryBackoff;
      }
      notify(job);
    },
    async recordChange(event) {
      changeLog.push(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const __testHook_drainChangeLog = (
  queue: CRMSyncQueue,
): CRMChangeEvent[] => {
  const internal = queue as unknown as { __changeLog?: CRMChangeEvent[] };
  return internal.__changeLog ?? [];
};
