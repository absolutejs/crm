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
  | "contact"
  | "lead"
  | "deal"
  | "account"
  | "activity"
  | "note"
  | "task";

export type CRMSyncDirection = "outbound-only" | "inbound-only" | "bidirectional";

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
    | "linkedin"
    | "twitter"
    | "facebook"
    | "instagram"
    | "github"
    | "other";
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

export type CRMAdapterCapabilities = {
  supportsLeads: boolean;
  supportsPipelines: boolean;
  supportsCustomFields: boolean;
  supportsWebhooks: boolean;
  supportsBulkUpsert: boolean;
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
  onTokenRefresh?: (next: { accessToken: string; refreshToken?: string; expiresAt?: number }) => void | Promise<void>;
};

export type CRMAdapter = {
  readonly vendor: CRMVendor;
  readonly capabilities: CRMAdapterCapabilities;
  lookupContactByEmail(email: string): Promise<CRMContact | null>;
  lookupContactByPhone(phone: string): Promise<CRMContact | null>;
  searchContacts(query: string, limit?: number): Promise<CRMContact[]>;
  getContact(id: string): Promise<CRMContact | null>;
  createContact(input: Omit<CRMContact, "id" | "vendor">): Promise<CRMContact>;
  updateContact(
    id: string,
    patch: Partial<Omit<CRMContact, "id" | "vendor">>,
  ): Promise<CRMContact>;
  createLead(input: Omit<CRMLead, "id" | "vendor">): Promise<CRMLead>;
  convertLead?(
    leadId: string,
    options?: { dealAmount?: number; dealTitle?: string },
  ): Promise<{ contact: CRMContact; deal?: CRMDeal }>;
  createDeal(input: Omit<CRMDeal, "id" | "vendor">): Promise<CRMDeal>;
  updateDeal(
    id: string,
    patch: Partial<Omit<CRMDeal, "id" | "vendor">>,
  ): Promise<CRMDeal>;
  logActivity(input: Omit<CRMActivity, "id" | "vendor">): Promise<CRMActivity>;
  addNote(input: Omit<CRMNote, "id" | "vendor">): Promise<CRMNote>;
  createTask(input: Omit<CRMTask, "id" | "vendor">): Promise<CRMTask>;
  listPipelines(): Promise<CRMPipeline[]>;
};

export type CRMAdapterFactory = (
  input: CRMAdapterFactoryInput,
) => Promise<CRMAdapter> | CRMAdapter;
