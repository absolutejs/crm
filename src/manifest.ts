import {
  defineImplementation,
  defineManifest,
  toolFactory,
} from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { CRMRuntime, CRMRuntimeOptions } from "./runtime";

const tool = toolFactory<CRMRuntime>();

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_LIMIT = 100;

const vendorSchema = Type.Union(
  [
    Type.Literal("salesforce"),
    Type.Literal("hubspot"),
    Type.Literal("pipedrive"),
    Type.Literal("zoho"),
    Type.Literal("attio"),
    Type.Literal("close"),
    Type.Literal("monday"),
    Type.Literal("gohighlevel"),
  ],
  { description: "Which connected CRM vendor to talk to." },
);

const postgresStoreRequires = {
  env: [
    {
      description: "Postgres connection string for the CRM tables",
      example: "postgres://user:pass@host/db",
      key: "DATABASE_URL",
      secret: true,
    },
  ],
  peers: [
    {
      name: "pg",
      range: "^8.0.0",
      reason: "Postgres client pool behind the query runner",
    },
  ],
  services: [
    {
      description: "CRM token / sync-queue / entity-mirror tables live here",
      id: "postgres",
    },
  ],
} as const;

/* Serializable subset of CRMRuntimeOptions: echoSuppressionWindowMs only.
 * tokenStore / syncQueue / localEntityStore are instance-valued → slots;
 * adapters is a per-vendor factory map and conflictResolver /
 * reconcileResolver / now are function-valued → wiring concerns.
 * Postgres store wirings reference the `crmQuery` binding declared by the
 * postgres-query-runner recipe (v1 user-defined-binding convention). */
