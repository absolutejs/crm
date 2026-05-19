import { describe, expect, test } from "bun:test";
import { createInMemoryCRMLocalEntityStore } from "../src/stores";

const sample = (overrides: Partial<Parameters<typeof createInMemoryCRMLocalEntityStore>[0]> = {}) =>
  createInMemoryCRMLocalEntityStore(overrides as never);

const record = (overrides: Partial<{
  vendor: "hubspot" | "salesforce";
  entityType: "contact" | "deal";
  entityId: string;
  data: Record<string, unknown>;
  origin: "app" | "vendor" | "reconciled";
  localUpdatedAt: number;
}> = {}) => ({
  data: { firstName: "Alex" },
  entityId: "c_1",
  entityType: "contact" as const,
  localUpdatedAt: 1000,
  origin: "app" as const,
  vendor: "hubspot" as const,
  ...overrides,
});

describe("createInMemoryCRMLocalEntityStore", () => {
  test("put + get round-trips and increments version", async () => {
    const store = sample();
    await store.put(record());
    const first = await store.get("hubspot", "contact", "c_1");
    expect(first?.version).toBe(1);
    await store.put(record({ data: { firstName: "Alexandra" } }));
    const second = await store.get("hubspot", "contact", "c_1");
    expect(second?.version).toBe(2);
    expect(second?.data.firstName).toBe("Alexandra");
  });

  test("get returns null for unknown key", async () => {
    const store = sample();
    expect(await store.get("hubspot", "contact", "missing")).toBeNull();
  });

  test("remove deletes the key", async () => {
    const store = sample();
    await store.put(record());
    expect(await store.remove("hubspot", "contact", "c_1")).toBe(true);
    expect(await store.get("hubspot", "contact", "c_1")).toBeNull();
  });

  test("list filters by vendor + entityType", async () => {
    const store = sample();
    await store.put(record());
    await store.put(record({ entityId: "c_2", entityType: "deal" }));
    await store.put(record({ entityId: "c_3", vendor: "salesforce" }));
    const contacts = await store.list({ entityType: "contact" });
    expect(contacts).toHaveLength(2);
    const hsContacts = await store.list({
      entityType: "contact",
      vendor: "hubspot",
    });
    expect(hsContacts).toHaveLength(1);
  });

  test("list filters by sinceMs", async () => {
    const store = sample();
    await store.put(record({ localUpdatedAt: 500 }));
    await store.put(
      record({ entityId: "c_2", localUpdatedAt: 1500 }),
    );
    const recent = await store.list({ sinceMs: 1000 });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.entityId).toBe("c_2");
  });

  test("seed pre-populates the store", async () => {
    const store = sample({
      seed: [record({ entityId: "c_seed" })],
    });
    const found = await store.get("hubspot", "contact", "c_seed");
    expect(found).not.toBeNull();
  });
});
