export type CRMVendor =
  | "salesforce"
  | "hubspot"
  | "pipedrive"
  | "zoho"
  | "attio"
  | "close"
  | "monday"
  | "gohighlevel";

export type CRMEntityType =
  "contact" | "lead" | "deal" | "account" | "activity" | "note" | "task";

export type CRMSyncDirection =
  "outbound-only" | "inbound-only" | "bidirectional";

export type CRMPhone = {
  number: string;
  label?: "mobile" | "work" | "home" | "fax" | "other";
  primary?: boolean;
  countryCode?: string;
};

export type CRMEmail = {
  address: string;
  label?: "work" | "personal" | "other";
  primary?: boolean;
};

export type CRMAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  label?: "billing" | "shipping" | "home" | "other";
};

export type CRMSocialHandle = {
  network:
    "linkedin" | "twitter" | "facebook" | "instagram" | "github" | "other";
  handle: string;
};

export type CRMCustomField = {
  fieldId: string;
  label?: string;
  value: string | number | boolean | null;
};

export type CRMOwner = {
  ownerId: string;
  name?: string;
  email?: string;
};

export type CRMContact = {
  id: string;
  vendor: CRMVendor;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  emails: CRMEmail[];
  phones: CRMPhone[];
  addresses?: CRMAddress[];
  socials?: CRMSocialHandle[];
  jobTitle?: string;
  accountId?: string;
  ownerId?: string;
  tags?: string[];
  customFields?: CRMCustomField[];
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, string>;
};

