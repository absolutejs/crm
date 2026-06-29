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
  CRMListOptions,
  CRMListResult,
  CRMNote,
  CRMPhone,
  CRMPipeline,
  CRMTask,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "pipedrive" as const;

const PIPEDRIVE_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: true,
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: true,
  supportsLeads: true,
  supportsListing: true,
  supportsPipelines: true,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

type PipedrivePerson = {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: { value: string; primary: boolean }[];
  phone?: { value: string; label: string; primary: boolean }[];
  job_title?: string;
  org_id?: { value: number } | number;
  owner_id?: { id: number; name?: string } | number;
};

type PipedriveDeal = {
  id: number;
  title: string;
  value?: number;
  currency?: string;
  stage_id?: number;
  pipeline_id?: number;
  status?: "open" | "won" | "lost" | "deleted";
  close_time?: string;
  expected_close_date?: string;
  org_id?: { value: number } | number;
  person_id?: { value: number } | number;
};

type PipedriveLead = {
  id: string;
  title?: string;
  owner_id?: number;
  person_id?: number | null;
  organization_id?: number | null;
  value?: { amount: number; currency: string } | null;
  source_name?: string;
  is_archived?: boolean;
  add_time?: string;
  update_time?: string;
};

type PipedriveOrganization = {
  id: number;
  name: string;
  address?: string | null;
  owner_id?: { id: number; name?: string } | number;
  add_time?: string;
  update_time?: string;
};

type PipedriveActivity = {
  id: number;
  subject?: string;
  type?: string;
  note?: string;
  done?: boolean;
  due_date?: string;
  due_time?: string;
  duration?: string;
  add_time?: string;
  person_id?: number;
  deal_id?: number;
  org_id?: number;
  owner_id?: number;
  user_id?: number;
};

type PipedriveNote = {
  id: number;
  content: string;
  person_id?: number | null;
  deal_id?: number | null;
  org_id?: number | null;
  user_id?: number;
  add_time?: string;
};

type PipedrivePipeline = {
  id: number;
  name: string;
  selected?: boolean;
};

type PipedriveStage = {
  id: number;
  name: string;
  pipeline_id: number;
  order_nr: number;
  deal_probability?: number;
};

export type CreatePipedriveCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
  apiDomain?: string;
};

const baseUrlFor = (input: CreatePipedriveCRMAdapterOptions): string => {
  const domain =
    input.apiDomain ??
    (input as CRMAdapterFactoryInput & { apiDomain?: string }).apiDomain;
  if (!domain) {
    throw new Error(
      "Pipedrive adapter requires apiDomain (returned in OAuth token response as api_domain)",
    );
  }
  return domain.replace(/\/$/u, "");
};

const phonesToPipedrive = (
  phones: CRMPhone[],
): { value: string; label: string; primary: boolean }[] =>
  phones.map((p, i) => ({
    label: p.label ?? "work",
    primary: p.primary ?? i === 0,
    value: p.number,
  }));

const emailsToPipedrive = (
  emails: CRMEmail[],
): { value: string; primary: boolean }[] =>
  emails.map((e, i) => ({ primary: e.primary ?? i === 0, value: e.address }));

const mapPersonToContact = (person: PipedrivePerson): CRMContact => {
  const orgId =
    typeof person.org_id === "object"
      ? String(person.org_id.value)
      : person.org_id !== undefined
        ? String(person.org_id)
        : undefined;
  const ownerId =
    typeof person.owner_id === "object"
      ? String(person.owner_id.id)
      : person.owner_id !== undefined
        ? String(person.owner_id)
        : undefined;
  return {
    emails:
      person.email?.map((e) => ({ address: e.value, primary: e.primary })) ?? [],
    id: String(person.id),
    phones:
      person.phone?.map((p) => ({
        label:
          (p.label as CRMPhone["label"]) === "mobile"
            ? "mobile"
            : (p.label as CRMPhone["label"]) === "home"
              ? "home"
              : "work",
        number: p.value,
        primary: p.primary,
      })) ?? [],
    vendor: VENDOR,
    ...(person.first_name ? { firstName: person.first_name } : {}),
    ...(person.last_name ? { lastName: person.last_name } : {}),
    ...(person.name ? { fullName: person.name } : {}),
    ...(person.job_title ? { jobTitle: person.job_title } : {}),
    ...(orgId ? { accountId: orgId } : {}),
    ...(ownerId ? { ownerId } : {}),
  };
};

