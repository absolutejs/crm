import type {
  CRMAccount,
  CRMActivity,
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMEmail,
  CRMLead,
  CRMListResult,
  CRMNote,
  CRMPhone,
  CRMPipeline,
  CRMTask,
} from "../types";

const VENDOR = "salesforce" as const;

const SALESFORCE_CAPABILITIES: CRMAdapterCapabilities = {
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
  syncDirection: "outbound-only",
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const CONTACT_FIELDS =
  "Id, FirstName, LastName, Name, Email, Phone, MobilePhone, Title, AccountId, OwnerId";
const LEAD_FIELDS =
  "Id, FirstName, LastName, Name, Email, Phone, Company, Title, LeadSource, Status, OwnerId";
const DEAL_FIELDS =
  "Id, Name, Amount, StageName, AccountId, OwnerId, CloseDate";
const ACCOUNT_FIELDS =
  "Id, Name, Website, Industry, NumberOfEmployees, AnnualRevenue, OwnerId";
const TASK_FIELDS =
  "Id, Subject, Description, Status, Priority, ActivityDate, Type, WhoId, WhatId, OwnerId, CallDurationInSeconds, CreatedDate";
const NOTE_FIELDS = "Id, Title, Body, ParentId, OwnerId, CreatedDate";

export type SalesforceQueryResult<T> = {
  totalSize?: number;
  done?: boolean;
  records: T[];
};

export type SalesforceSaveResult = {
  id?: string;
  success: boolean;
  errors?: { message: string }[];
};

export type SalesforceLeadConvertInput = {
  leadId: string;
  convertedStatus: string;
  doNotCreateOpportunity?: boolean;
  opportunityName?: string;
};

export type SalesforceLeadConvertResult = {
  success: boolean;
  accountId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  leadId?: string | null;
  errors?: { message: string }[];
};

export type SalesforceConnectionLike = {
  query<T = Record<string, unknown>>(
    soql: string,
  ): Promise<SalesforceQueryResult<T>>;
  sobject(name: string): {
    create(record: Record<string, unknown>): Promise<SalesforceSaveResult>;
    update(record: Record<string, unknown>): Promise<SalesforceSaveResult>;
    retrieve(id: string): Promise<Record<string, unknown>>;
    destroy(id: string): Promise<SalesforceSaveResult>;
  };
  soap: {
    convertLead(
      input: SalesforceLeadConvertInput,
    ): Promise<SalesforceLeadConvertResult>;
  };
};

export type CreateSalesforceCRMAdapterOptions = CRMAdapterFactoryInput & {
  connection?: SalesforceConnectionLike;
  apiVersion?: string;
};

const phoneToCRM = (
  raw: string | undefined | null,
  label: CRMPhone["label"],
): CRMPhone[] => {
  if (!raw) return [];
  return [{ label, number: raw }];
};

const emailToCRM = (raw: string | undefined | null): CRMEmail[] =>
  raw ? [{ address: raw, primary: true }] : [];

const escapeSoql = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");

const parseOffsetCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
};

const toDateOnly = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 10);

const classifyLeadStatus = (
  raw: unknown,
): CRMLead["status"] | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).toLowerCase();
  if (value.includes("convert")) return "converted";
  if (value.includes("unqualif") || value.includes("not converted"))
    return "unqualified";
  if (value.includes("qualif")) return "qualified";
  if (value.includes("work") || value.includes("contact")) return "working";
  if (value.includes("new") || value.includes("open")) return "new";
  return undefined;
};

const taskStatusFromSF = (raw: unknown): CRMTask["status"] | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).toLowerCase();
  if (value.includes("complete")) return "completed";
  if (value.includes("progress")) return "in-progress";
  if (value.includes("defer") || value.includes("cancel")) return "cancelled";
  return "pending";
};

const taskPriorityFromSF = (raw: unknown): CRMTask["priority"] | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).toLowerCase();
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "normal";
};

const taskStatusToSF = (status: CRMTask["status"]): string => {
  if (status === "completed") return "Completed";
  if (status === "in-progress") return "In Progress";
  if (status === "cancelled") return "Deferred";
  return "Not Started";
};

