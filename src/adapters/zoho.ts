import type {
  CRMAccount,
  CRMActivity,
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMListOptions,
  CRMListResult,
  CRMNote,
  CRMPipeline,
  CRMTask,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "zoho" as const;

const ZOHO_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: true,
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: true,
  supportsLeads: true,
  supportsListing: true,
  supportsPipelines: false,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

type ZohoContact = {
  id: string;
  First_Name?: string;
  Last_Name?: string;
  Full_Name?: string;
  Email?: string;
  Phone?: string;
  Mobile?: string;
  Title?: string;
  Account_Name?: { id: string; name?: string };
  Owner?: { id: string; name?: string };
};

type ZohoDeal = {
  id: string;
  Deal_Name: string;
  Amount?: number;
  Stage?: string;
  Pipeline?: string;
  Closing_Date?: string;
  Account_Name?: { id: string };
  Owner?: { id: string };
};

type ZohoLead = {
  id: string;
  First_Name?: string;
  Last_Name?: string;
  Email?: string;
  Phone?: string;
  Mobile?: string;
  Company?: string;
  Title?: string;
  Lead_Source?: string;
  Lead_Status?: string;
  Owner?: { id: string };
};

type ZohoAccount = {
  id: string;
  Account_Name: string;
  Website?: string;
  Industry?: string;
  Employees?: number;
  Annual_Revenue?: number;
  Owner?: { id: string };
};

type ZohoCall = {
  id: string;
  Subject?: string;
  Call_Purpose?: string;
  Call_Duration_in_seconds?: number;
  Call_Result?: string;
  Call_Start_Time?: string;
  Call_Type?: string;
  Description?: string;
  Who_Id?: { id: string };
  What_Id?: { id: string };
  Owner?: { id: string };
};

type ZohoNote = {
  id: string;
  Note_Content?: string;
  Note_Title?: string;
  Parent_Id?: { id: string };
  "$se_module"?: string;
  se_module?: string;
  Owner?: { id: string };
};

type ZohoTask = {
  id: string;
  Subject?: string;
  Description?: string;
  Status?: string;
  Priority?: string;
  Due_Date?: string;
  Who_Id?: { id: string };
  What_Id?: { id: string };
  Owner?: { id: string };
};

type ZohoListResponse<T> = {
  data?: T[];
  info?: { more_records?: boolean; page?: number };
} | null;

export type CreateZohoCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
  apiDomain?: string;
  region?: string;
};

const baseUrlFor = (input: CreateZohoCRMAdapterOptions): string => {
  if (input.apiDomain) return input.apiDomain.replace(/\/$/u, "");
  const region = input.region ?? "com";
  return `https://www.zohoapis.${region}`;
};

const mapContact = (record: ZohoContact): CRMContact => ({
  emails: record.Email ? [{ address: record.Email, primary: true }] : [],
  id: record.id,
  phones: [
    ...(record.Phone
      ? [{ label: "work" as const, number: record.Phone }]
      : []),
    ...(record.Mobile
      ? [{ label: "mobile" as const, number: record.Mobile }]
      : []),
  ],
  vendor: VENDOR,
  ...(record.First_Name ? { firstName: record.First_Name } : {}),
  ...(record.Last_Name ? { lastName: record.Last_Name } : {}),
  ...(record.Full_Name ? { fullName: record.Full_Name } : {}),
  ...(record.Title ? { jobTitle: record.Title } : {}),
  ...(record.Account_Name?.id ? { accountId: record.Account_Name.id } : {}),
  ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
});

const mapDeal = (record: ZohoDeal): CRMDeal => ({
  id: record.id,
  title: record.Deal_Name,
  vendor: VENDOR,
  ...(record.Amount !== undefined ? { amount: record.Amount } : {}),
  ...(record.Stage ? { stageId: record.Stage } : {}),
  ...(record.Pipeline ? { pipelineId: record.Pipeline } : {}),
  ...(record.Closing_Date
    ? { expectedCloseAt: new Date(record.Closing_Date).getTime() }
    : {}),
  ...(record.Account_Name?.id ? { accountId: record.Account_Name.id } : {}),
  ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
  status:
    record.Stage === "Closed Won"
      ? "won"
      : record.Stage === "Closed Lost"
        ? "lost"
        : "open",
});