const mapDealToCRM = (deal: PipedriveDeal): CRMDeal => {
  const orgId =
    typeof deal.org_id === "object"
      ? String(deal.org_id.value)
      : deal.org_id !== undefined
        ? String(deal.org_id)
        : undefined;
  return {
    id: String(deal.id),
    title: deal.title,
    vendor: VENDOR,
    ...(deal.value !== undefined ? { amount: deal.value } : {}),
    ...(deal.currency !== undefined ? { currency: deal.currency } : {}),
    ...(deal.pipeline_id !== undefined
      ? { pipelineId: String(deal.pipeline_id) }
      : {}),
    ...(deal.stage_id !== undefined ? { stageId: String(deal.stage_id) } : {}),
    ...(orgId ? { accountId: orgId } : {}),
    ...(deal.expected_close_date
      ? { expectedCloseAt: new Date(deal.expected_close_date).getTime() }
      : {}),
    status:
      deal.status === "won"
        ? "won"
        : deal.status === "lost"
          ? "lost"
          : "open",
  };
};

const numericOwnerId = (
  owner: { id: number } | number | undefined,
): string | undefined => {
  if (typeof owner === "object") return String(owner.id);
  if (owner !== undefined) return String(owner);
  return undefined;
};

const mapLeadToCRM = (lead: PipedriveLead): CRMLead => ({
  emails: [],
  id: String(lead.id),
  phones: [],
  vendor: VENDOR,
  ...(lead.value
    ? { currency: lead.value.currency, estimatedValue: lead.value.amount }
    : {}),
  ...(lead.owner_id !== undefined ? { ownerId: String(lead.owner_id) } : {}),
  ...(lead.source_name ? { source: lead.source_name } : {}),
  ...(lead.add_time
    ? { createdAt: new Date(lead.add_time).getTime() }
    : {}),
  ...(lead.update_time
    ? { updatedAt: new Date(lead.update_time).getTime() }
    : {}),
});

const mapOrgToAccount = (org: PipedriveOrganization): CRMAccount => {
  const ownerId = numericOwnerId(org.owner_id);
  return {
    id: String(org.id),
    name: org.name,
    vendor: VENDOR,
    ...(ownerId ? { ownerId } : {}),
    ...(org.address ? { addresses: [{ street: org.address }] } : {}),
    ...(org.add_time ? { createdAt: new Date(org.add_time).getTime() } : {}),
    ...(org.update_time
      ? { updatedAt: new Date(org.update_time).getTime() }
      : {}),
  };
};

const mapActivityType = (type: string | undefined): CRMActivity["type"] => {
  if (type === "call") return "call";
  if (type === "email") return "email";
  if (type === "meeting") return "meeting";
  if (type === "task") return "task";
  return "other";
};

const activityOccurredAt = (activity: PipedriveActivity): number => {
  if (activity.due_date) {
    return new Date(
      `${activity.due_date}T${activity.due_time || "00:00:00"}`,
    ).getTime();
  }
  if (activity.add_time) return new Date(activity.add_time).getTime();
  return Date.now();
};

const mapActivityToCRM = (activity: PipedriveActivity): CRMActivity => {
  const ownerId = activity.owner_id ?? activity.user_id;
  return {
    id: String(activity.id),
    occurredAt: activityOccurredAt(activity),
    type: mapActivityType(activity.type),
    vendor: VENDOR,
    ...(activity.subject ? { subject: activity.subject } : {}),
    ...(activity.note ? { body: activity.note } : {}),
    ...(activity.person_id !== undefined
      ? { contactIds: [String(activity.person_id)] }
      : {}),
    ...(activity.deal_id !== undefined
      ? { dealId: String(activity.deal_id) }
      : {}),
    ...(activity.org_id !== undefined
      ? { accountId: String(activity.org_id) }
      : {}),
    ...(ownerId !== undefined ? { ownerId: String(ownerId) } : {}),
  };
};

const mapActivityToTask = (activity: PipedriveActivity): CRMTask => {
  const ownerId = activity.owner_id ?? activity.user_id;
  return {
    id: String(activity.id),
    subject: activity.subject ?? "",
    vendor: VENDOR,
    status: activity.done ? "completed" : "pending",
    ...(activity.note ? { description: activity.note } : {}),
    ...(activity.person_id !== undefined
      ? { contactIds: [String(activity.person_id)] }
      : {}),
    ...(activity.deal_id !== undefined
      ? { dealId: String(activity.deal_id) }
      : {}),
    ...(activity.org_id !== undefined
      ? { accountId: String(activity.org_id) }
      : {}),
    ...(ownerId !== undefined ? { ownerId: String(ownerId) } : {}),
    ...(activity.due_date ? { dueAt: activityOccurredAt(activity) } : {}),
  };
};

