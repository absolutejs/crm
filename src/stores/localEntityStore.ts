import type { CRMEntityType, CRMVendor } from "../types";

export type CRMLocalEntityOrigin = "app" | "vendor" | "reconciled";

export type CRMLocalEntityRecord = {
  vendor: CRMVendor;
  entityType: CRMEntityType;
  entityId: string;
  data: Record<string, unknown>;
  origin: CRMLocalEntityOrigin;
  vendorUpdatedAt?: number;
  localUpdatedAt: number;
  lastReconciledAt?: number;
  version?: number;
};

export type CRMLocalEntityStore = {
  get(
    vendor: CRMVendor,
    entityType: CRMEntityType,
    entityId: string,
  ): Promise<CRMLocalEntityRecord | null>;
  put(record: CRMLocalEntityRecord): Promise<void>;
  remove(
    vendor: CRMVendor,
    entityType: CRMEntityType,
    entityId: string,
  ): Promise<boolean>;
  list(filter?: {
    vendor?: CRMVendor;
    entityType?: CRMEntityType;
    sinceMs?: number;
  }): Promise<CRMLocalEntityRecord[]>;
};

const keyFor = (
  vendor: CRMVendor,
  entityType: CRMEntityType,
  entityId: string,
): string => `${vendor}::${entityType}::${entityId}`;

const cloneRecord = (record: CRMLocalEntityRecord): CRMLocalEntityRecord => ({
  ...record,
  data: { ...record.data },
});

export type CreateInMemoryCRMLocalEntityStoreOptions = {
  seed?: CRMLocalEntityRecord[];
};

export const createInMemoryCRMLocalEntityStore = (
  options: CreateInMemoryCRMLocalEntityStoreOptions = {},
): CRMLocalEntityStore => {
  const store = new Map<string, CRMLocalEntityRecord>();
  for (const record of options.seed ?? []) {
    store.set(
      keyFor(record.vendor, record.entityType, record.entityId),
      cloneRecord(record),
    );
  }

  return {
    async get(vendor, entityType, entityId) {
      const record = store.get(keyFor(vendor, entityType, entityId));
      return record ? cloneRecord(record) : null;
    },
    async list(filter) {
      const out: CRMLocalEntityRecord[] = [];
      for (const record of store.values()) {
        if (filter?.vendor && record.vendor !== filter.vendor) continue;
        if (filter?.entityType && record.entityType !== filter.entityType) continue;
        if (
          filter?.sinceMs !== undefined &&
          record.localUpdatedAt < filter.sinceMs
        ) {
          continue;
        }
        out.push(cloneRecord(record));
      }
      return out;
    },
    async put(record) {
      const existing = store.get(
        keyFor(record.vendor, record.entityType, record.entityId),
      );
      const next: CRMLocalEntityRecord = {
        ...record,
        version: (existing?.version ?? 0) + 1,
      };
      store.set(
        keyFor(record.vendor, record.entityType, record.entityId),
        cloneRecord(next),
      );
    },
    async remove(vendor, entityType, entityId) {
      return store.delete(keyFor(vendor, entityType, entityId));
    },
  };
};