export type CRMLead = {
  id: string;
  vendor: CRMVendor;
  firstName?: string;
  lastName?: string;
  emails: CRMEmail[];
  phones: CRMPhone[];
  company?: string;
  jobTitle?: string;
  source?: string;
  status?: "new" | "working" | "qualified" | "unqualified" | "converted";
  ownerId?: string;
  estimatedValue?: number;
  currency?: string;
  customFields?: CRMCustomField[];
  notes?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type CRMStage = {
  id: string;
  label: string;
  pipelineId: string;
  probability?: number;
  isClosed?: boolean;
  isWon?: boolean;
  order?: number;
};

export type CRMPipeline = {
  id: string;
  vendor: CRMVendor;
  label: string;
  stages: CRMStage[];
  isDefault?: boolean;
};

export type CRMDeal = {
  id: string;
  vendor: CRMVendor;
  title: string;
  amount?: number;
  currency?: string;
  pipelineId?: string;
  stageId?: string;
  contactIds?: string[];
  accountId?: string;
  ownerId?: string;
  expectedCloseAt?: number;
  closedAt?: number;
  status?: "open" | "won" | "lost";
  customFields?: CRMCustomField[];
  createdAt?: number;
  updatedAt?: number;
};

export type CRMAccount = {
  id: string;
  vendor: CRMVendor;
  name: string;
  domain?: string;
  industry?: string;
  employees?: number;
  annualRevenue?: number;
  ownerId?: string;
  addresses?: CRMAddress[];
  customFields?: CRMCustomField[];
  createdAt?: number;
  updatedAt?: number;
};

export type CRMActivity = {
  id: string;
  vendor: CRMVendor;
  type: "call" | "email" | "meeting" | "note" | "task" | "sms" | "other";
  subject?: string;
  body?: string;
  contactIds?: string[];
  dealId?: string;
  accountId?: string;
  ownerId?: string;
  occurredAt: number;
  durationSeconds?: number;
  outcome?: string;
  metadata?: Record<string, string>;
};

export type CRMNote = {
  id: string;
  vendor: CRMVendor;
  body: string;
  contactIds?: string[];
  dealId?: string;
  accountId?: string;
  ownerId?: string;
  createdAt?: number;
};

export type CRMTask = {
  id: string;
  vendor: CRMVendor;
  subject: string;
  description?: string;
  contactIds?: string[];
  dealId?: string;
  accountId?: string;
  ownerId?: string;
  dueAt?: number;
  status?: "pending" | "in-progress" | "completed" | "cancelled";
  priority?: "low" | "normal" | "high";
};

export type CRMListOptions = {
  limit?: number;
  cursor?: string;
};

export type CRMListResult<T> = {
  items: T[];
  nextCursor?: string;
};

export type CRMAdapterCapabilities = {
  supportsLeads: boolean;
  supportsPipelines: boolean;
  supportsCustomFields: boolean;
  supportsWebhooks: boolean;
  supportsBulkUpsert: boolean;
  /**
   * Vendor supports hard/soft deletion of entities. When false, the (later)
   * adapter implementation of every `delete*` verb is a typed no-op that
   * resolves to `void` without performing a destructive call.
   */
  supportsDelete: boolean;
  /**
   * Vendor models a first-class Account/Company object. When false, every
   * `*Account` verb is a typed no-op (`null` / `[]` / pass-through) and callers
   * should not rely on account linkage.
   */
  supportsAccounts: boolean;
  /**
   * Vendor exposes paginated listing for inbound pull. When false, every
   * `list*` verb resolves to `{ items: [] }` so inbound sync degrades safely.
   */
  supportsListing: boolean;
  /**
   * Vendor supports converting a lead into a contact/deal. Mirrors the optional
   * `convertLead` method: when false, `convertLead` is absent or a no-op.
   */
  supportsLeadConversion: boolean;
  syncDirection: CRMSyncDirection;
  preferredIdField: "id" | "email" | "phone";
};

export type CRMAdapterFactoryInput = {
  accessToken: string;
  refreshToken?: string;
  instanceUrl?: string;
  apiDomain?: string;
  region?: string;
  subAccountId?: string;
  expiresAt?: number;
  onTokenRefresh?: (next: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) => void | Promise<void>;
};

/**
 * Capability-gating model
 * -----------------------
 * Every CRUD verb below (except `convertLead`) is PRESENT and REQUIRED on the
 * interface. This keeps the type surface uniform across all 8 vendor adapters:
 * callers can reference `adapter.deleteDeal` / `adapter.listContacts` /
 * `adapter.createAccount` without per-vendor narrowing or `in` checks.
 *
 * Vendors that genuinely lack a capability do NOT drop the method. Instead the
 * (later) adapter implementation returns a typed no-op that honours the return
 * contract — `void` for deletes, `null` for single-entity reads, `[]` /
 * `{ items: [] }` for lists, and a pass-through/echo for writes — gated behind
 * the corresponding `capabilities` flag:
 *   - `supportsDelete`          → guards every `delete*` verb
 *   - `supportsAccounts`        → guards every `*Account` verb
 *   - `supportsListing`         → guards every `list*` verb
 *   - `supportsLeadConversion`  → mirrors the optional `convertLead`
 * Callers MUST check the relevant flag before relying on a verb's side effect;
 * the no-op contract guarantees calling an unsupported verb is safe, not that
 * it does anything.
 *
 * Rationale for one required surface over per-method optionals (`?`):
 *  1. Uniformity — generic sync/reconcile code iterates verbs without branching
 *     on `typeof adapter.x === "function"`.
 *  2. Discoverability — the full contract is the same for every vendor; gaps are
 *     expressed as runtime no-ops + a boolean flag, not as a shifting type shape.
 *  3. Capability flags carry the "can I trust this?" signal explicitly, which is
 *     more honest than an absent method (absence conflates "unimplemented" with
 *     "unsupported").
 * `convertLead` remains the sole OPTIONAL method: it is a compound, vendor-
 * specific workflow (not a plain CRUD verb) whose shape and side effects vary
 * enough that an absent method is clearer than a no-op; `supportsLeadConversion`
 * advertises its presence.
 */
export type CRMAdapter = {
  readonly vendor: CRMVendor;
  readonly capabilities: CRMAdapterCapabilities;

  // --- Contacts ---
  lookupContactByEmail(email: string): Promise<CRMContact | null>;
  lookupContactByPhone(phone: string): Promise<CRMContact | null>;
  searchContacts(query: string, limit?: number): Promise<CRMContact[]>;
  getContact(id: string): Promise<CRMContact | null>;
  listContacts(opts?: CRMListOptions): Promise<CRMListResult<CRMContact>>;
  createContact(input: Omit<CRMContact, "id" | "vendor">): Promise<CRMContact>;
  updateContact(
    id: string,
    patch: Partial<Omit<CRMContact, "id" | "vendor">>,
  ): Promise<CRMContact>;
  deleteContact(id: string): Promise<void>;

  // --- Leads ---
  getLead(id: string): Promise<CRMLead | null>;
  listLeads(opts?: CRMListOptions): Promise<CRMListResult<CRMLead>>;
  createLead(input: Omit<CRMLead, "id" | "vendor">): Promise<CRMLead>;
  updateLead(
    id: string,
    patch: Partial<Omit<CRMLead, "id" | "vendor">>,
  ): Promise<CRMLead>;
  deleteLead(id: string): Promise<void>;
  convertLead?(
    leadId: string,
    options?: { dealAmount?: number; dealTitle?: string },
  ): Promise<{ contact: CRMContact; deal?: CRMDeal }>;

  // --- Deals ---
  getDeal(id: string): Promise<CRMDeal | null>;
  listDeals(opts?: CRMListOptions): Promise<CRMListResult<CRMDeal>>;
  createDeal(input: Omit<CRMDeal, "id" | "vendor">): Promise<CRMDeal>;
  updateDeal(
    id: string,
    patch: Partial<Omit<CRMDeal, "id" | "vendor">>,
  ): Promise<CRMDeal>;
  deleteDeal(id: string): Promise<void>;

  // --- Accounts ---
  getAccount(id: string): Promise<CRMAccount | null>;
  listAccounts(opts?: CRMListOptions): Promise<CRMListResult<CRMAccount>>;
  createAccount(input: Omit<CRMAccount, "id" | "vendor">): Promise<CRMAccount>;
  updateAccount(
    id: string,
    patch: Partial<Omit<CRMAccount, "id" | "vendor">>,
  ): Promise<CRMAccount>;
  deleteAccount(id: string): Promise<void>;

  // --- Activities ---
  getActivity(id: string): Promise<CRMActivity | null>;
  logActivity(input: Omit<CRMActivity, "id" | "vendor">): Promise<CRMActivity>;
  updateActivity(
    id: string,
    patch: Partial<Omit<CRMActivity, "id" | "vendor">>,
  ): Promise<CRMActivity>;

  // --- Notes ---
  getNote(id: string): Promise<CRMNote | null>;
  addNote(input: Omit<CRMNote, "id" | "vendor">): Promise<CRMNote>;
  updateNote(
    id: string,
    patch: Partial<Omit<CRMNote, "id" | "vendor">>,
  ): Promise<CRMNote>;
  deleteNote(id: string): Promise<void>;

  // --- Tasks ---
  getTask(id: string): Promise<CRMTask | null>;
  createTask(input: Omit<CRMTask, "id" | "vendor">): Promise<CRMTask>;
  updateTask(
    id: string,
    patch: Partial<Omit<CRMTask, "id" | "vendor">>,
  ): Promise<CRMTask>;
  deleteTask(id: string): Promise<void>;

  // --- Pipelines ---
  getPipeline(id: string): Promise<CRMPipeline | null>;
  listPipelines(): Promise<CRMPipeline[]>;
};

export type CRMAdapterFactory = (
  input: CRMAdapterFactoryInput,
) => Promise<CRMAdapter> | CRMAdapter;
