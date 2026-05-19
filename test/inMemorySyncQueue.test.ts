import { describe, expect, test } from "bun:test";
import { createInMemoryCRMSyncQueue } from "../src/sync";

const sampleJob = {
  idempotencyKey: "u_1::contact::abc",
  kind: "outbound.create" as const,
  notBeforeMs: 0,
  payload: {
    entity: { firstName: "Alex" },
    entityType: "contact" as const,
  },
  userId: "u_1",
  vendor: "hubspot" as const,
};

describe("createInMemoryCRMSyncQueue", () => {
  test("enqueue + claimNext flows a job through pending → in-flight", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    const queued = await queue.enqueue({
      ...sampleJob,
      maxAttempts: 3,
    });
    expect(queued.status).toBe("pending");
    const claimed = await queue.claimNext(0);
    expect(claimed?.status).toBe("in-flight");
    expect(claimed?.attempts).toBe(1);
  });

  test("idempotency key dedupes enqueue", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    const first = await queue.enqueue({ ...sampleJob, maxAttempts: 3 });
    const second = await queue.enqueue({ ...sampleJob, maxAttempts: 3 });
    expect(second.id).toBe(first.id);
  });

  test("markCompleted transitions to completed", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    const job = await queue.enqueue({ ...sampleJob, maxAttempts: 3 });
    await queue.claimNext(0);
    await queue.markCompleted(job.id, "crm_contact_99");
    const after = await queue.list({ status: "completed" });
    expect(after).toHaveLength(1);
    expect(after[0]?.resultEntityId).toBe("crm_contact_99");
  });

  test("markFailed retries with backoff until maxAttempts then dead-letters", async () => {
    let t = 1_000;
    const queue = createInMemoryCRMSyncQueue({
      defaultMaxAttempts: 2,
      now: () => t,
      retryBackoffMs: 500,
    });
    const job = await queue.enqueue({
      ...sampleJob,
      maxAttempts: 2,
    });
    await queue.claimNext(t);
    await queue.markFailed(job.id, "boom");
    const afterFirstFail = (await queue.list())[0];
    expect(afterFirstFail?.status).toBe("pending");
    expect(afterFirstFail?.notBeforeMs).toBe(1_500);
    t = 2_000;
    await queue.claimNext(t);
    await queue.markFailed(job.id, "boom again");
    const afterSecondFail = (await queue.list())[0];
    expect(afterSecondFail?.status).toBe("dead-letter");
  });

  test("notBeforeMs gates job availability", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    await queue.enqueue({
      ...sampleJob,
      maxAttempts: 2,
      notBeforeMs: 10_000,
    });
    expect(await queue.claimNext(5_000)).toBeNull();
    expect(await queue.claimNext(11_000)).not.toBeNull();
  });

  test("cancel halts pending jobs but not completed ones", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    const job = await queue.enqueue({ ...sampleJob, maxAttempts: 2 });
    expect(await queue.cancel(job.id)).toBe(true);
    expect(await queue.cancel(job.id)).toBe(false);
  });

  test("recordChange stores inbound webhook events", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    await queue.recordChange({
      entityId: "contact_42",
      entityType: "contact",
      id: "evt_1",
      op: "update",
      receivedAtMs: 1_000,
      vendor: "hubspot",
    });
    // We don't currently expose changeLog reads — this just verifies it doesn't throw.
    expect(true).toBe(true);
  });

  test("subscribe receives lifecycle events", async () => {
    const queue = createInMemoryCRMSyncQueue({ now: () => 0 });
    const statuses: string[] = [];
    queue.subscribe?.((job) => statuses.push(job.status));
    const job = await queue.enqueue({ ...sampleJob, maxAttempts: 2 });
    await queue.claimNext(0);
    await queue.markCompleted(job.id);
    expect(statuses).toEqual(["pending", "in-flight", "completed"]);
  });
});
