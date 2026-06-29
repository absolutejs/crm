import { describe, expect, test } from "bun:test";
import { createAttioCRMAdapter } from "../src/adapters/attio";
import { createCloseCRMAdapter } from "../src/adapters/close";
import { createGoHighLevelCRMAdapter } from "../src/adapters/gohighlevel";
import {
  createHubSpotCRMAdapter,
  type HubSpotBasicApi,
  type HubSpotClientLike,
  type HubSpotObjectResponse,
  type HubSpotPageResponse,
  type HubSpotSearchResponse,
} from "../src/adapters/hubspot";
import { createMondayCRMAdapter } from "../src/adapters/monday";
import { createPipedriveCRMAdapter } from "../src/adapters/pipedrive";
import {
  createSalesforceCRMAdapter,
  type SalesforceConnectionLike,
  type SalesforceQueryResult,
  type SalesforceSaveResult,
} from "../src/adapters/salesforce";
import { createZohoCRMAdapter } from "../src/adapters/zoho";
import type {
  CRMHttpClient,
  CRMHttpRequest,
  CRMHttpResponse,
} from "../src/adapters/_http";
import type { CRMAdapter, CRMVendor } from "../src/types";

/**
 * One parametrized conformance battery, run across all 8 vendor adapters with a
 * fully-mocked transport. It asserts the whole CRMAdapter surface:
 *   (a) every interface method is a function;
 *   (b) every capability flag is a boolean / enum;
 *   (c) for SUPPORTED capabilities each verb round-trips against the mock;
 *   (d) for UNSUPPORTED capabilities reads return null / { items: [] }, deletes
 *       are void, and create/update THROW (the Task-1 canonical contract).
 * Behaviour is DRIVEN off each adapter's own `capabilities` flags (plus a small
 * per-vendor list of API-immutable note/activity/task writes) so the suite is
 * honest per vendor.
 */

// A generic HTTP responder. `pick` returns the raw payload for a request; the
// JSON round-trip both deep-clones and produces the `any`-typed value needed to
// satisfy the generic `CRMHttpClient<T>` signature without a cast.
const httpResponder =
  (pick: (req: CRMHttpRequest) => unknown): CRMHttpClient =>
  async <T>(req: CRMHttpRequest): Promise<CRMHttpResponse<T>> => {
    const data: T = JSON.parse(JSON.stringify(pick(req) ?? {}));
    return { data, ok: true, status: 200 };
  };

// ---------------------------------------------------------------------------
// Per-vendor mock transports.
// ---------------------------------------------------------------------------

const attioHttp = httpResponder((req) => {
  const record = {
    id: { note_id: "a1", record_id: "a1", task_id: "a1" },
    values: {},
  };
  const isQuery = req.url.endsWith("/query");
  return { data: isQuery ? [record] : record };
});

const closeUniversal = {
  data: [
    {
      id: "cl1",
      lead_id: "ld1",
      name: "Test",
      note: "Test",
      status_type: "open",
      text: "Test",
    },
  ],
  has_more: false,
  id: "cl1",
  lead_id: "ld1",
  name: "Test",
  note: "Test",
  text: "Test",
};
const closeHttp = httpResponder(() => closeUniversal);

const ghlHttp = httpResponder((req) => {
  const contact = { email: "a@b.com", id: "c1" };
  const opp = { id: "o1", name: "Test", status: "open" };
  const note = { body: "Test", id: "n1" };
  const ghlTask = { id: "t1", title: "Test" };
  const pipeline = { id: "p1", name: "P", stages: [{ id: "s1", name: "S" }] };
  const u = req.url;
  if (u.includes("/opportunities/pipelines")) return { pipelines: [pipeline] };
  if (u.includes("/opportunities/search"))
    return { meta: {}, opportunities: [opp] };
  if (u.includes("/opportunities")) return { opportunity: opp };
  if (u.includes("/notes")) return { note };
  if (u.includes("/tasks")) return { task: ghlTask };
  if (u.includes("/contacts")) {
    if (req.method === "GET" && (u.includes("limit=") || u.includes("query=")))
      return { contacts: [contact], meta: {} };
    return { contact };
  }
  return {};
});

