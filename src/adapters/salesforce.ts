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
  CRMNote,
  CRMPhone,
  CRMPipeline,
  CRMTask,
} from "../types";

const VENDOR = "salesforce" as const;

const SALESFORCE_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsLeads: true,
  supportsPipelines: true,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

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

export type SalesforceConnectionLike = {
  query<T = Record<string, unknown>>(
    soql: string,
  ): Promise<SalesforceQueryResult<T>>;
  sobject(name: string): {
    create(record: Record<string, unknown>): Promise<SalesforceSaveResult>;
    update(record: Record<string, unknown>): Promise<SalesforceSaveResult>;
    retrieve(id: string): Promise<Record<string, unknown>>;
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

const ensureSaved = (result: SalesforceSaveResult): string => {
  if (!result.success || !result.id) {
    const message =
      result.errors?.map((e) => e.message).join("; ") ?? "Unknown error";
    throw new Error(`Salesforce save failed: ${message}`);
  }
  return result.id;
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
    const soql = `SELECT Id, FirstName, LastName, Name, Email, Phone, MobilePhone, Title, AccountId, OwnerId FROM Contact WHERE ${where} LIMIT 1`;
    const result = await connection.query(soql);
    const row = result.records[0];
    return row ? mapContactRow(row) : null;
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
          ? new Date(input.expectedCloseAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
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
        ...(input.dueAt
          ? { ActivityDate: new Date(input.dueAt).toISOString().slice(0, 10) }
          : {}),
        Priority:
          input.priority === "high"
            ? "High"
            : input.priority === "low"
              ? "Low"
              : "Normal",
        Status: input.status === "completed" ? "Completed" : "Not Started",
      });
      const id = ensureSaved(result);
      return { ...input, id, vendor: VENDOR } satisfies CRMTask;
    },
    async getContact(id) {
      const soql = `SELECT Id, FirstName, LastName, Name, Email, Phone, MobilePhone, Title, AccountId, OwnerId FROM Contact WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
      const result = await connection.query(soql);
      const row = result.records[0];
      return row ? mapContactRow(row) : null;
    },
    async listPipelines(): Promise<CRMPipeline[]> {
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
      return [
        {
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
        },
      ];
    },
    async logActivity(input) {
      const result = await connection.sobject("Task").create({
        ActivityDate: new Date(input.occurredAt).toISOString().slice(0, 10),
        Status: "Completed",
        Subject: input.subject ?? `${input.type} call`,
        Type:
          input.type === "call"
            ? "Call"
            : input.type === "email"
              ? "Email"
              : input.type === "meeting"
                ? "Meeting"
                : "Other",
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
      const soql = `SELECT Id, FirstName, LastName, Name, Email, Phone, MobilePhone, Title, AccountId, OwnerId FROM Contact WHERE Name LIKE '%${escaped}%' OR Email LIKE '%${escaped}%' LIMIT ${Math.min(limit, 200)}`;
      const result = await connection.query(soql);
      return result.records.map(mapContactRow);
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
        fields.CloseDate = new Date(patch.expectedCloseAt)
          .toISOString()
          .slice(0, 10);
      }
      if (patch.ownerId !== undefined) fields.OwnerId = patch.ownerId;
      const result = await connection.sobject("Opportunity").update(fields);
      ensureSaved(result);
      const fetched = await connection
        .sobject("Opportunity")
        .retrieve(id);
      return mapDealRow(fetched);
    },
    vendor: VENDOR,
  };
};

export {
  mapAccountRow,
  mapContactRow,
  mapDealRow,
  mapLeadRow,
};
