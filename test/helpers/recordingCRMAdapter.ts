import type {
  CRMAccount,
  CRMActivity,
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMNote,
  CRMPipeline,
  CRMTask,
  CRMVendor,
} from "../../src/types";

export type RecordedCall = { method: string; args: unknown[] };

const defaultCapabilities: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: true,
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: true,
  supportsLeads: true,
  supportsListing: true,
  supportsPipelines: true,
  supportsWebhooks: true,
  syncDirection: "bidirectional",
};

/**
 * A fully-typed CRMAdapter whose every verb records its invocation and returns
 * a deterministic stub entity. Used by the outbound-worker and runtime-surface
 * tests to assert that the right adapter method was reached.
 */
export const createRecordingCRMAdapter = (
  vendor: CRMVendor,
  capabilitiesOverride: Partial<CRMAdapterCapabilities> = {},
): { adapter: CRMAdapter; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ args, method });
  };

  const contact = (id: string): CRMContact => ({ emails: [], id, phones: [], vendor });
  const lead = (id: string): CRMLead => ({ emails: [], id, phones: [], vendor });
  const deal = (id: string): CRMDeal => ({ id, title: "Deal", vendor });
  const account = (id: string): CRMAccount => ({ id, name: "Acct", vendor });
  const activity = (id: string): CRMActivity => ({
    id,
    occurredAt: 0,
    type: "note",
    vendor,
  });
  const note = (id: string): CRMNote => ({ body: "n", id, vendor });
  const task = (id: string): CRMTask => ({ id, subject: "t", vendor });
  const pipeline = (id: string): CRMPipeline => ({
    id,
    label: "P",
    stages: [],
    vendor,
  });

  const adapter: CRMAdapter = {
    async addNote(input) {
      record("addNote", input);
      return { ...input, id: "note_1", vendor };
    },
    capabilities: { ...defaultCapabilities, ...capabilitiesOverride },
    async convertLead(leadId, opts) {
      record("convertLead", leadId, opts);
      return { contact: contact("c_conv"), deal: deal("d_conv") };
    },
    async createAccount(input) {
      record("createAccount", input);
      return { ...input, id: "acct_1", vendor };
    },
    async createContact(input) {
      record("createContact", input);
      return { ...input, id: "contact_1", vendor };
    },
    async createDeal(input) {
      record("createDeal", input);
      return { ...input, id: "deal_1", vendor };
    },
    async createLead(input) {
      record("createLead", input);
      return { ...input, id: "lead_1", vendor };
    },
    async createTask(input) {
      record("createTask", input);
      return { ...input, id: "task_1", vendor };
    },
    async deleteAccount(id) {
      record("deleteAccount", id);
    },
    async deleteContact(id) {
      record("deleteContact", id);
    },
    async deleteDeal(id) {
      record("deleteDeal", id);
    },
    async deleteLead(id) {
      record("deleteLead", id);
    },
    async deleteNote(id) {
      record("deleteNote", id);
    },
    async deleteTask(id) {
      record("deleteTask", id);
    },
    async getAccount(id) {
      record("getAccount", id);
      return account(id);
    },
    async getActivity(id) {
      record("getActivity", id);
      return activity(id);
    },
    async getContact(id) {
      record("getContact", id);
      return contact(id);
    },
    async getDeal(id) {
      record("getDeal", id);
      return deal(id);
    },
    async getLead(id) {
      record("getLead", id);
      return lead(id);
    },
    async getNote(id) {
      record("getNote", id);
      return note(id);
    },
    async getPipeline(id) {
      record("getPipeline", id);
      return pipeline(id);
    },
    async getTask(id) {
      record("getTask", id);
      return task(id);
    },
    async listAccounts(opts) {
      record("listAccounts", opts);
      return { items: [account("acct_l")] };
    },
    async listContacts(opts) {
      record("listContacts", opts);
      return { items: [contact("contact_l")] };
    },
    async listDeals(opts) {
      record("listDeals", opts);
      return { items: [deal("deal_l")] };
    },
    async listLeads(opts) {
      record("listLeads", opts);
      return { items: [lead("lead_l")] };
    },
    async listPipelines() {
      record("listPipelines");
      return [pipeline("pipe_l")];
    },
    async logActivity(input) {
      record("logActivity", input);
      return { ...input, id: "activity_1", vendor };
    },
    async lookupContactByEmail(email) {
      record("lookupContactByEmail", email);
      return contact("contact_email");
    },
    async lookupContactByPhone(phone) {
      record("lookupContactByPhone", phone);
      return contact("contact_phone");
    },
    async searchContacts(query, limit) {
      record("searchContacts", query, limit);
      return [contact("contact_s")];
    },
    async updateAccount(id, patch) {
      record("updateAccount", id, patch);
      return { ...account(id), ...patch };
    },
    async updateActivity(id, patch) {
      record("updateActivity", id, patch);
      return { ...activity(id), ...patch };
    },
    async updateContact(id, patch) {
      record("updateContact", id, patch);
      return { ...contact(id), ...patch };
    },
    async updateDeal(id, patch) {
      record("updateDeal", id, patch);
      return { ...deal(id), ...patch };
    },
    async updateLead(id, patch) {
      record("updateLead", id, patch);
      return { ...lead(id), ...patch };
    },
    async updateNote(id, patch) {
      record("updateNote", id, patch);
      return { ...note(id), ...patch };
    },
    async updateTask(id, patch) {
      record("updateTask", id, patch);
      return { ...task(id), ...patch };
    },
    vendor,
  };

  return { adapter, calls };
};
