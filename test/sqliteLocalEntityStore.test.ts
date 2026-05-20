import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSqliteCRMLocalEntityStore } from "../src/stores";

const record = (
  overrides: Partial<{
    vendor: "hubspot" | "salesforce";
    entityType: "contact" | "deal";
    entityId: string;
    data: Record<string, unknown>;
    origin: "app" | "vendor" | "reconciled";
    localUpdatedAt: number;
    vendorUpdatedAt: number;
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

describe("createSqliteCRMLocalEntityStore", () => {
  test("put + get round-trips, increments version on conflict", async () => {
    const store = createSqliteCRMLocalEntityStore({
      db: new Database(":memory:"),
    });
    await store.put(record());
    const first = await store.get("hubspot", "contact", "c_1");
    expect(first?.version).toBe(1);
    await store.put(record({ data: { firstName: "Alexandra" } }));
    const second = await store.get("hubspot", "contact", "c_1");
    expect(second?.version).toBe(2);
    expect(second?.data.firstName).toBe("Alexandra");
  });

  test("preserves origin + vendorUpdatedAt + lastReconciledAt on read", async () => {
    const store = createSqliteCRMLocalEntityStore({
      db: new Database(":memory:"),
    });
    await store.put({
      ...record({ origin: "reconciled" }),
      lastReconciledAt: 1_500,
      vendorUpdatedAt: 800,
    });
    const r = await store.get("hubspot", "contact", "c_1");
    expect(r?.origin).toBe("reconciled");
    expect(r?.vendorUpdatedAt).toBe(800);
    expect(r?.lastReconciledAt).toBe(1_500);
  });

  test("remove deletes by composite key", async () => {
    const store = createSqliteCRMLocalEntityStore({
      db: new Database(":memory:"),
    });
    await store.put(record());
    expect(await store.remove("hubspot", "contact", "c_1")).toBe(true);
    expect(await store.get("hubspot", "contact", "c_1")).toBeNull();
  });

  test("list filters by vendor + entityType + sinceMs", async () => {
    const store = createSqliteCRMLocalEntityStore({
      db: new Database(":memory:"),
    });
    await store.put(record({ entityId: "c_1", localUpdatedAt: 100 }));
    await store.put(
      record({ entityId: "c_2", entityType: "deal", localUpdatedAt: 200 }),
    );
    await store.put(
      record({ entityId: "c_3", localUpdatedAt: 300, vendor: "salesforce" }),
    );
    const contacts = await store.list({ entityType: "contact" });
    expect(contacts).toHaveLength(2);
    const hsOnly = await store.list({
      entityType: "contact",
      vendor: "hubspot",
    });
    expect(hsOnly).toHaveLength(1);
    const recent = await store.list({ sinceMs: 250 });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.entityId).toBe("c_3");
  });

  test("custom tableName is honored", async () => {
    const db = new Database(":memory:");
    const store = createSqliteCRMLocalEntityStore({
      db,
      tableName: "my_entities",
    });
    await store.put(record());
    const rows = db
      .prepare("SELECT entity_id FROM my_entities")
      .all() as { entity_id: string }[];
    expect(rows).toHaveLength(1);
  });
});
