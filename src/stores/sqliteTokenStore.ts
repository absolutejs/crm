import type { CRMVendor } from "../types";
import type { CRMTokenRecord, CRMTokenStore } from "./index";

export type SqliteLikeDatabase = {
  prepare(sql: string): SqliteLikeStatement;
  exec(sql: string): unknown;
};

export type SqliteLikeStatement = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
};

export type CreateSqliteCRMTokenStoreOptions = {
  db: SqliteLikeDatabase;
  tableName?: string;
};

const ensureSchema = (db: SqliteLikeDatabase, table: string) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      user_id TEXT NOT NULL,
      vendor TEXT NOT NULL,
      record_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, vendor)
    );
    CREATE INDEX IF NOT EXISTS idx_${table}_vendor ON ${table}(vendor);
  `);
};

type Row = { record_json: string };

export const createSqliteCRMTokenStore = (
  options: CreateSqliteCRMTokenStoreOptions,
): CRMTokenStore => {
  const table = options.tableName ?? "crm_tokens";
  ensureSchema(options.db, table);

  const getStmt = options.db.prepare(
    `SELECT record_json FROM ${table} WHERE user_id = ? AND vendor = ?`,
  );
  const upsertStmt = options.db.prepare(
    `INSERT INTO ${table} (user_id, vendor, record_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, vendor) DO UPDATE SET
       record_json = excluded.record_json,
       updated_at = excluded.updated_at`,
  );
  const deleteStmt = options.db.prepare(
    `DELETE FROM ${table} WHERE user_id = ? AND vendor = ?`,
  );
  const listVendorsStmt = options.db.prepare(
    `SELECT vendor FROM ${table} WHERE user_id = ?`,
  );
  const listUsersStmt = options.db.prepare(
    `SELECT user_id FROM ${table} WHERE vendor = ?`,
  );

  return {
    async get(userId, vendor) {
      const row = getStmt.get(userId, vendor) as Row | undefined;
      if (!row) return null;
      return JSON.parse(row.record_json) as CRMTokenRecord;
    },
    async listUsersForVendor(vendor) {
      const rows = listUsersStmt.all(vendor) as { user_id: string }[];
      return rows.map((r) => r.user_id);
    },
    async listVendorsForUser(userId) {
      const rows = listVendorsStmt.all(userId) as { vendor: string }[];
      return rows.map((r) => r.vendor as CRMVendor);
    },
    async put(record) {
      upsertStmt.run(
        record.userId,
        record.vendor,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
    },
    async remove(userId, vendor) {
      const result = deleteStmt.run(userId, vendor) as { changes?: number };
      return (result.changes ?? 0) > 0;
    },
  };
};