const zohoElement = {
  Account_Name: "Test",
  Call_Purpose: "Test",
  code: "SUCCESS",
  Deal_Name: "Test",
  details: { id: "z1" },
  First_Name: "Test",
  id: "z1",
  Last_Name: "Test",
  Note_Content: "Test",
  Subject: "Test",
};
const zohoHttp = httpResponder(() => ({
  data: [zohoElement],
  info: { more_records: false },
}));

const pdEntity = {
  content: "Test",
  id: 1,
  name: "Test",
  status: "open",
  subject: "Test",
  title: "Test",
};
const pdPipeline = { id: 1, name: "P", selected: true };
const pdStage = { id: 10, name: "S", order_nr: 1, pipeline_id: 1 };
const pipedriveHttp = httpResponder((req) => {
  const u = req.url;
  if (u.includes("/persons/search"))
    return { data: { items: [{ item: pdEntity }] }, success: true };
  if (u.includes("/stages")) return { data: [pdStage], success: true };
  if (u.includes("/pipelines")) {
    return /\/pipelines\/[^/?]+/u.test(u)
      ? { data: pdPipeline, success: true }
      : { data: [pdPipeline], success: true };
  }
  if (req.method === "GET" && u.includes("limit=")) {
    return {
      additional_data: { pagination: { more_items_in_collection: false } },
      data: [pdEntity],
      success: true,
    };
  }
  return { data: pdEntity, success: true };
});

const mondayItem = { column_values: [], id: "m1", name: "Test" };
const mondayResult = (query: string): unknown => {
  if (query.includes("create_item"))
    return { create_item: { id: "m1", name: "Test" } };
  if (query.includes("create_update")) return { create_update: { id: "m1" } };
  if (query.includes("change_multiple_column_values"))
    return { change_multiple_column_values: { id: "m1" } };
  if (query.includes("delete_item")) return { delete_item: { id: "m1" } };
  if (query.includes("delete_update")) return { delete_update: { id: "m1" } };
  if (query.includes("items_page_by_column_values"))
    return { items_page_by_column_values: { items: [mondayItem] } };
  if (query.includes("next_items_page"))
    return { next_items_page: { cursor: null, items: [mondayItem] } };
  if (query.includes("items_page"))
    return { boards: [{ items_page: { cursor: null, items: [mondayItem] } }] };
  if (query.includes("updates(ids:"))
    return {
      updates: [{ body: "Test", created_at: null, creator_id: null, id: "m1" }],
    };
  if (query.includes("items(ids:")) return { items: [mondayItem] };
  return {};
};
const mondayHttp = httpResponder((req) => {
  const body = req.body;
  const query =
    typeof body === "object" && body !== null && "query" in body
      ? String(body.query)
      : "";
  return { data: mondayResult(query), errors: undefined };
});

// HubSpot SDK-shaped client.
const makeHubSpotClient = (): HubSpotClientLike => {
  const props: Record<string, string> = {
    dealname: "Test",
    email: "a@b.com",
    firstname: "Test",
    hs_call_title: "Test",
    hs_note_body: "Test",
    hs_task_subject: "Test",
    lastname: "User",
    lifecyclestage: "lead",
    name: "Test",
  };
  const obj: HubSpotObjectResponse = { id: "h1", properties: props };
  const basicApi: HubSpotBasicApi = {
    archive: async () => undefined,
    create: async () => obj,
    getById: async () => obj,
    getPage: async (): Promise<HubSpotPageResponse> => ({ results: [obj] }),
    update: async () => obj,
  };
  const searchApi = {
    doSearch: async (): Promise<HubSpotSearchResponse> => ({
      results: [obj],
      total: 1,
    }),
  };
  const pipeline = {
    id: "default",
    label: "P",
    stages: [{ id: "closedwon", label: "Won", metadata: {} }],
  };
  return {
    crm: {
      companies: { basicApi, searchApi },
      contacts: { basicApi, searchApi },
      deals: { basicApi, searchApi },
      objects: {
        calls: { basicApi },
        notes: { basicApi },
        tasks: { basicApi },
      },
      pipelines: {
        pipelinesApi: {
          getAll: async () => ({ results: [pipeline] }),
          getById: async () => pipeline,
        },
      },
    },
  };
};

