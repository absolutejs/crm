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

const VENDOR = "attio" as const;

const ATTIO_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: true,
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: false,
  supportsLeads: false,
  supportsListing: true,
  supportsPipelines: false,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

const DEFAULT_LIST_LIMIT = 50;

const parseOffset = (cursor: string | undefined): number => {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

type AttioValue<T = unknown> = { value: T }[];

type AttioPersonRecord = {
  id: { record_id: string };
  values: {
    name?: AttioValue<{ first_name?: string; last_name?: string; full_name?: string }>;
    email_addresses?: AttioValue<string>;
    phone_numbers?: AttioValue<string>;
    job_title?: AttioValue<string>;
    company?: AttioValue<{ target_record_id: string }>;
  };
};

type AttioDealRecord = {
  id: { record_id: string };
  values: {
    name?: AttioValue<string>;
    value?: AttioValue<{ currency_value: number; currency_code?: string }>;
    stage?: AttioValue<string>;
    close_date?: AttioValue<{ value: string }>;
  };
};

type AttioCompanyRecord = {
  id: { record_id: string };
  values: {
    name?: AttioValue<string>;
    domains?: AttioValue<{ domain: string }>;
  };
};

type AttioNoteRecord = {
  id: { note_id: string };
  parent_object?: string;
  parent_record_id?: string;
  content_plaintext?: string;
  created_at?: string;
};

type AttioTaskRecord = {
  id: { task_id: string };
  content_plaintext?: string;
  deadline_at?: string | null;
  is_completed?: boolean;
  linked_records?: { target_object_id?: string; target_record_id: string }[];
};

export type CreateAttioCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
};

const firstValue = <T>(field: AttioValue<T> | undefined): T | undefined =>
  field?.[0]?.value;

const mapPerson = (record: AttioPersonRecord): CRMContact => {
  const nameValue = firstValue(record.values.name);
  const emails = (record.values.email_addresses ?? []).map((e) => ({
    address: typeof e.value === "string" ? e.value : String(e.value),
    primary: false,
  }));
  if (emails[0]) emails[0].primary = true;
  const phones = (record.values.phone_numbers ?? []).map((p) => ({
    label: "work" as const,
    number: typeof p.value === "string" ? p.value : String(p.value),
  }));
  const company = firstValue(record.values.company);
  return {
    emails,
    id: record.id.record_id,
    phones,
    vendor: VENDOR,
    ...(nameValue?.first_name ? { firstName: nameValue.first_name } : {}),
    ...(nameValue?.last_name ? { lastName: nameValue.last_name } : {}),
    ...(nameValue?.full_name ? { fullName: nameValue.full_name } : {}),
    ...(firstValue(record.values.job_title)
      ? { jobTitle: firstValue(record.values.job_title) }
      : {}),
    ...(company?.target_record_id
      ? { accountId: company.target_record_id }
      : {}),
  };
};

const mapDeal = (record: AttioDealRecord): CRMDeal => {
  const value = firstValue(record.values.value);
  const close = firstValue(record.values.close_date);
  return {
    id: record.id.record_id,
    title: String(firstValue(record.values.name) ?? ""),
    vendor: VENDOR,
    ...(value?.currency_value !== undefined
      ? { amount: value.currency_value }
      : {}),
    ...(value?.currency_code ? { currency: value.currency_code } : {}),
    ...(firstValue(record.values.stage)
      ? { stageId: String(firstValue(record.values.stage)) }
      : {}),
    ...(close?.value
      ? { expectedCloseAt: new Date(close.value).getTime() }
      : {}),
    status: "open",
  };
};

