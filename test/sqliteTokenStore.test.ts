import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSqliteCRMTokenStore } from "../src/stores";

const baseRecord = {
  accessToken: "tkn",
  createdAt: 100,
  refreshToken: "rfsh",
  updatedAt: 200,
  userId: "user_1",
  vendor: "hubspot",
} as const;

describe("createSqliteCRMTokenStore (bun:sqlite)", () => {
  test("put + get round-trips a token record", async () => {
    const store = createSqliteCRMTokenStore({ db: new Database(":memory:") });
    await store.put({ ...baseRecord });
    const fetched = await store.get("user_1", "hubspot");
    expect(fetched?.accessToken).toBe("tkn");
    expect(fetched?.refreshToken).toBe("rfsh");
  });

  test("put upserts on conflict", async () => {
    const store = createSqliteCRMTokenStore({ db: new Database(":memory:") });
    await store.put({ ...baseRecord });
    await store.put({
      ...baseRecord,
      accessToken: "tkn_2",
      updatedAt: 300,
    });
    const fetched = await store.get("user_1", "hubspot");
    expect(fetched?.accessToken).toBe("tkn_2");
  });

  test("remove deletes by user + vendor", async () => {
    const store = createSqliteCRMTokenStore({ db: new Database(":memory:") });
    await store.put({ ...baseRecord });
    expect(await store.remove("user_1", "hubspot")).toBe(true);
    expect(await store.get("user_1", "hubspot")).toBeNull();
  });

  test("listVendorsForUser + listUsersForVendor work", async () => {
    const store = createSqliteCRMTokenStore({ db: new Database(":memory:") });
    await store.put({ ...baseRecord });
    await store.put({ ...baseRecord, vendor: "salesforce" });
    await store.put({ ...baseRecord, userId: "user_2" });
    expect((await store.listVendorsForUser("user_1")).sort()).toEqual([
      "hubspot",
      "salesforce",
    ]);
    expect(
      (await store.listUsersForVendor?.("hubspot"))?.sort(),
    ).toEqual(["user_1", "user_2"]);
  });

  test("custom tableName is honored", async () => {
    const db = new Database(":memory:");
    const store = createSqliteCRMTokenStore({
      db,
      tableName: "my_crm",
    });
    await store.put({ ...baseRecord });
    const rows = db
      .prepare("SELECT user_id FROM my_crm")
      .all() as { user_id: string }[];
    expect(rows).toHaveLength(1);
  });
});