export const manifest = defineManifest<CRMRuntimeOptions, CRMRuntime>()({
  contract: 1,
  identity: {
    accent: "#e11d48",
    category: "commerce",
    description:
      "Multi-vendor CRM runtime: one normalized API (contacts, leads, deals, accounts, activities, notes, tasks, pipelines) over Salesforce, HubSpot, Pipedrive, Zoho, Attio, Close, Monday, and GoHighLevel — per-user OAuth adapters, pluggable token/queue/mirror stores, an outbound sync queue with retries, inbound webhook normalization, and optional bidirectional reconciliation with conflict resolvers.",
    docsUrl: "https://github.com/absolutejs/crm",
    name: "@absolutejs/crm",
    tagline: "Connect your customers' CRMs — one API for all of them.",
  },
  requires: {
    peers: [
      {
        name: "citra",
        range: ">=0.27.0",
        reason: "OAuth2 client plumbing for vendor token flows",
      },
      {
        name: "@absolutejs/auth",
        range: ">=0.22.7",
        reason: "hosts the per-vendor OAuth sign-in flow",
      },
    ],
    services: [
      {
        description:
          "Durable token / sync-queue / entity-mirror storage (postgres store implementations)",
        id: "postgres",
        optional: true,
      },
    ],
  },
  implements: [
    defineImplementation<Record<never, never>>()({
      contract: "crm/token-store",
      factory: "createInMemoryCRMTokenStore",
      from: "@absolutejs/crm",
      title: "In-memory (development only — tokens are lost on restart)",
      wiring: {
        code: "createInMemoryCRMTokenStore()",
        imports: [
          { from: "@absolutejs/crm", names: ["createInMemoryCRMTokenStore"] },
        ],
      },
    }),
    defineImplementation<{ tableName?: string; autoMigrate?: boolean }>()({
      contract: "crm/token-store",
      factory: "createPostgresCRMTokenStore",
      from: "@absolutejs/crm",
      requires: postgresStoreRequires,
      settings: Type.Object({
        autoMigrate: Type.Optional(
          Type.Boolean({
            default: true,
            description:
              "Create the token table automatically on first use.",
            title: "Auto-migrate",
          }),
        ),
        tableName: Type.Optional(
          Type.String({
            default: "crm_tokens",
            description: "Postgres table the OAuth tokens are stored in.",
            title: "Table name",
          }),
        ),
      }),
      title: "Postgres",
      wiring: {
        code: "createPostgresCRMTokenStore({ query: crmQuery, ...${settings} })",
        imports: [
          { from: "@absolutejs/crm", names: ["createPostgresCRMTokenStore"] },
        ],
      },
    }),
    defineImplementation<{
      defaultMaxAttempts?: number;
      retryBackoffMs?: number;
    }>()({
      contract: "crm/sync-queue",
      factory: "createInMemoryCRMSyncQueue",
      from: "@absolutejs/crm",
      settings: Type.Object({
        defaultMaxAttempts: Type.Optional(
          Type.Integer({
            description:
              "How many times a failed outbound job is retried before dead-lettering.",
            minimum: 1,
            title: "Max attempts",
          }),
        ),
        retryBackoffMs: Type.Optional(
          Type.Integer({
            description: "Base delay between retries, in milliseconds.",
            minimum: 0,
            title: "Retry backoff (ms)",
          }),
        ),
      }),
      title: "In-memory (development only — pending jobs are lost on restart)",
      wiring: {
        code: "createInMemoryCRMSyncQueue(${settings})",
        imports: [
          { from: "@absolutejs/crm", names: ["createInMemoryCRMSyncQueue"] },
        ],
      },
    }),
    defineImplementation<{
      jobsTable?: string;
      changesTable?: string;
      defaultMaxAttempts?: number;
      retryBackoffMs?: number;
      autoMigrate?: boolean;
    }>()({
      contract: "crm/sync-queue",
      factory: "createPostgresCRMSyncQueue",
      from: "@absolutejs/crm",
      requires: postgresStoreRequires,
      settings: Type.Object({
        autoMigrate: Type.Optional(
          Type.Boolean({
            default: true,
            description: "Create the queue tables automatically on first use.",
            title: "Auto-migrate",
          }),
        ),
        changesTable: Type.Optional(
          Type.String({
            default: "crm_changes",
            description: "Postgres table inbound change events are stored in.",
            title: "Changes table",
          }),
        ),
        defaultMaxAttempts: Type.Optional(
          Type.Integer({
            description:
              "How many times a failed outbound job is retried before dead-lettering.",
            minimum: 1,
            title: "Max attempts",
          }),
        ),
        jobsTable: Type.Optional(
          Type.String({
            default: "crm_sync_jobs",
            description: "Postgres table outbound sync jobs are stored in.",
            title: "Jobs table",
          }),
        ),
        retryBackoffMs: Type.Optional(
          Type.Integer({
            description: "Base delay between retries, in milliseconds.",
            minimum: 0,
            title: "Retry backoff (ms)",
          }),
        ),
      }),
      title: "Postgres",
      wiring: {
        code: "createPostgresCRMSyncQueue({ query: crmQuery, ...${settings} })",
        imports: [
          { from: "@absolutejs/crm", names: ["createPostgresCRMSyncQueue"] },
        ],
      },
    }),
    defineImplementation<Record<never, never>>()({
      contract: "crm/local-entity-store",
      factory: "createInMemoryCRMLocalEntityStore",
      from: "@absolutejs/crm",
      title: "In-memory (development only — the mirror is lost on restart)",
      wiring: {
        code: "createInMemoryCRMLocalEntityStore()",
        imports: [
          {
            from: "@absolutejs/crm",
            names: ["createInMemoryCRMLocalEntityStore"],
          },
        ],
      },
    }),
    defineImplementation<{ tableName?: string; autoMigrate?: boolean }>()({
      contract: "crm/local-entity-store",
      factory: "createPostgresCRMLocalEntityStore",
      from: "@absolutejs/crm",
      requires: postgresStoreRequires,
      settings: Type.Object({
        autoMigrate: Type.Optional(
          Type.Boolean({
            default: true,
            description:
              "Create the mirror table automatically on first use.",
            title: "Auto-migrate",
          }),
        ),
        tableName: Type.Optional(
          Type.String({
            default: "crm_local_entities",
            description:
              "Postgres table the local entity mirror is stored in.",
            title: "Table name",
          }),
        ),
      }),
      title: "Postgres",
      wiring: {
        code: "createPostgresCRMLocalEntityStore({ query: crmQuery, ...${settings} })",
        imports: [
          {
            from: "@absolutejs/crm",
            names: ["createPostgresCRMLocalEntityStore"],
          },
        ],
      },
    }),
  ],
  settings: Type.Object({
    echoSuppressionWindowMs: Type.Optional(
      Type.Integer({
        description:
          "After your app writes to a CRM, inbound webhook echoes of that same write are ignored for this many milliseconds so they don't loop back as changes.",
        minimum: 0,
        title: "Echo-suppression window (ms)",
      }),
    ),
  }),
  slots: {
    localEntityStore: {
      configPath: "localEntityStore",
      contract: "crm/local-entity-store",
      description:
        "Local mirror of CRM records (enables bidirectional sync and offline reads)",
      known: ["@absolutejs/crm#memory", "@absolutejs/crm#postgres"],
    },
    syncQueue: {
      configPath: "syncQueue",
      contract: "crm/sync-queue",
      description: "Where outbound CRM writes queue and retry",
      known: ["@absolutejs/crm#memory", "@absolutejs/crm#postgres"],
      required: true,
    },
    tokenStore: {
      configPath: "tokenStore",
      contract: "crm/token-store",
      description: "Where each user's CRM OAuth tokens are kept",
      known: ["@absolutejs/crm#memory", "@absolutejs/crm#postgres"],
      required: true,
    },
  },
  tools: {
    add_note: tool.runtime({
      annotations: { openWorldHint: true },
      description:
        "Add a note to the user's CRM, optionally attached to contacts, a deal, or an account. Returns the created note with its CRM id.",
      handler: async (
        { accountId, body, contactIds, dealId, userId, vendor },
        crm,
      ) => {
        const note = await crm.addNote(userId, vendor, {
          body,
          ...(accountId !== undefined ? { accountId } : {}),
          ...(contactIds !== undefined ? { contactIds } : {}),
          ...(dealId !== undefined ? { dealId } : {}),
        });

        return JSON.stringify(note);
      },
      input: Type.Object({
        accountId: Type.Optional(
          Type.String({ description: "CRM account id to attach the note to." }),
        ),
        body: Type.String({ minLength: 1 }),
        contactIds: Type.Optional(
          Type.Array(Type.String(), {
            description: "CRM contact ids to attach the note to.",
          }),
        ),
        dealId: Type.Optional(
          Type.String({ description: "CRM deal id to attach the note to." }),
        ),
        userId: Type.String({
          description: "The app user whose connected CRM account is used.",
          minLength: 1,
        }),
        vendor: vendorSchema,
      }),
    }),
    list_deals: tool.runtime({
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "List deals from the user's connected CRM (name, stage, amount, contacts). Returns a page of items plus a cursor for the next page.",
      handler: async ({ cursor, limit, userId, vendor }, crm) => {
        const result = await crm.listDeals(userId, vendor, {
          ...(cursor !== undefined ? { cursor } : {}),
          limit: limit ?? DEFAULT_SEARCH_LIMIT,
        });

        return result.items.length === 0
          ? "no deals found"
          : JSON.stringify(result);
      },
      input: Type.Object({
        cursor: Type.Optional(
          Type.String({
            description: "Pagination cursor from a previous page.",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({ maximum: MAX_LIMIT, minimum: 1 }),
        ),
        userId: Type.String({
          description: "The app user whose connected CRM account is used.",
          minLength: 1,
        }),
        vendor: vendorSchema,
      }),
    }),
    lookup_contact: tool.runtime({
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "Find one CRM contact by exact email address. Returns the normalized contact, or reports that none matched.",
      handler: async ({ email, userId, vendor }, crm) => {
        const contact = await crm.lookupContactByEmail(userId, vendor, email);

        return contact === null
          ? `no ${vendor} contact found for ${email}`
          : JSON.stringify(contact);
      },
      input: Type.Object({
        email: Type.String({ format: "email" }),
        userId: Type.String({
          description: "The app user whose connected CRM account is used.",
          minLength: 1,
        }),
        vendor: vendorSchema,
      }),
    }),
    search_contacts: tool.runtime({
      annotations: { openWorldHint: true, readOnlyHint: true },
      description:
        "Search contacts in the user's connected CRM by name, email, or free text. Returns normalized contacts (same shape across every vendor).",
      handler: async ({ limit, query, userId, vendor }, crm) => {
        const contacts = await crm.searchContacts(
          userId,
          vendor,
          query,
          limit ?? DEFAULT_SEARCH_LIMIT,
        );

        return contacts.length === 0
          ? `no ${vendor} contacts matched "${query}"`
          : JSON.stringify(contacts);
      },
      input: Type.Object({
        limit: Type.Optional(
          Type.Integer({ maximum: MAX_LIMIT, minimum: 1 }),
        ),
        query: Type.String({ minLength: 1 }),
        userId: Type.String({
          description: "The app user whose connected CRM account is used.",
          minLength: 1,
        }),
        vendor: vendorSchema,
      }),
    }),
  },
  wiring: [
    {
      description:
        "Outbound-only setup: normalized reads/writes against each user's connected CRM, with writes retried through the sync queue. Register the vendor adapter factories your users connect.",
      id: "default",
      server: {
        code: [
          "const crm = createCRMRuntime({",
          "\tadapters: { hubspot: createHubSpotCRMAdapter, salesforce: createSalesforceCRMAdapter },",
          "\tsyncQueue: ${slot.syncQueue},",
          "\ttokenStore: ${slot.tokenStore},",
          "\t...${settings}",
          "});",
        ].join("\n"),
        imports: [
          {
            from: "@absolutejs/crm",
            names: [
              "createCRMRuntime",
              "createHubSpotCRMAdapter",
              "createSalesforceCRMAdapter",
            ],
          },
        ],
        placement: "module-scope",
      },
      title: "Create the CRM runtime",
    },
    {
      description:
        "Adds the local entity mirror so inbound webhooks reconcile against local edits (bidirectional sync). Rides the default recipe's adapter registration.",
      id: "bidirectional",
      server: {
        code: [
          "const crm = createCRMRuntime({",
          "\tadapters: { hubspot: createHubSpotCRMAdapter, salesforce: createSalesforceCRMAdapter },",
          "\tlocalEntityStore: ${slot.localEntityStore},",
          "\tsyncQueue: ${slot.syncQueue},",
          "\ttokenStore: ${slot.tokenStore},",
          "\t...${settings}",
          "});",
        ].join("\n"),
        imports: [
          {
            from: "@absolutejs/crm",
            names: [
              "createCRMRuntime",
              "createHubSpotCRMAdapter",
              "createSalesforceCRMAdapter",
            ],
          },
        ],
        placement: "module-scope",
      },
      title: "Create the CRM runtime with bidirectional sync",
    },
    {
      description:
        "Declares the `crmQuery` binding the Postgres store implementations reference — a (sql, params) => rows runner over a pg pool.",
      id: "postgres-query-runner",
      server: {
        code: [
          "const crmPool = new Pool({ connectionString: ${env.DATABASE_URL} });",
          "const crmQuery = (text, params) => crmPool.query(text, params ?? []).then((result) => result.rows);",
        ].join("\n"),
        imports: [{ from: "pg", names: ["Pool"] }],
        placement: "module-scope",
      },
      title: "Declare the Postgres query runner",
    },
  ],
});
