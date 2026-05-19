import type { CRMVendor } from "../types";
import type { CRMTokenRecord, CRMTokenStore } from "./index";

export type CreateInMemoryCRMTokenStoreOptions = {
  seed?: CRMTokenRecord[];
};

const keyFor = (userId: string, vendor: CRMVendor) => `${userId}::${vendor}`;

const cloneRecord = (record: CRMTokenRecord): CRMTokenRecord => ({
  ...record,
  context: record.context ? { ...record.context } : undefined,
  scopes: record.scopes ? [...record.scopes] : undefined,
});

export const createInMemoryCRMTokenStore = (
  options: CreateInMemoryCRMTokenStoreOptions = {},
): CRMTokenStore => {
  const store = new Map<string, CRMTokenRecord>();
  for (const record of options.seed ?? []) {
    store.set(keyFor(record.userId, record.vendor), cloneRecord(record));
  }

  return {
    async get(userId, vendor) {
      const record = store.get(keyFor(userId, vendor));
      return record ? cloneRecord(record) : null;
    },
    async listUsersForVendor(vendor) {
      const users = new Set<string>();
      for (const record of store.values()) {
        if (record.vendor === vendor) users.add(record.userId);
      }
      return Array.from(users);
    },
    async listVendorsForUser(userId) {
      const vendors = new Set<CRMVendor>();
      for (const record of store.values()) {
        if (record.userId === userId) vendors.add(record.vendor);
      }
      return Array.from(vendors);
    },
    async put(record) {
      store.set(keyFor(record.userId, record.vendor), cloneRecord(record));
    },
    async remove(userId, vendor) {
      return store.delete(keyFor(userId, vendor));
    },
  };
};