const mapLeadStatus = (raw?: string): CRMLead["status"] | undefined => {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("convert")) return "converted";
  if (v.includes("un") && v.includes("qualif")) return "unqualified";
  if (v.includes("qualif")) return "qualified";
  if (v.includes("work") || v.includes("contact") || v.includes("attempt")) {
    return "working";
  }
  if (v.includes("new") || v.includes("not contacted")) return "new";
  return undefined;
};

const mapLead = (record: ZohoLead): CRMLead => {
  const status = mapLeadStatus(record.Lead_Status);
  return {
    emails: record.Email ? [{ address: record.Email, primary: true }] : [],
    id: record.id,
    phones: [
      ...(record.Phone
        ? [{ label: "work" as const, number: record.Phone }]
        : []),
      ...(record.Mobile
        ? [{ label: "mobile" as const, number: record.Mobile }]
        : []),
    ],
    vendor: VENDOR,
    ...(record.First_Name ? { firstName: record.First_Name } : {}),
    ...(record.Last_Name ? { lastName: record.Last_Name } : {}),
    ...(record.Company ? { company: record.Company } : {}),
    ...(record.Title ? { jobTitle: record.Title } : {}),
    ...(record.Lead_Source ? { source: record.Lead_Source } : {}),
    ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
    ...(status ? { status } : {}),
  };
};

const mapAccount = (record: ZohoAccount): CRMAccount => ({
  id: record.id,
  name: record.Account_Name,
  vendor: VENDOR,
  ...(record.Website ? { domain: record.Website } : {}),
  ...(record.Industry ? { industry: record.Industry } : {}),
  ...(record.Employees !== undefined ? { employees: record.Employees } : {}),
  ...(record.Annual_Revenue !== undefined
    ? { annualRevenue: record.Annual_Revenue }
    : {}),
  ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
});

const mapActivity = (record: ZohoCall): CRMActivity => {
  const subject = record.Call_Purpose ?? record.Subject;
  return {
    id: record.id,
    occurredAt: record.Call_Start_Time
      ? new Date(record.Call_Start_Time).getTime()
      : Date.now(),
    type: "call",
    vendor: VENDOR,
    ...(subject ? { subject } : {}),
    ...(record.Description ? { body: record.Description } : {}),
    ...(record.Call_Duration_in_seconds !== undefined
      ? { durationSeconds: record.Call_Duration_in_seconds }
      : {}),
    ...(record.Call_Result ? { outcome: record.Call_Result } : {}),
    ...(record.Who_Id?.id ? { contactIds: [record.Who_Id.id] } : {}),
    ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
  };
};

const mapNote = (record: ZohoNote): CRMNote => {
  const parentId = record.Parent_Id?.id;
  const module = record["$se_module"] ?? record.se_module;
  return {
    body: record.Note_Content ?? "",
    id: record.id,
    vendor: VENDOR,
    ...(record.Owner?.id ? { ownerId: record.Owner.id } : {}),
    ...(parentId && module === "Deals" ? { dealId: parentId } : {}),
    ...(parentId && module === "Accounts" ? { accountId: parentId } : {}),
    ...(parentId && module === "Contacts" ? { contactIds: [parentId] } : {}),
  };
};

const mapTaskStatus = (raw?: string): CRMTask["status"] | undefined => {
  switch (raw) {
    case "Completed":
      return "completed";
    case "In Progress":
      return "in-progress";
    case "Deferred":
    case "Waiting on someone else":
      return "cancelled";
    case "Not Started":
      return "pending";
    default:
      return undefined;
  }
};

const mapTaskPriority = (raw?: string): CRMTask["priority"] | undefined => {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("high")) return "high";
  if (v.includes("low")) return "low";
  return "normal";
};