const mapPersonAsLead = (record: AttioPersonRecord): CRMLead => {
  const nameValue = firstValue(record.values.name);
  const emails = (record.values.email_addresses ?? []).map((e) => ({
    address: typeof e.value === "string" ? e.value : String(e.value),
    primary: false,
  }));
  if (emails[0]) emails[0].primary = true;
  const phones = (record.values.phone_numbers ?? []).map((p) => ({
    label: "work" as const,
    number: typeof p.value === "string" ? p.value : String(p.value),
  }));
  return {
    emails,
    id: record.id.record_id,
    phones,
    vendor: VENDOR,
    ...(nameValue?.first_name ? { firstName: nameValue.first_name } : {}),
    ...(nameValue?.last_name ? { lastName: nameValue.last_name } : {}),
    ...(firstValue(record.values.job_title)
      ? { jobTitle: firstValue(record.values.job_title) }
      : {}),
  };
};

const mapCompany = (record: AttioCompanyRecord): CRMAccount => {
  const domain = firstValue(record.values.domains);
  return {
    id: record.id.record_id,
    name: String(firstValue(record.values.name) ?? ""),
    vendor: VENDOR,
    ...(domain?.domain ? { domain: domain.domain } : {}),
  };
};

const noteParentLink = (
  record: AttioNoteRecord,
): { contactIds: string[] } | { accountId: string } | Record<string, never> => {
  if (record.parent_record_id === undefined) return {};
  if (record.parent_object === "people")
    return { contactIds: [record.parent_record_id] };
  if (record.parent_object === "companies")
    return { accountId: record.parent_record_id };
  return {};
};

const mapNote = (record: AttioNoteRecord): CRMNote => ({
  body: record.content_plaintext ?? "",
  id: record.id.note_id,
  vendor: VENDOR,
  ...noteParentLink(record),
  ...(record.created_at
    ? { createdAt: new Date(record.created_at).getTime() }
    : {}),
});

const mapNoteAsActivity = (record: AttioNoteRecord): CRMActivity => ({
  body: record.content_plaintext ?? "",
  id: record.id.note_id,
  occurredAt: record.created_at
    ? new Date(record.created_at).getTime()
    : Date.now(),
  type: "note",
  vendor: VENDOR,
  ...noteParentLink(record),
});

const mapTask = (record: AttioTaskRecord): CRMTask => {
  const linked = (record.linked_records ?? []).map((l) => l.target_record_id);
  return {
    id: record.id.task_id,
    status: record.is_completed ? "completed" : "pending",
    subject: record.content_plaintext ?? "",
    vendor: VENDOR,
    ...(linked.length > 0 ? { contactIds: linked } : {}),
    ...(record.deadline_at
      ? { dueAt: new Date(record.deadline_at).getTime() }
      : {}),
  };
};