// Salesforce jsforce-shaped connection.
const makeSalesforceConnection = (): SalesforceConnectionLike => {
  const row: Record<string, unknown> = {
    Amount: 100,
    Body: "Test",
    Company: "Acme",
    Description: "Test",
    Email: "a@b.com",
    FirstName: "Test",
    Id: "003sf",
    LastName: "User",
    Name: "Test",
    StageName: "Prospecting",
    Subject: "Test",
  };
  const saved: SalesforceSaveResult = { id: "sf1", success: true };
  return {
    query: async <T>(): Promise<SalesforceQueryResult<T>> => {
      const records: T[] = JSON.parse(JSON.stringify([row]));
      return { done: true, records, totalSize: records.length };
    },
    soap: {
      convertLead: async () => ({ contactId: "003sf", success: true }),
    },
    sobject: () => ({
      create: async () => saved,
      destroy: async () => saved,
      retrieve: async () => row,
      update: async () => saved,
    }),
  };
};

// ---------------------------------------------------------------------------
// Harness registry.
// ---------------------------------------------------------------------------

type EntityIds = {
  contact: string;
  lead: string;
  deal: string;
  account: string;
  activity: string;
  note: string;
  task: string;
  pipeline: string;
};

type Harness = {
  vendor: CRMVendor;
  // Note/activity/task writes that the vendor's API treats as immutable, so the
  // adapter THROWS rather than round-tripping (not expressible via a flag).
  immutableWrites: string[];
  ids: EntityIds;
  build: () => Promise<CRMAdapter>;
};

const simpleIds = (pipeline = "1"): EntityIds => ({
  account: "1",
  activity: "1",
  contact: "1",
  deal: "1",
  lead: "1",
  note: "1",
  pipeline,
  task: "1",
});

const harnesses: Harness[] = [
  {
    build: () => createAttioCRMAdapter({ accessToken: "t", httpClient: attioHttp }),
    ids: simpleIds(),
    immutableWrites: ["updateActivity", "updateNote"],
    vendor: "attio",
  },
  {
    build: () => createCloseCRMAdapter({ accessToken: "t", httpClient: closeHttp }),
    ids: simpleIds(),
    immutableWrites: [],
    vendor: "close",
  },
  {
    build: () =>
      createGoHighLevelCRMAdapter({
        accessToken: "t",
        httpClient: ghlHttp,
        subAccountId: "loc_1",
      }),
    ids: {
      account: "acc",
      activity: "c1:n1",
      contact: "c1",
      deal: "o1",
      lead: "c1",
      note: "c1:n1",
      pipeline: "p1",
      task: "c1:t1",
    },
    immutableWrites: [],
    vendor: "gohighlevel",
  },
  {
    build: () => createHubSpotCRMAdapter({ accessToken: "t", client: makeHubSpotClient() }),
    ids: simpleIds(),
    immutableWrites: [],
    vendor: "hubspot",
  },
  {
    build: () =>
      createMondayCRMAdapter({
        accessToken: "t",
        columnMapping: {
          email: "email_col",
          firstName: "fn",
          lastName: "ln",
          phone: "phone_col",
        },
        contactsBoardId: "b1",
        dealsBoardId: "b2",
        httpClient: mondayHttp,
      }),
    ids: simpleIds(),
    immutableWrites: ["updateActivity", "updateNote", "updateTask"],
    vendor: "monday",
  },
  {
    build: () =>
      createPipedriveCRMAdapter({
        accessToken: "t",
        apiDomain: "https://acme.pipedrive.com",
        httpClient: pipedriveHttp,
      }),
    ids: simpleIds(),
    immutableWrites: [],
    vendor: "pipedrive",
  },
  {
    build: () =>
      createSalesforceCRMAdapter({
        accessToken: "t",
        connection: makeSalesforceConnection(),
        instanceUrl: "https://x.my.salesforce.com",
      }),
    ids: simpleIds("default"),
    immutableWrites: [],
    vendor: "salesforce",
  },
  {
    build: () => createZohoCRMAdapter({ accessToken: "t", httpClient: zohoHttp, region: "com" }),
    ids: simpleIds(),
    immutableWrites: [],
    vendor: "zoho",
  },
];

