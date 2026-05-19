import type { CRMVendor } from "../types";
import type { CRMTokenRecord, CRMTokenStore } from "./index";

export type RedisLikeClient = {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<unknown> | unknown;
  del(key: string): Promise<number> | number;
  sadd(key: string, member: string): Promise<unknown> | unknown;
  srem(key: string, member: string): Promise<unknown> | unknown;
  smembers(key: string): Promise<string[]> | string[];
};

export type CreateRedisCRMTokenStoreOptions = {
  client: RedisLikeClient;
  keyPrefix?: string;
};

const tokenKey = (prefix: string, userId: string, vendor: CRMVendor) =>
  `${prefix}:tkn:${userId}:${vendor}`;
const userVendorsKey = (prefix: string, userId: string) =>
  `${prefix}:user-vendors:${userId}`;
const vendorUsersKey = (prefix: string, vendor: CRMVendor) =>
  `${prefix}:vendor-users:${vendor}`;

export const createRedisCRMTokenStore = (
  options: CreateRedisCRMTokenStoreOptions,
): CRMTokenStore => {
  const prefix = options.keyPrefix ?? "crm";
  const client = options.client;

  return {
    async get(userId, vendor) {
      const raw = await client.get(tokenKey(prefix, userId, vendor));
      if (!raw) return null;
      return JSON.parse(raw) as CRMTokenRecord;
    },
    async listUsersForVendor(vendor) {
      const members = await client.smembers(vendorUsersKey(prefix, vendor));
      return members;
    },
    async listVendorsForUser(userId) {
      const members = await client.smembers(userVendorsKey(prefix, userId));
      return members as CRMVendor[];
    },
    async put(record) {
      await client.set(
        tokenKey(prefix, record.userId, record.vendor),
        JSON.stringify(record),
      );
      await client.sadd(
        userVendorsKey(prefix, record.userId),
        record.vendor,
      );
      await client.sadd(
        vendorUsersKey(prefix, record.vendor),
        record.userId,
      );
    },
    async remove(userId, vendor) {
      const removed = await client.del(tokenKey(prefix, userId, vendor));
      await client.srem(userVendorsKey(prefix, userId), vendor);
      await client.srem(vendorUsersKey(prefix, vendor), userId);
      return Number(removed) > 0;
    },
  };
};
