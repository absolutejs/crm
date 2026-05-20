import type { CRMEntityType, CRMVendor } from "../types";
import type { RedisLikeClient } from "./redisTokenStore";
import type {
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
} from "./localEntityStore";

export type CreateRedisCRMLocalEntityStoreOptions = {
  client: RedisLikeClient;
  keyPrefix?: string;
};

const entityKey = (
  prefix: string,
  vendor: CRMVendor,
  entityType: CRMEntityType,
  entityId: string,
) => `${prefix}:entity:${vendor}:${entityType}:${entityId}`;

const vendorEntityIndexKey = (
  prefix: string,
  vendor: CRMVendor,
  entityType: CRMEntityType,
) => `${prefix}:entity-index:${vendor}:${entityType}`;

const globalIndexKey = (prefix: string) => `${prefix}:entity-index:all`;

export const createRedisCRMLocalEntityStore = (
  options: CreateRedisCRMLocalEntityStoreOptions,
): CRMLocalEntityStore => {
  const prefix = options.keyPrefix ?? "crm";
  const client = options.client;

  return {
    async get(vendor, entityType, entityId) {
      const raw = await client.get(entityKey(prefix, vendor, entityType, entityId));
      if (!raw) return null;
      return JSON.parse(raw) as CRMLocalEntityRecord;
    },
    async list(filter) {
      const indexKey = filter?.vendor && filter.entityType
        ? vendorEntityIndexKey(prefix, filter.vendor, filter.entityType)
        : globalIndexKey(prefix);
      const members = await client.smembers(indexKey);
      const out: CRMLocalEntityRecord[] = [];
      for (const member of members) {
        const [vendor, entityType, entityId] = member.split("::") as [
          CRMVendor,
          CRMEntityType,
          string,
        ];
        if (filter?.vendor && vendor !== filter.vendor) continue;
        if (filter?.entityType && entityType !== filter.entityType) continue;
        const raw = await client.get(
          entityKey(prefix, vendor, entityType, entityId),
        );
        if (!raw) continue;
        const record = JSON.parse(raw) as CRMLocalEntityRecord;
        if (
          filter?.sinceMs !== undefined &&
          record.localUpdatedAt < filter.sinceMs
        ) {
          continue;
        }
        out.push(record);
      }
      return out;
    },
    async put(record) {
      const existing = await client.get(
        entityKey(prefix, record.vendor, record.entityType, record.entityId),
      );
      const previousVersion = existing
        ? ((JSON.parse(existing) as CRMLocalEntityRecord).version ?? 0)
        : 0;
      const next: CRMLocalEntityRecord = {
        ...record,
        version: previousVersion + 1,
      };
      await client.set(
        entityKey(prefix, record.vendor, record.entityType, record.entityId),
        JSON.stringify(next),
      );
      const member = `${record.vendor}::${record.entityType}::${record.entityId}`;
      await client.sadd(
        vendorEntityIndexKey(prefix, record.vendor, record.entityType),
        member,
      );
      await client.sadd(globalIndexKey(prefix), member);
    },
    async remove(vendor, entityType, entityId) {
      const removed = await client.del(
        entityKey(prefix, vendor, entityType, entityId),
      );
      const member = `${vendor}::${entityType}::${entityId}`;
      await client.srem(vendorEntityIndexKey(prefix, vendor, entityType), member);
      await client.srem(globalIndexKey(prefix), member);
      return Number(removed) > 0;
    },
  };
};