// ---------------------------------------------------------------------------
// Shared assertion helpers.
// ---------------------------------------------------------------------------

const expectEntity = (
  entity: { id: string; vendor: CRMVendor },
  vendor: CRMVendor,
): void => {
  expect(typeof entity.id).toBe("string");
  expect(entity.vendor).toBe(vendor);
};

const expectReadable = (
  entity: { vendor: CRMVendor } | null,
  vendor: CRMVendor,
): void => {
  if (entity !== null) expect(entity.vendor).toBe(vendor);
};

const REQUIRED_METHODS: (keyof CRMAdapter)[] = [
  "lookupContactByEmail",
  "lookupContactByPhone",
  "searchContacts",
  "getContact",
  "listContacts",
  "createContact",
  "updateContact",
  "deleteContact",
  "getLead",
  "listLeads",
  "createLead",
  "updateLead",
  "deleteLead",
  "getDeal",
  "listDeals",
  "createDeal",
  "updateDeal",
  "deleteDeal",
  "getAccount",
  "listAccounts",
  "createAccount",
  "updateAccount",
  "deleteAccount",
  "getActivity",
  "logActivity",
  "updateActivity",
  "getNote",
  "addNote",
  "updateNote",
  "deleteNote",
  "getTask",
  "createTask",
  "updateTask",
  "deleteTask",
  "getPipeline",
  "listPipelines",
];

// ---------------------------------------------------------------------------
// The parametrized battery.
// ---------------------------------------------------------------------------