export const createAttioCRMAdapter = async (
  input: CreateAttioCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const http = input.httpClient ?? createFetchCRMHttpClient();
  const baseUrl = "https://api.attio.com/v2";
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${input.accessToken}`,
    "Content-Type": "application/json",
  });

  const request = async <T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await http<T>({
      body,
      headers: authHeaders(),
      method,
      url: `${baseUrl}${path}`,
    });
    return assertHttpOk(response, `Attio ${method} ${path}`);
  };

  const createPersonRecord = async (
    values: Record<string, unknown>,
  ): Promise<{ record_id: string }> => {
    const response = await request<{ data: AttioPersonRecord }>(
      "POST",
      "/objects/people/records",
      { data: { values } },
    );
    return { record_id: response.data.id.record_id };
  };

  const queryRecords = async <R>(
    object: string,
    opts: CRMListOptions | undefined,
  ): Promise<{ records: R[]; limit: number; offset: number }> => {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const offset = parseOffset(opts?.cursor);
    const result = await request<{ data: R[] }>(
      "POST",
      `/objects/${object}/records/query`,
      { limit, offset },
    );
    return { limit, offset, records: result.data };
  };

  const nextCursorFor = (
    records: unknown[],
    limit: number,
    offset: number,
  ): { nextCursor: string } | Record<string, never> =>
    records.length === limit
      ? { nextCursor: String(offset + records.length) }
      : {};

  return {
    async addNote(noteInput) {
      const note = await request<{ data: { id: { note_id: string } } }>(
        "POST",
        "/notes",
        {
          data: {
            content: noteInput.body,
            format: "plaintext",
            ...(noteInput.contactIds?.[0]
              ? {
                  parent_object: "people",
                  parent_record_id: noteInput.contactIds[0],
                }
              : noteInput.accountId
                ? {
                    parent_object: "companies",
                    parent_record_id: noteInput.accountId,
                  }
                : {}),
          },
        },
      );
      return {
        body: noteInput.body,
        id: note.data.id.note_id,
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
    capabilities: ATTIO_CAPABILITIES,
    async createAccount(accountInput) {
      const values: Record<string, unknown> = { name: accountInput.name };
      if (accountInput.domain) values.domains = [accountInput.domain];
      const response = await request<{ data: AttioCompanyRecord }>(
        "POST",
        "/objects/companies/records",
        { data: { values } },
      );
      return { ...accountInput, id: response.data.id.record_id, vendor: VENDOR };
    },
    async createContact(contactInput) {
      const values: Record<string, unknown> = {
        email_addresses: contactInput.emails.map((e) => e.address),
        name: [
          {
            first_name: contactInput.firstName,
            full_name:
              contactInput.fullName ??
              [contactInput.firstName, contactInput.lastName]
                .filter(Boolean)
                .join(" "),
            last_name: contactInput.lastName,
          },
        ],
        phone_numbers: contactInput.phones.map((p) => p.number),
      };
      if (contactInput.jobTitle) values.job_title = contactInput.jobTitle;
      const record = await createPersonRecord(values);
      return { ...contactInput, id: record.record_id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const values: Record<string, unknown> = {
        name: dealInput.title,
        ...(dealInput.amount !== undefined && dealInput.currency
          ? {
              value: {
                currency_code: dealInput.currency,
                currency_value: dealInput.amount,
              },
            }
          : {}),
        ...(dealInput.stageId ? { stage: dealInput.stageId } : {}),
        ...(dealInput.expectedCloseAt
          ? {
              close_date: new Date(dealInput.expectedCloseAt)
                .toISOString()
                .slice(0, 10),
            }
          : {}),
      };
      const response = await request<{ data: AttioDealRecord }>(
        "POST",
        "/objects/deals/records",
        { data: { values } },
      );
      return { ...dealInput, id: response.data.id.record_id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const values: Record<string, unknown> = {
        email_addresses: leadInput.emails.map((e) => e.address),
        name: [
          {
            first_name: leadInput.firstName,
            full_name: [leadInput.firstName, leadInput.lastName]
              .filter(Boolean)
              .join(" "),
            last_name: leadInput.lastName,
          },
        ],
        phone_numbers: leadInput.phones.map((p) => p.number),
      };
      if (leadInput.jobTitle) values.job_title = leadInput.jobTitle;
      if (leadInput.source) values.source = leadInput.source;
      const record = await createPersonRecord(values);
      return {
        ...leadInput,
        id: record.record_id,
        vendor: VENDOR,
      } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const response = await request<{ data: { id: { task_id: string } } }>(
        "POST",
        "/tasks",
        {
          data: {
            content: taskInput.subject,
            ...(taskInput.dueAt
              ? { deadline_at: new Date(taskInput.dueAt).toISOString() }
              : {}),
            is_completed: taskInput.status === "completed",
            ...(taskInput.contactIds?.[0]
              ? {
                  linked_records: [
                    {
                      target_object: "people",
                      target_record_id: taskInput.contactIds[0],
                    },
                  ],
                }
              : {}),
          },
        },
      );
      return { ...taskInput, id: response.data.id.task_id, vendor: VENDOR };
    },
    async deleteAccount(id) {
      await request<unknown>("DELETE", `/objects/companies/records/${id}`);
    },
    async deleteContact(id) {
      await request<unknown>("DELETE", `/objects/people/records/${id}`);
    },
    async deleteDeal(id) {
      await request<unknown>("DELETE", `/objects/deals/records/${id}`);
    },
    async deleteLead(id) {
      await request<unknown>("DELETE", `/objects/people/records/${id}`);
    },
    async deleteNote(id) {
      await request<unknown>("DELETE", `/notes/${id}`);
    },
    async deleteTask(id) {
      await request<unknown>("DELETE", `/tasks/${id}`);
    },
    async getAccount(id) {
      const result = await request<{ data: AttioCompanyRecord }>(
        "GET",
        `/objects/companies/records/${id}`,
      );
      return mapCompany(result.data);
    },
    async getActivity(id) {
      const result = await request<{ data: AttioNoteRecord }>(
        "GET",
        `/notes/${id}`,
      );
      return mapNoteAsActivity(result.data);
    },
    async getContact(id) {
      const result = await request<{ data: AttioPersonRecord }>(
        "GET",
        `/objects/people/records/${id}`,
      );
      return mapPerson(result.data);
    },
    async getDeal(id) {
      const result = await request<{ data: AttioDealRecord }>(
        "GET",
        `/objects/deals/records/${id}`,
      );
      return mapDeal(result.data);
    },
    async getLead(id) {
      const result = await request<{ data: AttioPersonRecord }>(
        "GET",
        `/objects/people/records/${id}`,
      );
      return mapPersonAsLead(result.data);
    },
    async getNote(id) {
      const result = await request<{ data: AttioNoteRecord }>(
        "GET",
        `/notes/${id}`,
      );
      return mapNote(result.data);
    },
    async getPipeline(): Promise<CRMPipeline | null> {
      return null;
    },
    async getTask(id) {
      const result = await request<{ data: AttioTaskRecord }>(
        "GET",
        `/tasks/${id}`,
      );
      return mapTask(result.data);
    },
    async listAccounts(opts): Promise<CRMListResult<CRMAccount>> {
      const { limit, offset, records } = await queryRecords<AttioCompanyRecord>(
        "companies",
        opts,
      );
      return {
        items: records.map(mapCompany),
        ...nextCursorFor(records, limit, offset),
      };
    },
    async listContacts(opts): Promise<CRMListResult<CRMContact>> {
      const { limit, offset, records } = await queryRecords<AttioPersonRecord>(
        "people",
        opts,
      );
      return {
        items: records.map(mapPerson),
        ...nextCursorFor(records, limit, offset),
      };
    },
    async listDeals(opts): Promise<CRMListResult<CRMDeal>> {
      const { limit, offset, records } = await queryRecords<AttioDealRecord>(
        "deals",
        opts,
      );
      return {
        items: records.map(mapDeal),
        ...nextCursorFor(records, limit, offset),
      };
    },
    async listLeads(opts): Promise<CRMListResult<CRMLead>> {
      const { limit, offset, records } = await queryRecords<AttioPersonRecord>(
        "people",
        opts,
      );
      return {
        items: records.map(mapPersonAsLead),
        ...nextCursorFor(records, limit, offset),
      };
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      return [];
    },
    async logActivity(activityInput) {
      const noteBody = `[${activityInput.type}] ${activityInput.subject ?? "Voice call"}: ${activityInput.body ?? ""}`;
      const response = await request<{ data: { id: { note_id: string } } }>(
        "POST",
        "/notes",
        {
          data: {
            content: noteBody,
            format: "plaintext",
            ...(activityInput.contactIds?.[0]
              ? {
                  parent_object: "people",
                  parent_record_id: activityInput.contactIds[0],
                }
              : activityInput.accountId
                ? {
                    parent_object: "companies",
                    parent_record_id: activityInput.accountId,
                  }
                : {}),
          },
        },
      );
      return {
        ...activityInput,
        id: response.data.id.note_id,
        vendor: VENDOR,
      };
    },
    async lookupContactByEmail(email) {
      const result = await request<{ data: AttioPersonRecord[] }>(
        "POST",
        "/objects/people/records/query",
        {
          filter: { email_addresses: email },
          limit: 1,
        },
      );
      const record = result.data[0];
      return record ? mapPerson(record) : null;
    },
    async lookupContactByPhone(phone) {
      const result = await request<{ data: AttioPersonRecord[] }>(
        "POST",
        "/objects/people/records/query",
        {
          filter: { phone_numbers: phone },
          limit: 1,
        },
      );
      const record = result.data[0];
      return record ? mapPerson(record) : null;
    },
    async searchContacts(query, limit = 10) {
      const result = await request<{ data: AttioPersonRecord[] }>(
        "POST",
        "/objects/people/records/query",
        {
          filter: { name: { $contains: query } },
          limit,
        },
      );
      return result.data.map(mapPerson);
    },
    async updateContact(id, patch) {
      const values: Record<string, unknown> = {};
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        values.name = [
          {
            first_name: patch.firstName,
            full_name: [patch.firstName, patch.lastName]
              .filter(Boolean)
              .join(" "),
            last_name: patch.lastName,
          },
        ];
      }
      if (patch.emails) {
        values.email_addresses = patch.emails.map((e) => e.address);
      }
      if (patch.phones) {
        values.phone_numbers = patch.phones.map((p) => p.number);
      }
      if (patch.jobTitle !== undefined) values.job_title = patch.jobTitle;
      const result = await request<{ data: AttioPersonRecord }>(
        "PATCH",
        `/objects/people/records/${id}`,
        { data: { values } },
      );
      return mapPerson(result.data);
    },
    async updateDeal(id, patch) {
      const values: Record<string, unknown> = {};
      if (patch.title !== undefined) values.name = patch.title;
      if (patch.amount !== undefined && patch.currency) {
        values.value = {
          currency_code: patch.currency,
          currency_value: patch.amount,
        };
      }
      if (patch.stageId !== undefined) values.stage = patch.stageId;
      const result = await request<{ data: AttioDealRecord }>(
        "PATCH",
        `/objects/deals/records/${id}`,
        { data: { values } },
      );
      return mapDeal(result.data);
    },
    async updateAccount(id, patch) {
      const values: Record<string, unknown> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.domain !== undefined) values.domains = [patch.domain];
      const result = await request<{ data: AttioCompanyRecord }>(
        "PATCH",
        `/objects/companies/records/${id}`,
        { data: { values } },
      );
      return mapCompany(result.data);
    },
    async updateActivity() {
      throw new Error(
        "Attio stores activities as immutable notes; there is no content update endpoint, so updateActivity is unsupported",
      );
    },
    async updateLead(id, patch) {
      const values: Record<string, unknown> = {};
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        values.name = [
          {
            first_name: patch.firstName,
            full_name: [patch.firstName, patch.lastName]
              .filter(Boolean)
              .join(" "),
            last_name: patch.lastName,
          },
        ];
      }
      if (patch.emails) {
        values.email_addresses = patch.emails.map((e) => e.address);
      }
      if (patch.phones) {
        values.phone_numbers = patch.phones.map((p) => p.number);
      }
      if (patch.jobTitle !== undefined) values.job_title = patch.jobTitle;
      const result = await request<{ data: AttioPersonRecord }>(
        "PATCH",
        `/objects/people/records/${id}`,
        { data: { values } },
      );
      return mapPersonAsLead(result.data);
    },
    async updateNote() {
      throw new Error(
        "Attio notes are immutable via the API (no update endpoint), so updateNote is unsupported",
      );
    },
    async updateTask(id, patch) {
      // Attio only permits updating deadline_at, is_completed, and
      // linked_records on a task (content is immutable).
      const data: Record<string, unknown> = {};
      if (patch.dueAt !== undefined) {
        data.deadline_at = new Date(patch.dueAt).toISOString();
      }
      if (patch.status !== undefined) {
        data.is_completed = patch.status === "completed";
      }
      if (patch.contactIds !== undefined) {
        data.linked_records = patch.contactIds.map((contactId) => ({
          target_object: "people",
          target_record_id: contactId,
        }));
      }
      const result = await request<{ data: AttioTaskRecord }>(
        "PATCH",
        `/tasks/${id}`,
        { data },
      );
      return mapTask(result.data);
    },
    vendor: VENDOR,
  };
};

export { mapPerson as mapAttioPerson, mapDeal as mapAttioDeal };
