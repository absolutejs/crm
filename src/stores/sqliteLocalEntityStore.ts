import type { CRMEntityType, CRMVendor } from "../types";
import type { SqliteLikeDatabase } from "./sqliteTokenStore";
import type {
  CRMLocalEntityOrigin,
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
} from "./localEntityStore";

export type CreateSqliteCRMLocalEntityStoreOptions = {
  db: SqliteLikeDatabase;
  tableName?: string;
};

const ensureSchema = (db: SqliteLikeDatabase, table: string) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      vendor TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      origin TEXT NOT NULL,
      vendor_updated_at INTEGER,
      local_updated_at INTEGER NOT NULL,
      last_reconciled_at INTEGER,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (vendor, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_${table}_vendor_type
      ON ${table}(vendor, entity_type);
    CREATE INDEX IF NOT EXISTS idx_${table}_local_updated
      ON ${table}(local_updated_at);
  `);
};

type Row = {
  vendor: string;
  entity_type: string;
  entity_id: string;
  data_json: string;
  origin: string;
  vendor_updated_at: number | null;
  local_updated_at: number;
  last_reconciled_at: number | null;
  version: number;
};

const rowToRecord = (row: Row): CRMLocalEntityRecord => ({
  data: JSON.parse(row.data_json) as Record<string, unknown>,
  entityId: row.entity_id,
  entityType: row.entity_type as CRMEntityType,
  localUpdatedAt: row.local_updated_at,
  origin: row.origin as CRMLocalEntityOrigin,
  vendor: row.vendor as CRMVendor,
  version: row.version,
  ...(row.last_reconciled_at !== null
    ? { lastReconciledAt: row.last_reconciled_at }
    : {}),
  ...(row.vendor_updated_at !== null
    ? { vendorUpdatedAt: row.vendor_updated_at }
    : {}),
});

export const createSqliteCRMLocalEntityStore = (
  options: CreateSqliteCRMLocalEntityStoreOptions,
): CRMLocalEntityStore => {
  const table = options.tableName ?? "crm_local_entities";
  ensureSchema(options.db, table);

  const getStmt = options.db.prepare(
    `SELECT * FROM ${table} WHERE vendor = ? AND entity_type = ? AND entity_id = ?`,
  );
  const upsertStmt = options.db.prepare(
    `INSERT INTO ${table}
      (vendor, entity_type, entity_id, data_json, origin,
       vendor_updated_at, local_updated_at, last_reconciled_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
       (SELECT version + 1 FROM ${table}
        WHERE vendor = ? AND entity_type = ? AND entity_id = ?), 1))
     ON CONFLICT(vendor, entity_type, entity_id) DO UPDATE SET
       data_json = excluded.data_json,
       origin = excluded.origin,
       vendor_updated_at = excluded.vendor_updated_at,
       local_updated_at = excluded.local_updated_at,
       last_reconciled_at = excluded.last_reconciled_at,
       version = ${table}.version + 1`,
  );
  const deleteStmt = options.db.prepare(
    `DELETE FROM ${table} WHERE vendor = ? AND entity_type = ? AND entity_id = ?`,
  );
  const listAllStmt = options.db.prepare(`SELECT * FROM ${table}`);

  return {
    async get(vendor, entityType, entityId) {
      const row = getStmt.get(vendor, entityType, entityId) as
        | Row
        | undefined;
      return row ? rowToRecord(row) : null;
    },
    async list(filter) {
      const rows = listAllStmt.all() as Row[];
      return rows
        .map(rowToRecord)
        .filter((r) => !filter?.vendor || r.vendor === filter.vendor)
        .filter(
          (r) => !filter?.entityType || r.entityType === filter.entityType,
        )
        .filter(
          (r) =>
            filter?.sinceMs === undefined ||
            r.localUpdatedAt >= filter.sinceMs,
        );
    },
    async put(record) {
      upsertStmt.run(
        record.vendor,
        record.entityType,
        record.entityId,
        JSON.stringify(record.data),
        record.origin,
        record.vendorUpdatedAt ?? null,
        record.localUpdatedAt,
        record.lastReconciledAt ?? null,
        record.vendor,
        record.entityType,
        record.entityId,
      );
    },
    async remove(vendor, entityType, entityId) {
      const result = deleteStmt.run(vendor, entityType, entityId) as {
        changes?: number;
      };
      return (result.changes ?? 0) > 0;
    },
  };
};