const mapTask = (record: ZohoTask): CRMTask => {
  const status = mapTaskStatus(record.Status);
  const priority = mapTaskPriority(record.Priority);
  return {
    id: record.id,
    subject: record.Subject ?? "",
    vendor: VENDOR,
    ...(record.Description ? { description: record.Description } : {}),
    ...(record.Due_Date ? { dueAt: new Date(record.Due_Date).getTime() } : {}),
    ...(record.Who_Id?.id ? { contactIds: [record.Who_Id.id] } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };
};

export const createZohoCRMAdapter = async (
  input: CreateZohoCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const baseUrl = baseUrlFor(input);
  const http = input.httpClient ?? createFetchCRMHttpClient();

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Zoho-Oauthtoken ${input.accessToken}`,
    "Content-Type": "application/json",
  });

  const request = async <T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await http<T>({
      body,
      headers: authHeaders(),
      method,
      url: `${baseUrl}/crm/v2${path}`,
    });
    return assertHttpOk(response, `Zoho ${method} ${path}`);
  };

  const writeRecord = async <T>(
    module: string,
    record: Record<string, unknown>,
  ): Promise<T> => {
    const response = await request<{
      data: { code: string; details: { id: string } }[];
    }>("POST", `/${module}`, { data: [record] });
    const created = response.data[0];
    if (!created || created.code !== "SUCCESS") {
      throw new Error(
        `Zoho ${module} create failed: ${JSON.stringify(created)}`,
      );
    }
    return { id: created.details.id } as T;
  };

  const deleteRecord = async (module: string, id: string): Promise<void> => {
    await request<unknown>("DELETE", `/${module}/${id}`);
  };

  const listRecords = async <Z, T>(
    module: string,
    opts: CRMListOptions | undefined,
    map: (record: Z) => T,
  ): Promise<CRMListResult<T>> => {
    const perPage = Math.min(opts?.limit ?? 200, 200);
    const page = opts?.cursor ? Number(opts.cursor) : 1;
    const result = await request<ZohoListResponse<Z>>(
      "GET",
      `/${module}?page=${page}&per_page=${perPage}`,
    );
    const items = (result?.data ?? []).map(map);
    return result?.info?.more_records === true
      ? { items, nextCursor: String(page + 1) }
      : { items };
  };

  return {
    async addNote(noteInput) {
      const parentModule = noteInput.dealId
        ? "Deals"
        : noteInput.accountId
          ? "Accounts"
          : "Contacts";
      const parentId =
        noteInput.dealId ?? noteInput.accountId ?? noteInput.contactIds?.[0];
      if (!parentId) {
        throw new Error("Zoho note requires contactId, dealId, or accountId");
      }
      const note = await writeRecord<{ id: string }>("Notes", {
        Note_Content: noteInput.body,
        Note_Title: noteInput.body.slice(0, 80),
        Parent_Id: parentId,
        se_module: parentModule,
      });
      return {
        body: noteInput.body,
        id: note.id,
        vendor: VENDOR,
        ...(noteInput.contactIds !== undefined
          ? { contactIds: noteInput.contactIds }
          : {}),
        ...(noteInput.dealId !== undefined ? { dealId: noteInput.dealId } : {}),
        ...(noteInput.accountId !== undefined
          ? { accountId: noteInput.accountId }
          : {}),
        ...(noteInput.ownerId !== undefined ? { ownerId: noteInput.ownerId } : {}),
      };
    },
    capabilities: ZOHO_CAPABILITIES,
    async convertLead(leadId, options) {
      const dealBlock =
        options?.dealTitle || options?.dealAmount !== undefined
          ? {
              Deals: {
                ...(options?.dealTitle ? { Deal_Name: options.dealTitle } : {}),
                ...(options?.dealAmount !== undefined
                  ? { Amount: options.dealAmount }
                  : {}),
              },
            }
          : {};
      const response = await request<{
        data: { Contacts?: string; Deals?: string; Accounts?: string }[];
      }>("POST", `/Leads/${leadId}/actions/convert`, {
        data: [{ ...dealBlock }],
      });
      const result = response.data[0];
      if (!result?.Contacts) {
        throw new Error(
          `Zoho lead ${leadId} conversion returned no contact id`,
        );
      }
      const contactResult = await request<{ data: ZohoContact[] }>(
        "GET",
        `/Contacts/${result.Contacts}`,
      );
      const contactRow = contactResult.data[0];
      if (!contactRow) {
        throw new Error(
          `Zoho contact ${result.Contacts} not found after lead convert`,
        );
      }
      const contact = mapContact(contactRow);
      if (!result.Deals) return { contact };
      const dealResult = await request<{ data: ZohoDeal[] }>(
        "GET",
        `/Deals/${result.Deals}`,
      );
      const dealRow = dealResult.data[0];
      return dealRow
        ? { contact, deal: mapDeal(dealRow) }
        : { contact };
    },
    async createAccount(accountInput) {
      const created = await writeRecord<{ id: string }>("Accounts", {
        Account_Name: accountInput.name,
        Annual_Revenue: accountInput.annualRevenue,
        Employees: accountInput.employees,
        Industry: accountInput.industry,
        Website: accountInput.domain,
      });
      return { ...accountInput, id: created.id, vendor: VENDOR };
    },
    async createContact(contactInput) {
      const created = await writeRecord<{ id: string }>("Contacts", {
        Email: contactInput.emails[0]?.address,
        First_Name: contactInput.firstName,
        Last_Name: contactInput.lastName ?? contactInput.firstName ?? "Unknown",
        Mobile: contactInput.phones.find((p) => p.label === "mobile")?.number,
        Phone: contactInput.phones.find((p) => p.label !== "mobile")?.number,
        Title: contactInput.jobTitle,
      });
      return { ...contactInput, id: created.id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const created = await writeRecord<{ id: string }>("Deals", {
        Amount: dealInput.amount,
        Closing_Date: dealInput.expectedCloseAt
          ? new Date(dealInput.expectedCloseAt).toISOString().slice(0, 10)
          : undefined,
        Deal_Name: dealInput.title,
        Stage: dealInput.stageId ?? "Qualification",
      });
      return { ...dealInput, id: created.id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const created = await writeRecord<{ id: string }>("Leads", {
        Company: leadInput.company ?? "Unknown",
        Email: leadInput.emails[0]?.address,
        First_Name: leadInput.firstName,
        Last_Name: leadInput.lastName ?? leadInput.firstName ?? "Unknown",
        Lead_Source: leadInput.source,
        Phone: leadInput.phones[0]?.number,
        Title: leadInput.jobTitle,
      });
      return { ...leadInput, id: created.id, vendor: VENDOR } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const created = await writeRecord<{ id: string }>("Tasks", {
        Description: taskInput.description,
        Due_Date: taskInput.dueAt
          ? new Date(taskInput.dueAt).toISOString().slice(0, 10)
          : undefined,
        Priority:
          taskInput.priority === "high"
            ? "High"
            : taskInput.priority === "low"
              ? "Low"
              : "Normal",
        Status: taskInput.status === "completed" ? "Completed" : "Not Started",
        Subject: taskInput.subject,
      });
      return { ...taskInput, id: created.id, vendor: VENDOR };
    },
    async deleteAccount(id) {
      await deleteRecord("Accounts", id);
    },
    async deleteContact(id) {
      await deleteRecord("Contacts", id);
    },
    async deleteDeal(id) {
      await deleteRecord("Deals", id);
    },
    async deleteLead(id) {
      await deleteRecord("Leads", id);
    },
    async deleteNote(id) {
      await deleteRecord("Notes", id);
    },
    async deleteTask(id) {
      await deleteRecord("Tasks", id);
    },
    async getAccount(id) {
      const result = await request<{ data: ZohoAccount[] }>(
        "GET",
        `/Accounts/${id}`,
      );
      const record = result.data[0];
      return record ? mapAccount(record) : null;
    },
    async getActivity(id) {
      const result = await request<{ data: ZohoCall[] }>(
        "GET",
        `/Calls/${id}`,
      );
      const record = result.data[0];
      return record ? mapActivity(record) : null;
    },
    async getContact(id) {
      const result = await request<{ data: ZohoContact[] }>(
        "GET",
        `/Contacts/${id}`,
      );
      const record = result.data[0];
      return record ? mapContact(record) : null;
    },
    async getDeal(id) {
      const result = await request<{ data: ZohoDeal[] }>(
        "GET",
        `/Deals/${id}`,
      );
      const record = result.data[0];
      return record ? mapDeal(record) : null;
    },
    async getLead(id) {
      const result = await request<{ data: ZohoLead[] }>(
        "GET",
        `/Leads/${id}`,
      );
      const record = result.data[0];
      return record ? mapLead(record) : null;
    },
    async getNote(id) {
      const result = await request<{ data: ZohoNote[] }>(
        "GET",
        `/Notes/${id}`,
      );
      const record = result.data[0];
      return record ? mapNote(record) : null;
    },
    // Zoho Deals use Layouts/Stages rather than first-class Pipeline objects;
    // supportsPipelines is false, so this read is a typed no-op like listPipelines.
    async getPipeline(): Promise<CRMPipeline | null> {
      return null;
    },
    async getTask(id) {
      const result = await request<{ data: ZohoTask[] }>(
        "GET",
        `/Tasks/${id}`,
      );
      const record = result.data[0];
      return record ? mapTask(record) : null;
    },
    async listAccounts(opts) {
      return listRecords<ZohoAccount, CRMAccount>("Accounts", opts, mapAccount);
    },
    async listContacts(opts) {
      return listRecords<ZohoContact, CRMContact>("Contacts", opts, mapContact);
    },
    async listDeals(opts) {
      return listRecords<ZohoDeal, CRMDeal>("Deals", opts, mapDeal);
    },
    async listLeads(opts) {
      return listRecords<ZohoLead, CRMLead>("Leads", opts, mapLead);
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      return [];
    },
    async logActivity(activityInput) {
      const created = await writeRecord<{ id: string }>("Calls", {
        Call_Duration_in_seconds: activityInput.durationSeconds,
        Call_Purpose: activityInput.subject ?? "Voice agent call",
        Call_Result: activityInput.outcome,
        Call_Start_Time: new Date(activityInput.occurredAt).toISOString(),
        Call_Type: "Outbound",
        Description: activityInput.body,
        Who_Id: activityInput.contactIds?.[0],
      });
      return {
        ...activityInput,
        id: created.id,
        vendor: VENDOR,
      };
    },
    async lookupContactByEmail(email) {
      const result = await request<{ data?: ZohoContact[] }>(
        "GET",
        `/Contacts/search?email=${encodeURIComponent(email)}`,
      );
      const first = result.data?.[0];
      return first ? mapContact(first) : null;
    },
    async lookupContactByPhone(phone) {
      const result = await request<{ data?: ZohoContact[] }>(
        "GET",
        `/Contacts/search?phone=${encodeURIComponent(phone)}`,
      );
      const first = result.data?.[0];
      return first ? mapContact(first) : null;
    },
    async searchContacts(query, limit = 10) {
      const result = await request<{ data?: ZohoContact[] }>(
        "GET",
        `/Contacts/search?word=${encodeURIComponent(query)}`,
      );
      return (result.data ?? []).slice(0, limit).map(mapContact);
    },
    async updateContact(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.firstName !== undefined) updates.First_Name = patch.firstName;
      if (patch.lastName !== undefined) updates.Last_Name = patch.lastName;
      if (patch.jobTitle !== undefined) updates.Title = patch.jobTitle;
      if (patch.emails?.[0]) updates.Email = patch.emails[0].address;
      const work = patch.phones?.find((p) => p.label !== "mobile");
      const mobile = patch.phones?.find((p) => p.label === "mobile");
      if (work) updates.Phone = work.number;
      if (mobile) updates.Mobile = mobile.number;
      await request<unknown>("PUT", "/Contacts", { data: [updates] });
      const refreshed = await request<{ data: ZohoContact[] }>(
        "GET",
        `/Contacts/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho contact ${id} not found after update`);
      return mapContact(record);
    },
    async updateDeal(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.title !== undefined) updates.Deal_Name = patch.title;
      if (patch.amount !== undefined) updates.Amount = patch.amount;
      if (patch.stageId !== undefined) updates.Stage = patch.stageId;
      if (patch.expectedCloseAt !== undefined) {
        updates.Closing_Date = new Date(patch.expectedCloseAt)
          .toISOString()
          .slice(0, 10);
      }
      await request<unknown>("PUT", "/Deals", { data: [updates] });
      const refreshed = await request<{ data: ZohoDeal[] }>(
        "GET",
        `/Deals/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho deal ${id} not found after update`);
      return mapDeal(record);
    },
    async updateAccount(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.name !== undefined) updates.Account_Name = patch.name;
      if (patch.domain !== undefined) updates.Website = patch.domain;
      if (patch.industry !== undefined) updates.Industry = patch.industry;
      if (patch.employees !== undefined) updates.Employees = patch.employees;
      if (patch.annualRevenue !== undefined) {
        updates.Annual_Revenue = patch.annualRevenue;
      }
      if (patch.ownerId !== undefined) updates.Owner = { id: patch.ownerId };
      await request<unknown>("PUT", "/Accounts", { data: [updates] });
      const refreshed = await request<{ data: ZohoAccount[] }>(
        "GET",
        `/Accounts/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho account ${id} not found after update`);
      return mapAccount(record);
    },
    async updateActivity(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.subject !== undefined) updates.Call_Purpose = patch.subject;
      if (patch.body !== undefined) updates.Description = patch.body;
      if (patch.outcome !== undefined) updates.Call_Result = patch.outcome;
      if (patch.durationSeconds !== undefined) {
        updates.Call_Duration_in_seconds = patch.durationSeconds;
      }
      if (patch.occurredAt !== undefined) {
        updates.Call_Start_Time = new Date(patch.occurredAt).toISOString();
      }
      await request<unknown>("PUT", "/Calls", { data: [updates] });
      const refreshed = await request<{ data: ZohoCall[] }>(
        "GET",
        `/Calls/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho activity ${id} not found after update`);
      return mapActivity(record);
    },
    async updateLead(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.firstName !== undefined) updates.First_Name = patch.firstName;
      if (patch.lastName !== undefined) updates.Last_Name = patch.lastName;
      if (patch.company !== undefined) updates.Company = patch.company;
      if (patch.jobTitle !== undefined) updates.Title = patch.jobTitle;
      if (patch.source !== undefined) updates.Lead_Source = patch.source;
      if (patch.emails?.[0]) updates.Email = patch.emails[0].address;
      const work = patch.phones?.find((p) => p.label !== "mobile");
      const mobile = patch.phones?.find((p) => p.label === "mobile");
      if (work) updates.Phone = work.number;
      if (mobile) updates.Mobile = mobile.number;
      await request<unknown>("PUT", "/Leads", { data: [updates] });
      const refreshed = await request<{ data: ZohoLead[] }>(
        "GET",
        `/Leads/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho lead ${id} not found after update`);
      return mapLead(record);
    },
    async updateNote(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.body !== undefined) {
        updates.Note_Content = patch.body;
        updates.Note_Title = patch.body.slice(0, 80);
      }
      await request<unknown>("PUT", "/Notes", { data: [updates] });
      const refreshed = await request<{ data: ZohoNote[] }>(
        "GET",
        `/Notes/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho note ${id} not found after update`);
      return mapNote(record);
    },
    async updateTask(id, patch) {
      const updates: Record<string, unknown> = { id };
      if (patch.subject !== undefined) updates.Subject = patch.subject;
      if (patch.description !== undefined) {
        updates.Description = patch.description;
      }
      if (patch.dueAt !== undefined) {
        updates.Due_Date = new Date(patch.dueAt).toISOString().slice(0, 10);
      }
      if (patch.priority !== undefined) {
        updates.Priority =
          patch.priority === "high"
            ? "High"
            : patch.priority === "low"
              ? "Low"
              : "Normal";
      }
      if (patch.status !== undefined) {
        updates.Status =
          patch.status === "completed"
            ? "Completed"
            : patch.status === "in-progress"
              ? "In Progress"
              : patch.status === "cancelled"
                ? "Deferred"
                : "Not Started";
      }
      await request<unknown>("PUT", "/Tasks", { data: [updates] });
      const refreshed = await request<{ data: ZohoTask[] }>(
        "GET",
        `/Tasks/${id}`,
      );
      const record = refreshed.data[0];
      if (!record) throw new Error(`Zoho task ${id} not found after update`);
      return mapTask(record);
    },
    vendor: VENDOR,
  };
};

export {
  mapContact as mapZohoContact,
  mapDeal as mapZohoDeal,
};
