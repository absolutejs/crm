import type { CRMEntityType, CRMVendor } from "../types";
import type { PostgresQueryRunner } from "./postgresTokenStore";
import type {
  CRMLocalEntityOrigin,
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
} from "./localEntityStore";

export type CreatePostgresCRMLocalEntityStoreOptions = {
  query: PostgresQueryRunner;
  tableName?: string;
  autoMigrate?: boolean;
};

const ensureSchema = async (
  query: PostgresQueryRunner,
  table: string,
): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      vendor TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      data_json JSONB NOT NULL,
      origin TEXT NOT NULL,
      vendor_updated_at BIGINT,
      local_updated_at BIGINT NOT NULL,
      last_reconciled_at BIGINT,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (vendor, entity_type, entity_id)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_${table}_vendor_type ON ${table}(vendor, entity_type)`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_${table}_local_updated ON ${table}(local_updated_at)`,
  );
};

type Row = {
  vendor: string;
  entity_type: string;
  entity_id: string;
  data_json: Record<string, unknown>;
  origin: string;
  vendor_updated_at: string | number | null;
  local_updated_at: string | number;
  last_reconciled_at: string | number | null;
  version: number;
};

const toNumber = (v: string | number | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const rowToRecord = (row: Row): CRMLocalEntityRecord => {
  const vendorUpdatedAt = toNumber(row.vendor_updated_at);
  const lastReconciledAt = toNumber(row.last_reconciled_at);
  return {
    data: row.data_json,
    entityId: row.entity_id,
    entityType: row.entity_type as CRMEntityType,
    localUpdatedAt: Number(row.local_updated_at),
    origin: row.origin as CRMLocalEntityOrigin,
    vendor: row.vendor as CRMVendor,
    version: row.version,
    ...(lastReconciledAt !== undefined ? { lastReconciledAt } : {}),
    ...(vendorUpdatedAt !== undefined ? { vendorUpdatedAt } : {}),
  };
};

export const createPostgresCRMLocalEntityStore = async (
  options: CreatePostgresCRMLocalEntityStoreOptions,
): Promise<CRMLocalEntityStore> => {
  const table = options.tableName ?? "crm_local_entities";
  if (options.autoMigrate !== false) {
    await ensureSchema(options.query, table);
  }
  const query = options.query;

  return {
    async get(vendor, entityType, entityId) {
      const rows = await query<Row>(
        `SELECT * FROM ${table} WHERE vendor = $1 AND entity_type = $2 AND entity_id = $3`,
        [vendor, entityType, entityId],
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    },
    async list(filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter?.vendor) {
        params.push(filter.vendor);
        conditions.push(`vendor = $${params.length}`);
      }
      if (filter?.entityType) {
        params.push(filter.entityType);
        conditions.push(`entity_type = $${params.length}`);
      }
      if (filter?.sinceMs !== undefined) {
        params.push(filter.sinceMs);
        conditions.push(`local_updated_at >= $${params.length}`);
      }
      const where =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await query<Row>(
        `SELECT * FROM ${table} ${where}`,
        params,
      );
      return rows.map(rowToRecord);
    },
    async put(record) {
      await query(
        `INSERT INTO ${table}
          (vendor, entity_type, entity_id, data_json, origin,
           vendor_updated_at, local_updated_at, last_reconciled_at, version)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 1)
         ON CONFLICT (vendor, entity_type, entity_id) DO UPDATE SET
           data_json = EXCLUDED.data_json,
           origin = EXCLUDED.origin,
           vendor_updated_at = EXCLUDED.vendor_updated_at,
           local_updated_at = EXCLUDED.local_updated_at,
           last_reconciled_at = EXCLUDED.last_reconciled_at,
           version = ${table}.version + 1`,
        [
          record.vendor,
          record.entityType,
          record.entityId,
          JSON.stringify(record.data),
          record.origin,
          record.vendorUpdatedAt ?? null,
          record.localUpdatedAt,
          record.lastReconciledAt ?? null,
        ],
      );
    },
    async remove(vendor, entityType, entityId) {
      const rows = await query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM ${table}
           WHERE vendor = $1 AND entity_type = $2 AND entity_id = $3
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM deleted`,
        [vendor, entityType, entityId],
      );
      return Number(rows[0]?.count ?? "0") > 0;
    },
  };
};
