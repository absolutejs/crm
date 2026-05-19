import type { CRMVendor } from "../types";

export type CRMVendorTokenContext = {
  instanceUrl?: string;
  apiDomain?: string;
  region?: string;
  subAccountId?: string;
};

export type CRMTokenRecord = {
  userId: string;
  vendor: CRMVendor;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  context?: CRMVendorTokenContext;
  createdAt: number;
  updatedAt: number;
};

export type CRMTokenStore = {
  get(userId: string, vendor: CRMVendor): Promise<CRMTokenRecord | null>;
  put(record: CRMTokenRecord): Promise<void>;
  remove(userId: string, vendor: CRMVendor): Promise<boolean>;
  listVendorsForUser(userId: string): Promise<CRMVendor[]>;
  listUsersForVendor?(vendor: CRMVendor): Promise<string[]>;
};

export { createInMemoryCRMTokenStore } from "./inMemoryTokenStore";
export type { CreateInMemoryCRMTokenStoreOptions } from "./inMemoryTokenStore";
export { createRedisCRMTokenStore } from "./redisTokenStore";
export type {
  CreateRedisCRMTokenStoreOptions,
  RedisLikeClient,
} from "./redisTokenStore";
export { createSqliteCRMTokenStore } from "./sqliteTokenStore";
export type {
  CreateSqliteCRMTokenStoreOptions,
  SqliteLikeDatabase,
  SqliteLikeStatement,
} from "./sqliteTokenStore";
export { createPostgresCRMTokenStore } from "./postgresTokenStore";
export type {
  CreatePostgresCRMTokenStoreOptions,
  PostgresQueryRunner,
} from "./postgresTokenStore";
export {
  createInMemoryCRMLocalEntityStore,
} from "./localEntityStore";
export type {
  CreateInMemoryCRMLocalEntityStoreOptions,
  CRMLocalEntityOrigin,
  CRMLocalEntityRecord,
  CRMLocalEntityStore,
} from "./localEntityStore";
