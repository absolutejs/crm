import type { CRMVendor } from "../types";
import type { CRMTokenRecord, CRMTokenStore } from "./index";

export type PostgresQueryRunner = <T = unknown>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export type CreatePostgresCRMTokenStoreOptions = {
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
      user_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      record_json JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, vendor)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_${table}_vendor ON ${table}(vendor)`,
  );
};

export const createPostgresCRMTokenStore = async (
  options: CreatePostgresCRMTokenStoreOptions,
): Promise<CRMTokenStore> => {
  const table = options.tableName ?? "crm_tokens";
  if (options.autoMigrate !== false) {
    await ensureSchema(options.query, table);
  }
  const query = options.query;

  return {
    async get(userId, vendor) {
      const rows = await query<{ record_json: CRMTokenRecord }>(
        `SELECT record_json FROM ${table} WHERE user_id = $1 AND vendor = $2`,
        [userId, vendor],
      );
      return rows[0]?.record_json ?? null;
    },
    async listUsersForVendor(vendor) {
      const rows = await query<{ user_id: string }>(
        `SELECT user_id FROM ${table} WHERE vendor = $1`,
        [vendor],
      );
      return rows.map((r) => r.user_id);
    },
    async listVendorsForUser(userId) {
      const rows = await query<{ vendor: string }>(
        `SELECT vendor FROM ${table} WHERE user_id = $1`,
        [userId],
      );
      return rows.map((r) => r.vendor as CRMVendor);
    },
    async put(record) {
      await query(
        `INSERT INTO ${table} (user_id, vendor, record_json, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (user_id, vendor) DO UPDATE SET
           record_json = EXCLUDED.record_json,
           updated_at = EXCLUDED.updated_at`,
        [
          record.userId,
          record.vendor,
          JSON.stringify(record),
          record.createdAt,
          record.updatedAt,
        ],
      );
    },
    async remove(userId, vendor) {
      const rows = await query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM ${table}
           WHERE user_id = $1 AND vendor = $2
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM deleted`,
        [userId, vendor],
      );
      return Number(rows[0]?.count ?? "0") > 0;
    },
  };
};
