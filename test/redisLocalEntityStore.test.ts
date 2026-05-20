import { describe, expect, test } from "bun:test";
import { createRedisCRMLocalEntityStore } from "../src/stores";
import type { RedisLikeClient } from "../src/stores";

const inMemoryRedis = (): RedisLikeClient => {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    del(key) {
      return kv.delete(key) ? 1 : 0;
    },
    get(key) {
      return kv.get(key) ?? null;
    },
    sadd(key, member) {
      const set = sets.get(key) ?? new Set();
      set.add(member);
      sets.set(key, set);
      return 1;
    },
    set(key, value) {
      kv.set(key, value);
      return "OK";
    },
    smembers(key) {
      return Array.from(sets.get(key) ?? []);
    },
    srem(key, member) {
      sets.get(key)?.delete(member);
      return 1;
    },
  };
};

const record = (
  overrides: Partial<{
    vendor: "hubspot" | "salesforce";
    entityType: "contact" | "deal";
    entityId: string;
    data: Record<string, unknown>;
    origin: "app" | "vendor" | "reconciled";
    localUpdatedAt: number;
  }> = {},
) => ({
  data: { firstName: "Alex" },
  entityId: "c_1",
  entityType: "contact" as const,
  localUpdatedAt: 1000,
  origin: "app" as const,
  vendor: "hubspot" as const,
  ...overrides,
});

describe("createRedisCRMLocalEntityStore", () => {
  test("put + get round-trips", async () => {
    const store = createRedisCRMLocalEntityStore({ client: inMemoryRedis() });
    await store.put(record());
    const stored = await store.get("hubspot", "contact", "c_1");
    expect(stored?.data.firstName).toBe("Alex");
  });

  test("put increments version on subsequent writes", async () => {
    const store = createRedisCRMLocalEntityStore({ client: inMemoryRedis() });
    await store.put(record());
    await store.put(record({ data: { firstName: "Alexandra" } }));
    const stored = await store.get("hubspot", "contact", "c_1");
    expect(stored?.version).toBe(2);
  });

  test("remove deletes + removes from index", async () => {
    const store = createRedisCRMLocalEntityStore({ client: inMemoryRedis() });
    await store.put(record());
    expect(await store.remove("hubspot", "contact", "c_1")).toBe(true);
    expect(await store.get("hubspot", "contact", "c_1")).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  test("list filters by vendor + entityType + sinceMs", async () => {
    const store = createRedisCRMLocalEntityStore({ client: inMemoryRedis() });
    await store.put(record({ entityId: "c_1", localUpdatedAt: 100 }));
    await store.put(
      record({ entityId: "c_2", entityType: "deal", localUpdatedAt: 200 }),
    );
    await store.put(
      record({ entityId: "c_3", localUpdatedAt: 300, vendor: "salesforce" }),
    );
    expect(
      (await store.list({ entityType: "contact" })).map((r) => r.entityId).sort(),
    ).toEqual(["c_1", "c_3"]);
    expect(
      (
        await store.list({ entityType: "contact", vendor: "hubspot" })
      ).map((r) => r.entityId),
    ).toEqual(["c_1"]);
    expect((await store.list({ sinceMs: 250 })).map((r) => r.entityId)).toEqual([
      "c_3",
    ]);
  });

  test("custom keyPrefix isolates keyspaces", async () => {
    const client = inMemoryRedis();
    const storeA = createRedisCRMLocalEntityStore({
      client,
      keyPrefix: "tenantA",
    });
    const storeB = createRedisCRMLocalEntityStore({
      client,
      keyPrefix: "tenantB",
    });
    await storeA.put(record());
    expect(await storeB.get("hubspot", "contact", "c_1")).toBeNull();
    expect(await storeA.get("hubspot", "contact", "c_1")).not.toBeNull();
  });
});