const taskPriorityToSF = (priority: CRMTask["priority"]): string => {
  if (priority === "high") return "High";
  if (priority === "low") return "Low";
  return "Normal";
};

const activityTypeFromSF = (raw: unknown): CRMActivity["type"] => {
  const value = String(raw ?? "").toLowerCase();
  if (value === "call") return "call";
  if (value === "email") return "email";
  if (value === "meeting") return "meeting";
  return "other";
};

const activityTypeToSF = (type: CRMActivity["type"]): string => {
  if (type === "call") return "Call";
  if (type === "email") return "Email";
  if (type === "meeting") return "Meeting";
  return "Other";
};

// Salesforce IDs carry a 3-char key prefix identifying the SObject type.
const whatIdToParent = (
  raw: unknown,
): { dealId?: string; accountId?: string } => {
  if (!raw) return {};
  const id = String(raw);
  if (id.startsWith("006")) return { dealId: id };
  if (id.startsWith("001")) return { accountId: id };
  return {};
};

const parentIdToTargets = (
  raw: unknown,
): { contactIds?: string[]; accountId?: string; dealId?: string } => {
  if (!raw) return {};
  const id = String(raw);
  if (id.startsWith("003")) return { contactIds: [id] };
  if (id.startsWith("001")) return { accountId: id };
  if (id.startsWith("006")) return { dealId: id };
  return {};
};

const mapContactRow = (
  row: Record<string, unknown>,
): CRMContact => {
  const id = String(row.Id ?? "");
  return {
    emails: emailToCRM(row.Email as string | undefined),
    id,
    phones: [
      ...phoneToCRM(row.Phone as string | undefined, "work"),
      ...phoneToCRM(row.MobilePhone as string | undefined, "mobile"),
    ],
    vendor: VENDOR,
    ...(row.FirstName ? { firstName: String(row.FirstName) } : {}),
    ...(row.LastName ? { lastName: String(row.LastName) } : {}),
    ...(row.Name ? { fullName: String(row.Name) } : {}),
    ...(row.Title ? { jobTitle: String(row.Title) } : {}),
    ...(row.AccountId ? { accountId: String(row.AccountId) } : {}),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
  };
};

const mapLeadRow = (row: Record<string, unknown>): CRMLead => {
  const id = String(row.Id ?? "");
  const status = classifyLeadStatus(row.Status);
  return {
    emails: emailToCRM(row.Email as string | undefined),
    id,
    phones: phoneToCRM(row.Phone as string | undefined, "work"),
    vendor: VENDOR,
    ...(row.FirstName ? { firstName: String(row.FirstName) } : {}),
    ...(row.LastName ? { lastName: String(row.LastName) } : {}),
    ...(row.Company ? { company: String(row.Company) } : {}),
    ...(row.Title ? { jobTitle: String(row.Title) } : {}),
    ...(row.LeadSource ? { source: String(row.LeadSource) } : {}),
    ...(status ? { status } : {}),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
  };
};

const mapDealRow = (row: Record<string, unknown>): CRMDeal => {
  const id = String(row.Id ?? "");
  const stage = row.StageName as string | undefined;
  const closed = stage === "Closed Won" || stage === "Closed Lost";
  return {
    id,
    title: String(row.Name ?? ""),
    vendor: VENDOR,
    ...(row.Amount !== undefined && row.Amount !== null
      ? { amount: Number(row.Amount) }
      : {}),
    ...(stage ? { stageId: stage } : {}),
    ...(row.AccountId ? { accountId: String(row.AccountId) } : {}),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
    ...(row.CloseDate
      ? { expectedCloseAt: new Date(String(row.CloseDate)).getTime() }
      : {}),
    status: closed ? (stage === "Closed Won" ? "won" : "lost") : "open",
  };
};

const mapAccountRow = (row: Record<string, unknown>): CRMAccount => {
  const id = String(row.Id ?? "");
  return {
    id,
    name: String(row.Name ?? ""),
    vendor: VENDOR,
    ...(row.Website ? { domain: String(row.Website) } : {}),
    ...(row.Industry ? { industry: String(row.Industry) } : {}),
    ...(row.NumberOfEmployees !== undefined && row.NumberOfEmployees !== null
      ? { employees: Number(row.NumberOfEmployees) }
      : {}),
    ...(row.AnnualRevenue !== undefined && row.AnnualRevenue !== null
      ? { annualRevenue: Number(row.AnnualRevenue) }
      : {}),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
  };
};

