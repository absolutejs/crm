import type {
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMEmail,
  CRMLead,
  CRMPhone,
  CRMPipeline,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "pipedrive" as const;

const PIPEDRIVE_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsLeads: true,
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
    async getContact(id) {
      const person = await request<PipedrivePerson>("GET", `/persons/${id}`);
      return mapPersonToContact(person);
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
