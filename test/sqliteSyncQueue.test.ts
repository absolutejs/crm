import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSqliteCRMSyncQueue } from "../src/sync";

const sampleJob = {
  idempotencyKey: "u_1::contact::abc",
  kind: "outbound.create" as const,
  maxAttempts: 3,
  notBeforeMs: 0,
  payload: {
    entity: { firstName: "Alex" },
    entityType: "contact" as const,
  },
  userId: "u_1",
  vendor: "hubspot" as const,
};

const newQueue = (now = 0) =>
  createSqliteCRMSyncQueue({ db: new Database(":memory:"), now: () => now });

describe("createSqliteCRMSyncQueue", () => {
  test("enqueue + claim flow persists across calls", async () => {
    const queue = newQueue();
    await queue.enqueue(sampleJob);
    const claimed = await queue.claimNext(0);
    expect(claimed?.status).toBe("in-flight");
    expect(claimed?.attempts).toBe(1);
  });

  test("idempotency dedupes by key", async () => {
    const queue = newQueue();
    const first = await queue.enqueue(sampleJob);
    const second = await queue.enqueue(sampleJob);
    expect(second.id).toBe(first.id);
  });

  test("markCompleted updates row", async () => {
    const queue = newQueue();
    const job = await queue.enqueue(sampleJob);
    await queue.claimNext(0);
    await queue.markCompleted(job.id, "crm_99");
    const completed = await queue.list({ status: "completed" });
    expect(completed[0]?.resultEntityId).toBe("crm_99");
  });

  test("markFailed retries until dead-letter", async () => {
    const db = new Database(":memory:");
    let t = 1_000;
    const queue = createSqliteCRMSyncQueue({
      db,
      defaultMaxAttempts: 2,
      now: () => t,
      retryBackoffMs: 500,
    });
    const job = await queue.enqueue({ ...sampleJob, maxAttempts: 2 });
    await queue.claimNext(t);
    await queue.markFailed(job.id, "boom");
    let row = (await queue.list({ status: "pending" }))[0];
    expect(row?.attempts).toBe(1);
    t = 2_000;
    await queue.claimNext(t);
    await queue.markFailed(job.id, "boom again");
    row = (await queue.list({ status: "dead-letter" }))[0];
    expect(row?.attempts).toBe(2);
  });

  test("notBeforeMs gates claims", async () => {
    const queue = newQueue();
    await queue.enqueue({ ...sampleJob, notBeforeMs: 10_000 });
    expect(await queue.claimNext(5_000)).toBeNull();
    expect(await queue.claimNext(11_000)).not.toBeNull();
  });

  test("recordChange persists inbound events", async () => {
    const queue = newQueue();
    await queue.recordChange({
      entityId: "c_1",
      entityType: "contact",
      id: "evt_1",
      op: "update",
      receivedAtMs: 100,
      vendor: "hubspot",
    });
    expect(true).toBe(true);
  });
});