const mapTaskRow = (row: Record<string, unknown>): CRMTask => {
  const id = String(row.Id ?? "");
  const status = taskStatusFromSF(row.Status);
  const priority = taskPriorityFromSF(row.Priority);
  return {
    id,
    subject: String(row.Subject ?? ""),
    vendor: VENDOR,
    ...(row.Description ? { description: String(row.Description) } : {}),
    ...(row.WhoId ? { contactIds: [String(row.WhoId)] } : {}),
    ...whatIdToParent(row.WhatId),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
    ...(row.ActivityDate
      ? { dueAt: new Date(String(row.ActivityDate)).getTime() }
      : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };
};

const mapActivityRow = (row: Record<string, unknown>): CRMActivity => {
  const id = String(row.Id ?? "");
  const occurredAt = row.ActivityDate
    ? new Date(String(row.ActivityDate)).getTime()
    : row.CreatedDate
      ? new Date(String(row.CreatedDate)).getTime()
      : Date.now();
  return {
    id,
    occurredAt,
    type: activityTypeFromSF(row.Type),
    vendor: VENDOR,
    ...(row.Subject ? { subject: String(row.Subject) } : {}),
    ...(row.Description ? { body: String(row.Description) } : {}),
    ...(row.WhoId ? { contactIds: [String(row.WhoId)] } : {}),
    ...whatIdToParent(row.WhatId),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
    ...(row.CallDurationInSeconds !== undefined &&
    row.CallDurationInSeconds !== null
      ? { durationSeconds: Number(row.CallDurationInSeconds) }
      : {}),
  };
};

const mapNoteRow = (row: Record<string, unknown>): CRMNote => {
  const id = String(row.Id ?? "");
  return {
    body: String(row.Body ?? ""),
    id,
    vendor: VENDOR,
    ...parentIdToTargets(row.ParentId),
    ...(row.OwnerId ? { ownerId: String(row.OwnerId) } : {}),
    ...(row.CreatedDate
      ? { createdAt: new Date(String(row.CreatedDate)).getTime() }
      : {}),
  };
};

const buildDefaultPipeline = (): CRMPipeline => {
  const stages = [
    "Prospecting",
    "Qualification",
    "Needs Analysis",
    "Value Proposition",
    "Proposal/Price Quote",
    "Negotiation/Review",
    "Closed Won",
    "Closed Lost",
  ];
  return {
    id: "default",
    isDefault: true,
    label: "Default Salesforce Pipeline",
    stages: stages.map((label, order) => ({
      id: label,
      isClosed: label.startsWith("Closed"),
      isWon: label === "Closed Won",
      label,
      order,
      pipelineId: "default",
    })),
    vendor: VENDOR,
  };
};

const ensureSaved = (result: SalesforceSaveResult): string => {
  if (!result.success || !result.id) {
    const message =
      result.errors?.map((e) => e.message).join("; ") ?? "Unknown error";
    throw new Error(`Salesforce save failed: ${message}`);
  }
  return result.id;
};

const ensureDeleted = (result: SalesforceSaveResult): void => {
  if (!result.success) {
    const message =
      result.errors?.map((e) => e.message).join("; ") ?? "Unknown error";
    throw new Error(`Salesforce delete failed: ${message}`);
  }
};

const buildConnection = async (
  input: CreateSalesforceCRMAdapterOptions,
): Promise<SalesforceConnectionLike> => {
  if (input.connection) return input.connection;
  const jsforce = (await import("jsforce")) as unknown as {
    Connection: new (options: {
      accessToken: string;
      instanceUrl: string;
      version?: string;
      refreshFn?: (
        conn: unknown,
        callback: (err: Error | null, accessToken?: string) => void,
      ) => void;
    }) => SalesforceConnectionLike;
  };
  if (!input.instanceUrl) {
    throw new Error(
      "Salesforce adapter requires instanceUrl (from OAuth token response)",
    );
  }
  return new jsforce.Connection({
    accessToken: input.accessToken,
    instanceUrl: input.instanceUrl,
    ...(input.apiVersion ? { version: input.apiVersion } : {}),
  });
};

export const createSalesforceCRMAdapter = async (
  input: CreateSalesforceCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const connection = await buildConnection(input);

  const lookupContactWhere = async (
    where: string,
  ): Promise<CRMContact | null> => {
    const soql = `SELECT ${CONTACT_FIELDS} FROM Contact WHERE ${where} LIMIT 1`;
    const result = await connection.query(soql);
    const row = result.records[0];
    return row ? mapContactRow(row) : null;
  };

  const queryPage = async <T>(
    fields: string,
    sobject: string,
    cursor: string | undefined,
    limit: number | undefined,
    map: (row: Record<string, unknown>) => T,
  ): Promise<CRMListResult<T>> => {
    const pageSize = clampLimit(limit);
    const offset = parseOffsetCursor(cursor);
    const soql = `SELECT ${fields} FROM ${sobject} ORDER BY Id LIMIT ${pageSize} OFFSET ${offset}`;
    const result = await connection.query(soql);
    const items = result.records.map(map);
    return {
      items,
      ...(items.length === pageSize
        ? { nextCursor: String(offset + pageSize) }
        : {}),
    };
  };

  const fetchContactById = async (id: string): Promise<CRMContact | null> => {
    const soql = `SELECT ${CONTACT_FIELDS} FROM Contact WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
    const result = await connection.query(soql);
    const row = result.records[0];
    return row ? mapContactRow(row) : null;
  };

  const fetchDealById = async (id: string): Promise<CRMDeal | null> => {
    const soql = `SELECT ${DEAL_FIELDS} FROM Opportunity WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
    const result = await connection.query(soql);
    const row = result.records[0];
    return row ? mapDealRow(row) : null;
  };

  const getConvertedLeadStatus = async (): Promise<string> => {
    const result = await connection.query<{ MasterLabel?: string }>(
      "SELECT MasterLabel FROM LeadStatus WHERE IsConverted = true ORDER BY SortOrder LIMIT 1",
    );
    const status = result.records[0]?.MasterLabel;
    if (!status) {
      throw new Error(
        "Salesforce lead conversion failed: no converted LeadStatus configured in this org",
      );
    }
    return String(status);
  };

  return {
    async addNote(input) {
      const fields: Record<string, unknown> = {
        Body: input.body,
        Title: input.body.slice(0, 80),
      };
      if (input.contactIds && input.contactIds.length > 0) {
        fields.ParentId = input.contactIds[0];
      } else if (input.accountId) {
        fields.ParentId = input.accountId;
      } else if (input.dealId) {
        fields.ParentId = input.dealId;
      }
      if (input.ownerId) fields.OwnerId = input.ownerId;
      const result = await connection.sobject("Note").create(fields);
      const id = ensureSaved(result);
      return {
        body: input.body,
        id,
        vendor: VENDOR,
        ...(input.contactIds !== undefined ? { contactIds: input.contactIds } : {}),
        ...(input.dealId !== undefined ? { dealId: input.dealId } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      } satisfies CRMNote;
    },
    capabilities: SALESFORCE_CAPABILITIES,
    async convertLead(leadId, options) {
      const convertedStatus = await getConvertedLeadStatus();
      const wantsDeal =
        options?.dealAmount !== undefined || options?.dealTitle !== undefined;
      const result = await connection.soap.convertLead({
        convertedStatus,
        doNotCreateOpportunity: !wantsDeal,
        leadId,
        ...(wantsDeal
          ? { opportunityName: options?.dealTitle ?? "Converted Opportunity" }
          : {}),
      });
      if (!result.success || !result.contactId) {
        const message =
          result.errors?.map((e) => e.message).join("; ") ?? "Unknown error";
        throw new Error(`Salesforce lead conversion failed: ${message}`);
      }
      if (result.opportunityId && options?.dealAmount !== undefined) {
        const update = await connection.sobject("Opportunity").update({
          Amount: options.dealAmount,
          Id: result.opportunityId,
        });
        ensureSaved(update);
      }
      const contact = await fetchContactById(result.contactId);
      if (!contact) {
        throw new Error(
          "Salesforce lead conversion succeeded but converted contact could not be fetched",
        );
      }
      const deal = result.opportunityId
        ? await fetchDealById(result.opportunityId)
        : null;
      return {
        contact,
        ...(deal ? { deal } : {}),
      };
    },
    async createAccount(input) {
      const result = await connection.sobject("Account").create({
        Name: input.name,
        ...(input.domain ? { Website: input.domain } : {}),
        ...(input.industry ? { Industry: input.industry } : {}),
        ...(input.employees !== undefined
          ? { NumberOfEmployees: input.employees }
          : {}),
        ...(input.annualRevenue !== undefined
          ? { AnnualRevenue: input.annualRevenue }
          : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR };
    },
    async createContact(input) {
      const primaryEmail = input.emails[0]?.address;
      const primaryPhone = input.phones[0]?.number;
      const result = await connection.sobject("Contact").create({
        FirstName: input.firstName,
        LastName: input.lastName ?? input.firstName ?? "Unknown",
        ...(primaryEmail ? { Email: primaryEmail } : {}),
        ...(primaryPhone ? { Phone: primaryPhone } : {}),
        ...(input.jobTitle ? { Title: input.jobTitle } : {}),
        ...(input.accountId ? { AccountId: input.accountId } : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
      });
      const id = ensureSaved(result);
      return {
        ...input,
        id,
        vendor: VENDOR,
      };
    },
    async createDeal(input) {
      const result = await connection.sobject("Opportunity").create({
        CloseDate: input.expectedCloseAt
          ? toDateOnly(input.expectedCloseAt)
          : toDateOnly(Date.now()),
        Name: input.title,
        StageName: input.stageId ?? "Prospecting",
        ...(input.amount !== undefined ? { Amount: input.amount } : {}),
        ...(input.accountId ? { AccountId: input.accountId } : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR };
    },
    async createLead(input) {
      const result = await connection.sobject("Lead").create({
        Company: input.company ?? "Unknown",
        FirstName: input.firstName,
        LastName: input.lastName ?? input.firstName ?? "Unknown",
        ...(input.emails[0]?.address ? { Email: input.emails[0]?.address } : {}),
        ...(input.phones[0]?.number ? { Phone: input.phones[0]?.number } : {}),
        ...(input.jobTitle ? { Title: input.jobTitle } : {}),
        ...(input.source ? { LeadSource: input.source } : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR };
    },
    async createTask(input) {
      const result = await connection.sobject("Task").create({
        Subject: input.subject,
        ...(input.description ? { Description: input.description } : {}),
        ...(input.contactIds?.[0] ? { WhoId: input.contactIds[0] } : {}),
        ...(input.dealId
          ? { WhatId: input.dealId }
          : input.accountId
            ? { WhatId: input.accountId }
            : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
        ...(input.dueAt ? { ActivityDate: toDateOnly(input.dueAt) } : {}),
        Priority: taskPriorityToSF(input.priority),
        Status:
          input.status === "completed" ? "Completed" : "Not Started",
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR } satisfies CRMTask;
    },
    async deleteAccount(id) {
      const result = await connection.sobject("Account").destroy(id);
      ensureDeleted(result);
    },
    async deleteContact(id) {
      const result = await connection.sobject("Contact").destroy(id);
      ensureDeleted(result);
    },
    async deleteDeal(id) {
      const result = await connection.sobject("Opportunity").destroy(id);
      ensureDeleted(result);
    },
    async deleteLead(id) {
      const result = await connection.sobject("Lead").destroy(id);
      ensureDeleted(result);
    },
    async deleteNote(id) {
      const result = await connection.sobject("Note").destroy(id);
      ensureDeleted(result);
    },
    async deleteTask(id) {
      const result = await connection.sobject("Task").destroy(id);
      ensureDeleted(result);
    },
    async getAccount(id) {
      const soql = `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapAccountRow(row) : null;
    },
    async getActivity(id) {
      const soql = `SELECT ${TASK_FIELDS} FROM Task WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapActivityRow(row) : null;
    },
    async getContact(id) {
      return fetchContactById(id);
    },
    async getDeal(id) {
      return fetchDealById(id);
    },
    async getLead(id) {
      const soql = `SELECT ${LEAD_FIELDS} FROM Lead WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapLeadRow(row) : null;
    },
    async getNote(id) {
      const soql = `SELECT ${NOTE_FIELDS} FROM Note WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapNoteRow(row) : null;
    },
    getPipeline(id) {
      const pipeline = buildDefaultPipeline();
      return Promise.resolve(pipeline.id === id ? pipeline : null);
    },
    async getTask(id) {
      const soql = `SELECT ${TASK_FIELDS} FROM Task WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapTaskRow(row) : null;
    },
    async listAccounts(opts) {
      return queryPage(
        ACCOUNT_FIELDS,
        "Account",
        opts?.cursor,
        opts?.limit,
        mapAccountRow,
      );
    },
    async listContacts(opts) {
      return queryPage(
        CONTACT_FIELDS,
        "Contact",
        opts?.cursor,
        opts?.limit,
        mapContactRow,
      );
    },
    async listDeals(opts) {
      return queryPage(
        DEAL_FIELDS,
        "Opportunity",
        opts?.cursor,
        opts?.limit,
        mapDealRow,
      );
    },
    async listLeads(opts) {
      return queryPage(
        LEAD_FIELDS,
        "Lead",
        opts?.cursor,
        opts?.limit,
        mapLeadRow,
      );
    },
    listPipelines(): Promise<CRMPipeline[]> {
      return Promise.resolve([buildDefaultPipeline()]);
    },
    async logActivity(input) {
      const result = await connection.sobject("Task").create({
        ActivityDate: toDateOnly(input.occurredAt),
        Status: "Completed",
        Subject: input.subject ?? `${input.type} call`,
        Type: activityTypeToSF(input.type),
        ...(input.body ? { Description: input.body } : {}),
        ...(input.contactIds?.[0] ? { WhoId: input.contactIds[0] } : {}),
        ...(input.dealId
          ? { WhatId: input.dealId }
          : input.accountId
            ? { WhatId: input.accountId }
            : {}),
        ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
        ...(input.durationSeconds !== undefined
          ? { CallDurationInSeconds: input.durationSeconds }
          : {}),
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR } satisfies CRMActivity;
    },
    async lookupContactByEmail(email) {
      return lookupContactWhere(`Email = '${escapeSoql(email)}'`);
    },
    async lookupContactByPhone(phone) {
      const digits = phone.replace(/\D/gu, "");
      return lookupContactWhere(
        `Phone LIKE '%${digits}%' OR MobilePhone LIKE '%${digits}%'`,
      );
    },
    async searchContacts(query, limit = 10) {
      const escaped = escapeSoql(query);
      const soql = `SELECT ${CONTACT_FIELDS} FROM Contact WHERE Name LIKE '%${escaped}%' OR Email LIKE '%${escaped}%' LIMIT ${Math.min(limit, MAX_PAGE_SIZE)}`;
      const result = await connection.query(soql);
      return result.records.map(mapContactRow);
    },
    async updateAccount(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.name !== undefined) fields.Name = patch.name;
      if (patch.domain !== undefined) fields.Website = patch.domain;
      if (patch.industry !== undefined) fields.Industry = patch.industry;
      if (patch.employees !== undefined)
        fields.NumberOfEmployees = patch.employees;
      if (patch.annualRevenue !== undefined)
        fields.AnnualRevenue = patch.annualRevenue;
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      const result = await connection.sobject("Account").update(fields);
      ensureSaved(result);
      const fetched = await connection.sobject("Account").retrieve(id);
      return mapAccountRow(fetched);
    },
    async updateActivity(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.subject !== undefined) fields.Subject = patch.subject;
      if (patch.body !== undefined) fields.Description = patch.body;
      if (patch.type !== undefined) fields.Type = activityTypeToSF(patch.type);
      if (patch.occurredAt !== undefined)
        fields.ActivityDate = toDateOnly(patch.occurredAt);
      if (patch.durationSeconds !== undefined)
        fields.CallDurationInSeconds = patch.durationSeconds;
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      if (patch.contactIds && patch.contactIds[0])
        fields.WhoId = patch.contactIds[0];
      if (patch.dealId !== undefined) fields.WhatId = patch.dealId;
      else if (patch.accountId !== undefined) fields.WhatId = patch.accountId;
      const result = await connection.sobject("Task").update(fields);
      ensureSaved(result);
      const fetched = await connection.sobject("Task").retrieve(id);
      return mapActivityRow(fetched);
    },
    async updateContact(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.firstName !== undefined) fields.FirstName = patch.firstName;
      if (patch.lastName !== undefined) fields.LastName = patch.lastName;
      if (patch.jobTitle !== undefined) fields.Title = patch.jobTitle;
      if (patch.accountId !== undefined) fields.AccountId = patch.accountId;
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      if (patch.emails && patch.emails[0])
        fields.Email = patch.emails[0].address;
      if (patch.phones && patch.phones[0])
        fields.Phone = patch.phones[0].number;
      const result = await connection.sobject("Contact").update(fields);
      ensureSaved(result);
      const fetched = await connection
        .sobject("Contact")
        .retrieve(id);
      return mapContactRow(fetched);
    },
    async updateDeal(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.title !== undefined) fields.Name = patch.title;
      if (patch.amount !== undefined) fields.Amount = patch.amount;
      if (patch.stageId !== undefined) fields.StageName = patch.stageId;
      if (patch.expectedCloseAt !== undefined) {
        fields.CloseDate = toDateOnly(patch.expectedCloseAt);
      }
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      const result = await connection.sobject("Opportunity").update(fields);
      ensureSaved(result);
      const fetched = await connection
        .sobject("Opportunity")
        .retrieve(id);
      return mapDealRow(fetched);
    },
    async updateLead(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.firstName !== undefined) fields.FirstName = patch.firstName;
      if (patch.lastName !== undefined) fields.LastName = patch.lastName;
      if (patch.company !== undefined) fields.Company = patch.company;
      if (patch.jobTitle !== undefined) fields.Title = patch.jobTitle;
      if (patch.source !== undefined) fields.LeadSource = patch.source;
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      if (patch.emails && patch.emails[0])
        fields.Email = patch.emails[0].address;
      if (patch.phones && patch.phones[0])
        fields.Phone = patch.phones[0].number;
      const result = await connection.sobject("Lead").update(fields);
      ensureSaved(result);
      const fetched = await connection.sobject("Lead").retrieve(id);
      return mapLeadRow(fetched);
    },
    async updateNote(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.body !== undefined) {
        fields.Body = patch.body;
        fields.Title = patch.body.slice(0, 80);
      }
      if (patch.contactIds && patch.contactIds[0])
        fields.ParentId = patch.contactIds[0];
      else if (patch.accountId !== undefined) fields.ParentId = patch.accountId;
      else if (patch.dealId !== undefined) fields.ParentId = patch.dealId;
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      const result = await connection.sobject("Note").update(fields);
      ensureSaved(result);
      const fetched = await connection.sobject("Note").retrieve(id);
      return mapNoteRow(fetched);
    },
    async updateTask(id, patch) {
      const fields: Record<string, unknown> = { Id: id };
      if (patch.subject !== undefined) fields.Subject = patch.subject;
      if (patch.description !== undefined)
        fields.Description = patch.description;
      if (patch.dueAt !== undefined)
        fields.ActivityDate = toDateOnly(patch.dueAt);
      if (patch.status !== undefined) fields.Status = taskStatusToSF(patch.status);
      if (patch.priority !== undefined)
        fields.Priority = taskPriorityToSF(patch.priority);
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      if (patch.contactIds && patch.contactIds[0])
        fields.WhoId = patch.contactIds[0];
      if (patch.dealId !== undefined) fields.WhatId = patch.dealId;
      else if (patch.accountId !== undefined) fields.WhatId = patch.accountId;
      const result = await connection.sobject("Task").update(fields);
      ensureSaved(result);
      const fetched = await connection.sobject("Task").retrieve(id);
      return mapTaskRow(fetched);
    },
    vendor: VENDOR,
  };
};

export {
  mapAccountRow,
  mapActivityRow,
  mapContactRow,
  mapDealRow,
  mapLeadRow,
  mapNoteRow,
  mapTaskRow,
};
