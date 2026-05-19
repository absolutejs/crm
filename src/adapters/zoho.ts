import type {
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMPipeline,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "zoho" as const;

const ZOHO_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsLeads: true,
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
    async getContact(id) {
      const result = await request<{ data: ZohoContact[] }>(
        "GET",
        `/Contacts/${id}`,
      );
      const record = result.data[0];
      return record ? mapContact(record) : null;
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
    vendor: VENDOR,
  };
};

export {
  mapContact as mapZohoContact,
  mapDeal as mapZohoDeal,
};