const mapNoteToCRM = (note: PipedriveNote): CRMNote => ({
  body: note.content,
  id: String(note.id),
  vendor: VENDOR,
  ...(note.person_id ? { contactIds: [String(note.person_id)] } : {}),
  ...(note.deal_id ? { dealId: String(note.deal_id) } : {}),
  ...(note.org_id ? { accountId: String(note.org_id) } : {}),
  ...(note.user_id !== undefined ? { ownerId: String(note.user_id) } : {}),
  ...(note.add_time ? { createdAt: new Date(note.add_time).getTime() } : {}),
});

export const createPipedriveCRMAdapter = async (
  input: CreatePipedriveCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const baseUrl = baseUrlFor(input);
  const http = input.httpClient ?? createFetchCRMHttpClient();

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${input.accessToken}`,
  });

  const request = async <T>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await http<{ data: T; success?: boolean }>({
      body,
      headers: authHeaders(),
      method,
      url: `${baseUrl}/api/v1${path}`,
    });
    const payload = assertHttpOk(response, `Pipedrive ${method} ${path}`);
    return payload.data;
  };

  const requestList = async <T>(
    path: string,
    opts?: CRMListOptions,
  ): Promise<CRMListResult<T>> => {
    const limit = Math.min(opts?.limit ?? 100, 500);
    const start = opts?.cursor ? Number(opts.cursor) : 0;
    const sep = path.includes("?") ? "&" : "?";
    const response = await http<{
      data: T[] | null;
      success?: boolean;
      additional_data?: {
        pagination?: {
          more_items_in_collection?: boolean;
          next_start?: number;
        };
      };
    }>({
      headers: authHeaders(),
      method: "GET",
      url: `${baseUrl}/api/v1${path}${sep}limit=${limit}&start=${start}`,
    });
    const payload = assertHttpOk(response, `Pipedrive GET ${path}`);
    const pagination = payload.additional_data?.pagination;
    const nextCursor =
      pagination?.more_items_in_collection &&
      pagination.next_start !== undefined
        ? String(pagination.next_start)
        : undefined;
    return {
      items: payload.data ?? [],
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  };

  const deleteRequest = async (path: string): Promise<void> => {
    const response = await http<{ data?: unknown; success?: boolean }>({
      headers: authHeaders(),
      method: "DELETE",
      url: `${baseUrl}/api/v1${path}`,
    });
    assertHttpOk(response, `Pipedrive DELETE ${path}`);
  };

  const requestV2 = async <T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await http<{ data: T; success?: boolean }>({
      body,
      headers: authHeaders(),
      method,
      url: `${baseUrl}/api/v2${path}`,
    });
    const payload = assertHttpOk(response, `Pipedrive ${method} v2 ${path}`);
    return payload.data;
  };

  return {
    async addNote(noteInput) {
      const note = await request<{ id: number }>("POST", "/notes", {
        content: noteInput.body,
        ...(noteInput.dealId ? { deal_id: Number(noteInput.dealId) } : {}),
        ...(noteInput.contactIds?.[0]
          ? { person_id: Number(noteInput.contactIds[0]) }
          : {}),
        ...(noteInput.accountId ? { org_id: Number(noteInput.accountId) } : {}),
      });
      return {
        body: noteInput.body,
        id: String(note.id),
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
    capabilities: PIPEDRIVE_CAPABILITIES,
    async convertLead(leadId) {
      const lead = await request<PipedriveLead | null>(
        "GET",
        `/leads/${leadId}`,
      );
      if (!lead || lead.person_id === undefined || lead.person_id === null) {
        throw new Error(
          `Pipedrive convertLead requires the lead to have an associated person (lead ${leadId})`,
        );
      }
      const person = await request<PipedrivePerson>(
        "GET",
        `/persons/${lead.person_id}`,
      );
      const contact = mapPersonToContact(person);
      const conversion = await requestV2<{
        deal_id?: number;
        status?: string;
      }>("POST", `/leads/${leadId}/convert/deal`);
      if (conversion.deal_id === undefined) return { contact };
      const deal = await request<PipedriveDeal>(
        "GET",
        `/deals/${conversion.deal_id}`,
      );
      return { contact, deal: mapDealToCRM(deal) };
    },
    async createAccount(accountInput) {
      const org = await request<PipedriveOrganization>(
        "POST",
        "/organizations",
        {
          name: accountInput.name,
          ...(accountInput.ownerId
            ? { owner_id: Number(accountInput.ownerId) }
            : {}),
          ...(accountInput.addresses?.[0]?.street
            ? { address: accountInput.addresses[0].street }
            : {}),
        },
      );
      return { ...accountInput, id: String(org.id), vendor: VENDOR };
    },
    async createContact(contactInput) {
      const person = await request<PipedrivePerson>("POST", "/persons", {
        email: emailsToPipedrive(contactInput.emails),
        name:
          contactInput.fullName ??
          [contactInput.firstName, contactInput.lastName]
            .filter(Boolean)
            .join(" "),
        phone: phonesToPipedrive(contactInput.phones),
        ...(contactInput.firstName
          ? { first_name: contactInput.firstName }
          : {}),
        ...(contactInput.lastName
          ? { last_name: contactInput.lastName }
          : {}),
        ...(contactInput.jobTitle ? { job_title: contactInput.jobTitle } : {}),
        ...(contactInput.ownerId
          ? { owner_id: Number(contactInput.ownerId) }
          : {}),
      });
      return { ...contactInput, id: String(person.id), vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const deal = await request<PipedriveDeal>("POST", "/deals", {
        title: dealInput.title,
        ...(dealInput.amount !== undefined ? { value: dealInput.amount } : {}),
        ...(dealInput.currency !== undefined
          ? { currency: dealInput.currency }
          : {}),
        ...(dealInput.stageId !== undefined
          ? { stage_id: Number(dealInput.stageId) }
          : {}),
        ...(dealInput.pipelineId !== undefined
          ? { pipeline_id: Number(dealInput.pipelineId) }
          : {}),
        ...(dealInput.expectedCloseAt !== undefined
          ? {
              expected_close_date: new Date(dealInput.expectedCloseAt)
                .toISOString()
                .slice(0, 10),
            }
          : {}),
        ...(dealInput.contactIds?.[0]
          ? { person_id: Number(dealInput.contactIds[0]) }
          : {}),
      });
      return { ...dealInput, id: String(deal.id), vendor: VENDOR };
    },
    async createLead(leadInput) {
      const lead = await request<{ id: string }>("POST", "/leads", {
        title:
          [leadInput.firstName, leadInput.lastName].filter(Boolean).join(" ") ||
          leadInput.company ||
          "Voice agent lead",
        ...(leadInput.estimatedValue !== undefined && leadInput.currency
          ? {
              value: {
                amount: leadInput.estimatedValue,
                currency: leadInput.currency,
              },
            }
          : {}),
        ...(leadInput.source ? { source_name: leadInput.source } : {}),
      });
      return { ...leadInput, id: String(lead.id), vendor: VENDOR } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const activity = await request<{ id: number }>("POST", "/activities", {
        subject: taskInput.subject,
        type: "task",
        ...(taskInput.dueAt
          ? {
              due_date: new Date(taskInput.dueAt).toISOString().slice(0, 10),
            }
          : {}),
        ...(taskInput.contactIds?.[0]
          ? { person_id: Number(taskInput.contactIds[0]) }
          : {}),
        ...(taskInput.dealId ? { deal_id: Number(taskInput.dealId) } : {}),
        ...(taskInput.description ? { note: taskInput.description } : {}),
        done: taskInput.status === "completed" ? 1 : 0,
      });
      return { ...taskInput, id: String(activity.id), vendor: VENDOR };
    },
    async deleteAccount(id) {
      await deleteRequest(`/organizations/${id}`);
    },
    async deleteContact(id) {
      await deleteRequest(`/persons/${id}`);
    },
    async deleteDeal(id) {
      await deleteRequest(`/deals/${id}`);
    },
    async deleteLead(id) {
      await deleteRequest(`/leads/${id}`);
    },
    async deleteNote(id) {
      await deleteRequest(`/notes/${id}`);
    },
    async deleteTask(id) {
      await deleteRequest(`/activities/${id}`);
    },
    async getAccount(id) {
      const org = await request<PipedriveOrganization | null>(
        "GET",
        `/organizations/${id}`,
      );
      return org ? mapOrgToAccount(org) : null;
    },
    async getActivity(id) {
      const activity = await request<PipedriveActivity | null>(
        "GET",
        `/activities/${id}`,
      );
      return activity ? mapActivityToCRM(activity) : null;
    },
    async getContact(id) {
      const person = await request<PipedrivePerson>("GET", `/persons/${id}`);
      return mapPersonToContact(person);
    },
    async getDeal(id) {
      const deal = await request<PipedriveDeal | null>("GET", `/deals/${id}`);
      return deal ? mapDealToCRM(deal) : null;
    },
    async getLead(id) {
      const lead = await request<PipedriveLead | null>("GET", `/leads/${id}`);
      return lead ? mapLeadToCRM(lead) : null;
    },
    async getNote(id) {
      const note = await request<PipedriveNote | null>("GET", `/notes/${id}`);
      return note ? mapNoteToCRM(note) : null;
    },
    async getPipeline(id) {
      const pipeline = await request<PipedrivePipeline | null>(
        "GET",
        `/pipelines/${id}`,
      );
      if (!pipeline) return null;
      const stages = await request<PipedriveStage[]>(
        "GET",
        `/stages?pipeline_id=${id}`,
      );
      return {
        id: String(pipeline.id),
        isDefault: pipeline.selected ?? false,
        label: pipeline.name,
        stages: stages
          .filter((s) => s.pipeline_id === pipeline.id)
          .sort((a, b) => a.order_nr - b.order_nr)
          .map((s) => ({
            id: String(s.id),
            label: s.name,
            order: s.order_nr,
            pipelineId: String(pipeline.id),
            ...(s.deal_probability !== undefined
              ? { probability: s.deal_probability / 100 }
              : {}),
          })),
        vendor: VENDOR,
      };
    },
    async getTask(id) {
      const activity = await request<PipedriveActivity | null>(
        "GET",
        `/activities/${id}`,
      );
      return activity ? mapActivityToTask(activity) : null;
    },
    async listAccounts(opts) {
      const result = await requestList<PipedriveOrganization>(
        "/organizations",
        opts,
      );
      return {
        items: result.items.map(mapOrgToAccount),
        ...(result.nextCursor !== undefined
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    },
    async listContacts(opts) {
      const result = await requestList<PipedrivePerson>("/persons", opts);
      return {
        items: result.items.map(mapPersonToContact),
        ...(result.nextCursor !== undefined
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    },
    async listDeals(opts) {
      const result = await requestList<PipedriveDeal>("/deals", opts);
      return {
        items: result.items.map(mapDealToCRM),
        ...(result.nextCursor !== undefined
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    },
    async listLeads(opts) {
      const result = await requestList<PipedriveLead>("/leads", opts);
      return {
        items: result.items.map(mapLeadToCRM),
        ...(result.nextCursor !== undefined
          ? { nextCursor: result.nextCursor }
          : {}),
      };
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      const pipelines = await request<
        { id: number; name: string; active?: boolean; selected?: boolean }[]
      >("GET", "/pipelines");
      const stages = await request<
        {
          id: number;
          name: string;
          pipeline_id: number;
          order_nr: number;
          deal_probability?: number;
        }[]
      >("GET", "/stages");
      return pipelines.map((p) => ({
        id: String(p.id),
        isDefault: p.selected ?? false,
        label: p.name,
        stages: stages
          .filter((s) => s.pipeline_id === p.id)
          .sort((a, b) => a.order_nr - b.order_nr)
          .map((s) => ({
            id: String(s.id),
            label: s.name,
            order: s.order_nr,
            pipelineId: String(p.id),
            ...(s.deal_probability !== undefined
              ? { probability: s.deal_probability / 100 }
              : {}),
          })),
        vendor: VENDOR,
      }));
    },
    async logActivity(activityInput) {
      const activity = await request<{ id: number }>("POST", "/activities", {
        done: 1,
        subject: activityInput.subject ?? `Voice call`,
        type:
          activityInput.type === "call"
            ? "call"
            : activityInput.type === "email"
              ? "email"
              : activityInput.type === "meeting"
                ? "meeting"
                : "task",
        ...(activityInput.body ? { note: activityInput.body } : {}),
        ...(activityInput.contactIds?.[0]
          ? { person_id: Number(activityInput.contactIds[0]) }
          : {}),
        ...(activityInput.dealId
          ? { deal_id: Number(activityInput.dealId) }
          : {}),
        ...(activityInput.durationSeconds !== undefined
          ? { duration: secondsToHHMMSS(activityInput.durationSeconds) }
          : {}),
        due_date: new Date(activityInput.occurredAt).toISOString().slice(0, 10),
      });
      return {
        ...activityInput,
        id: String(activity.id),
        vendor: VENDOR,
      };
    },
    async lookupContactByEmail(email) {
      const result = await request<{ items?: { item: PipedrivePerson }[] }>(
        "GET",
        `/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=true&limit=1`,
      );
      const first = result.items?.[0]?.item;
      return first ? mapPersonToContact(first) : null;
    },
    async lookupContactByPhone(phone) {
      const digits = phone.replace(/\D/gu, "");
      const result = await request<{ items?: { item: PipedrivePerson }[] }>(
        "GET",
        `/persons/search?term=${encodeURIComponent(digits)}&fields=phone&limit=1`,
      );
      const first = result.items?.[0]?.item;
      return first ? mapPersonToContact(first) : null;
    },
    async searchContacts(query, limit = 10) {
      const result = await request<{ items?: { item: PipedrivePerson }[] }>(
        "GET",
        `/persons/search?term=${encodeURIComponent(query)}&fields=name,email,phone&limit=${Math.min(limit, 500)}`,
      );
      return (result.items ?? []).map((wrapper) =>
        mapPersonToContact(wrapper.item),
      );
    },
    async updateContact(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.firstName !== undefined) body.first_name = patch.firstName;
      if (patch.lastName !== undefined) body.last_name = patch.lastName;
      if (patch.jobTitle !== undefined) body.job_title = patch.jobTitle;
      if (patch.emails) body.email = emailsToPipedrive(patch.emails);
      if (patch.phones) body.phone = phonesToPipedrive(patch.phones);
      if (patch.ownerId !== undefined) body.owner_id = Number(patch.ownerId);
      const person = await request<PipedrivePerson>(
        "PUT",
        `/persons/${id}`,
        body,
      );
      return mapPersonToContact(person);
    },
    async updateDeal(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.amount !== undefined) body.value = patch.amount;
      if (patch.stageId !== undefined) body.stage_id = Number(patch.stageId);
      if (patch.expectedCloseAt !== undefined) {
        body.expected_close_date = new Date(patch.expectedCloseAt)
          .toISOString()
          .slice(0, 10);
      }
      const deal = await request<PipedriveDeal>("PUT", `/deals/${id}`, body);
      return mapDealToCRM(deal);
    },
    async updateAccount(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.ownerId !== undefined) body.owner_id = Number(patch.ownerId);
      if (patch.addresses?.[0]?.street !== undefined) {
        body.address = patch.addresses[0].street;
      }
      const org = await request<PipedriveOrganization>(
        "PUT",
        `/organizations/${id}`,
        body,
      );
      return mapOrgToAccount(org);
    },
    async updateActivity(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.subject !== undefined) body.subject = patch.subject;
      if (patch.body !== undefined) body.note = patch.body;
      if (patch.type !== undefined) body.type = patch.type;
      if (patch.durationSeconds !== undefined) {
        body.duration = secondsToHHMMSS(patch.durationSeconds);
      }
      if (patch.occurredAt !== undefined) {
        body.due_date = new Date(patch.occurredAt).toISOString().slice(0, 10);
      }
      const activity = await request<PipedriveActivity>(
        "PUT",
        `/activities/${id}`,
        body,
      );
      return mapActivityToCRM(activity);
    },
    async updateLead(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.estimatedValue !== undefined && patch.currency !== undefined) {
        body.value = { amount: patch.estimatedValue, currency: patch.currency };
      }
      if (patch.source !== undefined) body.source_name = patch.source;
      if (patch.ownerId !== undefined) body.owner_id = Number(patch.ownerId);
      const lead = await request<PipedriveLead>("PATCH", `/leads/${id}`, body);
      return mapLeadToCRM(lead);
    },
    async updateNote(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.body !== undefined) body.content = patch.body;
      const note = await request<PipedriveNote>("PUT", `/notes/${id}`, body);
      return mapNoteToCRM(note);
    },
    async updateTask(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.subject !== undefined) body.subject = patch.subject;
      if (patch.description !== undefined) body.note = patch.description;
      if (patch.status !== undefined) {
        body.done = patch.status === "completed" ? 1 : 0;
      }
      if (patch.dueAt !== undefined) {
        body.due_date = new Date(patch.dueAt).toISOString().slice(0, 10);
      }
      const activity = await request<PipedriveActivity>(
        "PUT",
        `/activities/${id}`,
        body,
      );
      return mapActivityToTask(activity);
    },
    vendor: VENDOR,
  };
};

const secondsToHHMMSS = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
};

export {
  mapPersonToContact as mapPipedrivePersonToContact,
  mapDealToCRM as mapPipedriveDealToCRM,
};