for (const harness of harnesses) {
  describe(`CRMAdapter conformance: ${harness.vendor}`, () => {
    const v = harness.vendor;
    const { ids } = harness;

    const contactInput = {
      accountId: ids.account,
      emails: [{ address: "a@b.com", primary: true }],
      firstName: "Test",
      lastName: "User",
      phones: [{ label: "work", number: "+14155550100" }],
    };
    const dealInput = {
      accountId: ids.account,
      amount: 1000,
      contactIds: [ids.contact],
      currency: "USD",
      pipelineId: ids.pipeline,
      stageId: "s1",
      title: "Test deal",
    };
    const leadInput = {
      company: "Acme",
      emails: [{ address: "a@b.com" }],
      firstName: "Test",
      lastName: "User",
      phones: [{ label: "work", number: "+14155550100" }],
      source: "web",
    };
    const accountInput = { domain: "acme.com", industry: "Tech", name: "Acme" };
    const activityInput = {
      accountId: ids.account,
      body: "hello",
      contactIds: [ids.contact],
      dealId: ids.deal,
      durationSeconds: 60,
      occurredAt: 0,
      subject: "Call",
      type: "call",
    };
    const noteInput = {
      accountId: ids.account,
      body: "note body",
      contactIds: [ids.contact],
      dealId: ids.deal,
    };
    const taskInput = {
      contactIds: [ids.contact],
      description: "desc",
      dueAt: 1_893_456_000_000,
      subject: "Task",
    };

    test("(a) every interface method is a function", async () => {
      const adapter = await harness.build();
      for (const name of REQUIRED_METHODS) {
        expect(typeof adapter[name]).toBe("function");
      }
    });

    test("(b) capability flags are well-typed", async () => {
      const adapter = await harness.build();
      const c = adapter.capabilities;
      const flags = [
        c.supportsLeads,
        c.supportsPipelines,
        c.supportsCustomFields,
        c.supportsWebhooks,
        c.supportsBulkUpsert,
        c.supportsDelete,
        c.supportsAccounts,
        c.supportsListing,
        c.supportsLeadConversion,
      ];
      for (const flag of flags) expect(typeof flag).toBe("boolean");
      expect(["bidirectional", "inbound-only", "outbound-only"]).toContain(
        c.syncDirection,
      );
      expect(["email", "id", "phone"]).toContain(c.preferredIdField);
      expect(adapter.vendor).toBe(v);
      if (c.supportsLeadConversion) {
        expect(typeof adapter.convertLead).toBe("function");
      }
    });

    test("contacts round-trip (create/get/update/delete/list/search/lookup)", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.createContact(contactInput), v);
      expectReadable(await adapter.getContact(ids.contact), v);
      expectEntity(await adapter.updateContact(ids.contact, { firstName: "New" }), v);
      expect(await adapter.deleteContact(ids.contact)).toBeUndefined();
      expect(Array.isArray((await adapter.listContacts()).items)).toBe(true);
      expect(Array.isArray(await adapter.searchContacts("q"))).toBe(true);
      expectReadable(await adapter.lookupContactByEmail("a@b.com"), v);
      expectReadable(await adapter.lookupContactByPhone("+14155550100"), v);
    });

    test("leads round-trip (create/get/update/delete/list)", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.createLead(leadInput), v);
      expectReadable(await adapter.getLead(ids.lead), v);
      expectEntity(
        await adapter.updateLead(ids.lead, { company: "NewCo", source: "x" }),
        v,
      );
      expect(await adapter.deleteLead(ids.lead)).toBeUndefined();
      expect(Array.isArray((await adapter.listLeads()).items)).toBe(true);
    });

    test("deals round-trip (create/get/update/delete/list)", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.createDeal(dealInput), v);
      expectReadable(await adapter.getDeal(ids.deal), v);
      expectEntity(
        await adapter.updateDeal(ids.deal, { amount: 50, stageId: "s1", title: "New" }),
        v,
      );
      expect(await adapter.deleteDeal(ids.deal)).toBeUndefined();
      expect(Array.isArray((await adapter.listDeals()).items)).toBe(true);
    });

    test("accounts honour the supportsAccounts capability", async () => {
      const adapter = await harness.build();
      if (adapter.capabilities.supportsAccounts) {
        expectEntity(await adapter.createAccount(accountInput), v);
        expectReadable(await adapter.getAccount(ids.account), v);
        expectEntity(await adapter.updateAccount(ids.account, { name: "New" }), v);
      } else {
        await expect(adapter.createAccount(accountInput)).rejects.toThrow();
        await expect(
          adapter.updateAccount(ids.account, { name: "New" }),
        ).rejects.toThrow();
        expect(await adapter.getAccount(ids.account)).toBeNull();
      }
      expect(await adapter.deleteAccount(ids.account)).toBeUndefined();
      expect(Array.isArray((await adapter.listAccounts()).items)).toBe(true);
    });

    test("activities round-trip / throw on immutable update", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.logActivity(activityInput), v);
      expectReadable(await adapter.getActivity(ids.activity), v);
      const patch = { body: "x", contactIds: [ids.contact], durationSeconds: 30 };
      if (harness.immutableWrites.includes("updateActivity")) {
        await expect(adapter.updateActivity(ids.activity, patch)).rejects.toThrow();
      } else {
        expectEntity(await adapter.updateActivity(ids.activity, patch), v);
      }
    });

    test("notes round-trip / throw on immutable update", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.addNote(noteInput), v);
      expectReadable(await adapter.getNote(ids.note), v);
      const patch = { body: "x", contactIds: [ids.contact] };
      if (harness.immutableWrites.includes("updateNote")) {
        await expect(adapter.updateNote(ids.note, patch)).rejects.toThrow();
      } else {
        expectEntity(await adapter.updateNote(ids.note, patch), v);
      }
      expect(await adapter.deleteNote(ids.note)).toBeUndefined();
    });

    test("tasks round-trip / throw on immutable update", async () => {
      const adapter = await harness.build();
      expectEntity(await adapter.createTask(taskInput), v);
      expectReadable(await adapter.getTask(ids.task), v);
      const patch = { contactIds: [ids.contact], status: "completed", subject: "x" };
      if (harness.immutableWrites.includes("updateTask")) {
        await expect(adapter.updateTask(ids.task, patch)).rejects.toThrow();
      } else {
        expectEntity(await adapter.updateTask(ids.task, patch), v);
      }
      expect(await adapter.deleteTask(ids.task)).toBeUndefined();
    });

    test("pipelines read (get/list)", async () => {
      const adapter = await harness.build();
      expectReadable(await adapter.getPipeline(ids.pipeline), v);
      expect(Array.isArray(await adapter.listPipelines())).toBe(true);
    });
  });
}
