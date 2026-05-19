import { describe, expect, test } from "bun:test";
import { createInMemoryCRMTokenStore } from "../src/stores";

const baseRecord = {
  accessToken: "tkn",
  createdAt: 0,
  refreshToken: "rfsh",
  updatedAt: 0,
  userId: "user_1",
  vendor: "hubspot",
} as const;

describe("createInMemoryCRMTokenStore", () => {
  test("put + get round-trips a token record", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({ ...baseRecord });
    const fetched = await store.get("user_1", "hubspot");
    expect(fetched?.accessToken).toBe("tkn");
  });

  test("listVendorsForUser returns all vendors a user has linked", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({ ...baseRecord });
    await store.put({ ...baseRecord, vendor: "salesforce" });
    const vendors = await store.listVendorsForUser("user_1");
    expect(vendors.sort()).toEqual(["hubspot", "salesforce"]);
  });

  test("remove deletes by user + vendor", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({ ...baseRecord });
    expect(await store.remove("user_1", "hubspot")).toBe(true);
    expect(await store.get("user_1", "hubspot")).toBeNull();
  });

  test("seed pre-populates the store", async () => {
    const store = createInMemoryCRMTokenStore({
      seed: [{ ...baseRecord, vendor: "attio" }],
    });
    const record = await store.get("user_1", "attio");
    expect(record).not.toBeNull();
  });

  test("listUsersForVendor returns distinct users", async () => {
    const store = createInMemoryCRMTokenStore();
    await store.put({ ...baseRecord });
    await store.put({ ...baseRecord, userId: "user_2" });
    const users = await store.listUsersForVendor?.("hubspot");
    expect(users?.sort()).toEqual(["user_1", "user_2"]);
  });
});
