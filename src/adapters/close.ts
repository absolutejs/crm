import type {
  CRMActivity,
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMNote,
  CRMPipeline,
  CRMTask,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "close" as const;

const CLOSE_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  // Close exposes DELETE on every resource (contact/lead/opportunity/task/note).
  supportsAccounts: false,
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  // Close has no first-class Account/Company object — the Lead IS the company
  // container — so every `*Account` verb is a typed no-op.
  supportsDelete: true,
  // Leads are the company container, not a pre-contact stage; there is no
  // native lead -> contact/deal conversion, so `convertLead` is omitted.
  supportsLeadConversion: false,
  supportsLeads: true,
  // Offset pagination via `_skip` / `_limit` with a `has_more` flag.
  supportsListing: true,
  supportsPipelines: false,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

type CloseContact = {
  id: string;
  lead_id: string;
  name?: string;
  title?: string;
  emails?: { email: string; type?: string }[];
  phones?: { phone: string; type?: string }[];
};

type CloseLead = {
  id: string;
  display_name?: string;
  name?: string;
  description?: string;
  status_label?: string;
  contacts?: CloseContact[];
};

type CloseOpportunity = {
  id: string;
  lead_id?: string;
  note?: string;
  value?: number;
  value_period?: "one_time" | "monthly" | "annual";
  status_id?: string;
  status_label?: string;
};

type CloseCall = {
  id: string;
  lead_id?: string;
  contact_id?: string;
  direction?: "inbound" | "outbound";
  duration?: number;
  note?: string;
  status?: string;
  date_created?: string;
};

type CloseNote = {
  id: string;
  lead_id?: string;
  contact_id?: string;
  note?: string;
  user_id?: string;
  date_created?: string;
};

type CloseTask = {
  id: string;
  lead_id?: string;
  text?: string;
  date?: string;
  is_complete?: boolean;
  assigned_to?: string;
};

type ClosePipelineStatus = {
  id: string;
  label?: string;
  type?: string;
};

type ClosePipeline = {
  id: string;
  name?: string;
  pipeline_statuses?: ClosePipelineStatus[];
};

export type CreateCloseCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
};

const mapContact = (contact: CloseContact): CRMContact => {
  const [firstName, ...rest] = (contact.name ?? "").split(/\s+/);
  return {
    emails:
      contact.emails?.map((e, i) => ({
        address: e.email,
        primary: i === 0,
      })) ?? [],
    id: contact.id,
    phones:
      contact.phones?.map((p) => ({
        label:
          (p.type as "mobile" | "work" | "home" | undefined) === "mobile"
            ? "mobile"
            : "work",
        number: p.phone,
      })) ?? [],
    vendor: VENDOR,
    ...(firstName ? { firstName } : {}),
    ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
    ...(contact.name ? { fullName: contact.name } : {}),
    ...(contact.title ? { jobTitle: contact.title } : {}),
    ...(contact.lead_id ? { accountId: contact.lead_id } : {}),
  };
};

const mapOpportunity = (opp: CloseOpportunity): CRMDeal => ({
  id: opp.id,
  title: opp.note ?? `Opportunity ${opp.id}`,
  vendor: VENDOR,
  ...(opp.value !== undefined ? { amount: opp.value } : {}),
  ...(opp.status_label ? { stageId: opp.status_label } : {}),
  ...(opp.lead_id ? { accountId: opp.lead_id } : {}),
  status:
    opp.status_label === "Won"
      ? "won"
      : opp.status_label === "Lost"
        ? "lost"
        : "open",
});

const mapLead = (lead: CloseLead): CRMLead => {
  const primary = lead.contacts?.[0];
  const [firstName, ...rest] = (primary?.name ?? "").split(/\s+/);
  const company = lead.display_name ?? lead.name;
  return {
    emails:
      primary?.emails?.map((e, i) => ({
        address: e.email,
        primary: i === 0,
      })) ?? [],
    id: lead.id,
    phones:
      primary?.phones?.map((p) => ({
        label: p.type === "mobile" ? "mobile" : "work",
        number: p.phone,
      })) ?? [],
    vendor: VENDOR,
    ...(firstName ? { firstName } : {}),
    ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
    ...(company ? { company } : {}),
    ...(primary?.title ? { jobTitle: primary.title } : {}),
    ...(lead.description ? { source: lead.description } : {}),
  };
};

const mapCall = (call: CloseCall): CRMActivity => ({
  id: call.id,
  occurredAt: call.date_created
    ? new Date(call.date_created).getTime()
    : Date.now(),
  type: "call",
  vendor: VENDOR,
  ...(call.note ? { body: call.note } : {}),
  ...(call.duration !== undefined ? { durationSeconds: call.duration } : {}),
  ...(call.status ? { outcome: call.status } : {}),
  ...(call.lead_id ? { accountId: call.lead_id } : {}),
  ...(call.contact_id ? { contactIds: [call.contact_id] } : {}),
});

const mapNote = (note: CloseNote): CRMNote => ({
  body: note.note ?? "",
  id: note.id,
  vendor: VENDOR,
  ...(note.lead_id ? { accountId: note.lead_id } : {}),
  ...(note.contact_id ? { contactIds: [note.contact_id] } : {}),
  ...(note.user_id ? { ownerId: note.user_id } : {}),
  ...(note.date_created
    ? { createdAt: new Date(note.date_created).getTime() }
    : {}),
});

const mapTask = (task: CloseTask): CRMTask => ({
  id: task.id,
  subject: task.text ?? "",
  vendor: VENDOR,
  ...(task.lead_id ? { accountId: task.lead_id } : {}),
  ...(task.assigned_to ? { ownerId: task.assigned_to } : {}),
  ...(task.date ? { dueAt: new Date(task.date).getTime() } : {}),
  status: task.is_complete ? "completed" : "pending",
});

const mapPipeline = (pipeline: ClosePipeline): CRMPipeline => ({
  id: pipeline.id,
  label: pipeline.name ?? pipeline.id,
  stages: (pipeline.pipeline_statuses ?? []).map((status, order) => ({
    id: status.id,
    isClosed: status.type === "won" || status.type === "lost",
    isWon: status.type === "won",
    label: status.label ?? status.id,
    order,
    pipelineId: pipeline.id,
  })),
  vendor: VENDOR,
});

export const createCloseCRMAdapter = async (
  input: CreateCloseCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const http = input.httpClient ?? createFetchCRMHttpClient();
  const baseUrl = "https://api.close.com/api/v1";

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${input.accessToken}`,
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
      url: `${baseUrl}${path}`,
    });
    return assertHttpOk(response, `Close ${method} ${path}`);
  };

  const lookupContact = async (
    filter: Record<string, string>,
  ): Promise<CRMContact | null> => {
    const result = await request<{ data: CloseContact[] }>(
      "GET",
      `/contact/?${new URLSearchParams(filter).toString()}&_limit=1`,
    );
    const contact = result.data[0];
    return contact ? mapContact(contact) : null;
  };

  const listPaged = async <T>(
    path: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ items: T[]; nextCursor?: string }> => {
    const limit = opts?.limit ?? 100;
    const parsedSkip = opts?.cursor ? Number.parseInt(opts.cursor, 10) : 0;
    const skip = Number.isNaN(parsedSkip) ? 0 : parsedSkip;
    const params = new URLSearchParams({
      _limit: String(limit),
      _skip: String(skip),
    });
    const result = await request<{ data: T[]; has_more?: boolean }>(
      "GET",
      `${path}?${params.toString()}`,
    );
    return {
      items: result.data,
      ...(result.has_more
        ? { nextCursor: String(skip + result.data.length) }
        : {}),
    };
  };

  return {
    async addNote(noteInput) {
      const leadId = noteInput.dealId ?? noteInput.accountId;
      if (!leadId) {
        throw new Error(
          "Close note requires a lead reference (pass via dealId or accountId)",
        );
      }
      const note = await request<{ id: string }>("POST", "/activity/note/", {
        lead_id: leadId,
        note: noteInput.body,
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
    capabilities: CLOSE_CAPABILITIES,
    // Close has no Account/Company entity (supportsAccounts=false) — the Lead IS
    // the company container. Account reads return null / empty and deletes are a
    // void no-op, but writes THROW rather than echo a phantom account.
    async createAccount() {
      throw new Error(
        "Close has no Account/Company entity; createAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async createContact(contactInput) {
      const leadId = contactInput.accountId;
      if (!leadId) {
        throw new Error(
          "Close contacts are scoped to a Lead — pass accountId with the Close lead ID, or use createLead first",
        );
      }
      const contact = await request<CloseContact>("POST", "/contact/", {
        emails: contactInput.emails.map((e) => ({
          email: e.address,
          type: "office",
        })),
        lead_id: leadId,
        name:
          contactInput.fullName ??
          [contactInput.firstName, contactInput.lastName]
            .filter(Boolean)
            .join(" "),
        phones: contactInput.phones.map((p) => ({
          phone: p.number,
          type: p.label === "mobile" ? "mobile" : "office",
        })),
        ...(contactInput.jobTitle ? { title: contactInput.jobTitle } : {}),
      });
      return { ...contactInput, id: contact.id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const leadId = dealInput.accountId;
      if (!leadId) {
        throw new Error("Close opportunities require a lead_id (pass via accountId)");
      }
      const opp = await request<CloseOpportunity>("POST", "/opportunity/", {
        lead_id: leadId,
        note: dealInput.title,
        ...(dealInput.amount !== undefined ? { value: dealInput.amount } : {}),
        ...(dealInput.stageId ? { status_id: dealInput.stageId } : {}),
      });
      return { ...dealInput, id: opp.id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const lead = await request<CloseLead>("POST", "/lead/", {
        contacts: [
          {
            emails: leadInput.emails.map((e) => ({
              email: e.address,
              type: "office",
            })),
            name: [leadInput.firstName, leadInput.lastName]
              .filter(Boolean)
              .join(" "),
            phones: leadInput.phones.map((p) => ({
              phone: p.number,
              type: "office",
            })),
            ...(leadInput.jobTitle ? { title: leadInput.jobTitle } : {}),
          },
        ],
        ...(leadInput.company ? { name: leadInput.company } : {}),
        ...(leadInput.source ? { description: leadInput.source } : {}),
      });
      return { ...leadInput, id: lead.id, vendor: VENDOR } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const task = await request<{ id: string }>("POST", "/task/", {
        text: taskInput.subject,
        ...(taskInput.dueAt
          ? { date: new Date(taskInput.dueAt).toISOString().slice(0, 10) }
          : {}),
        ...(taskInput.accountId ? { lead_id: taskInput.accountId } : {}),
        is_complete: taskInput.status === "completed",
      });
      return { ...taskInput, id: task.id, vendor: VENDOR } satisfies CRMTask;
    },
    async deleteAccount() {
      // No-op: Close has no Account entity (supportsAccounts=false).
    },
    async deleteContact(id) {
      if (!CLOSE_CAPABILITIES.supportsDelete) return;
      await request("DELETE", `/contact/${id}/`);
    },
    async deleteDeal(id) {
      if (!CLOSE_CAPABILITIES.supportsDelete) return;
      await request("DELETE", `/opportunity/${id}/`);
    },
    async deleteLead(id) {
      if (!CLOSE_CAPABILITIES.supportsDelete) return;
      await request("DELETE", `/lead/${id}/`);
    },
    async deleteNote(id) {
      if (!CLOSE_CAPABILITIES.supportsDelete) return;
      await request("DELETE", `/activity/note/${id}/`);
    },
    async deleteTask(id) {
      if (!CLOSE_CAPABILITIES.supportsDelete) return;
      await request("DELETE", `/task/${id}/`);
    },
    async getAccount() {
      // No-op: Close has no Account entity (supportsAccounts=false).
      return null;
    },
    async getActivity(id) {
      // Close activities are typed; logActivity writes a call, so the generic
      // activity read mirrors it via the call sub-resource.
      const call = await request<CloseCall>("GET", `/activity/call/${id}/`);
      return mapCall(call);
    },
    async getContact(id) {
      const contact = await request<CloseContact>("GET", `/contact/${id}/`);
      return mapContact(contact);
    },
    async getDeal(id) {
      const opp = await request<CloseOpportunity>(
        "GET",
        `/opportunity/${id}/`,
      );
      return mapOpportunity(opp);
    },
    async getLead(id) {
      const lead = await request<CloseLead>("GET", `/lead/${id}/`);
      return mapLead(lead);
    },
    async getNote(id) {
      const note = await request<CloseNote>("GET", `/activity/note/${id}/`);
      return mapNote(note);
    },
    async getPipeline(id) {
      const pipeline = await request<ClosePipeline>("GET", `/pipeline/${id}/`);
      return mapPipeline(pipeline);
    },
    async getTask(id) {
      const task = await request<CloseTask>("GET", `/task/${id}/`);
      return mapTask(task);
    },
    async listAccounts() {
      // No-op: Close has no Account entity (supportsAccounts=false).
      return { items: [] };
    },
    async listContacts(opts) {
      const page = await listPaged<CloseContact>("/contact/", opts);
      return {
        items: page.items.map(mapContact),
        ...(page.nextCursor !== undefined
          ? { nextCursor: page.nextCursor }
          : {}),
      };
    },
    async listDeals(opts) {
      const page = await listPaged<CloseOpportunity>("/opportunity/", opts);
      return {
        items: page.items.map(mapOpportunity),
        ...(page.nextCursor !== undefined
          ? { nextCursor: page.nextCursor }
          : {}),
      };
    },
    async listLeads(opts) {
      const page = await listPaged<CloseLead>("/lead/", opts);
      return {
        items: page.items.map(mapLead),
        ...(page.nextCursor !== undefined
          ? { nextCursor: page.nextCursor }
          : {}),
      };
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      const result = await request<{
        data: {
          id: string;
          name: string;
          status_type: string;
          label?: string;
        }[];
      }>("GET", "/status/opportunity/");
      return [
        {
          id: "default",
          isDefault: true,
          label: "Default opportunities pipeline",
          stages: result.data.map((s, order) => ({
            id: s.id,
            isClosed: s.status_type === "won" || s.status_type === "lost",
            isWon: s.status_type === "won",
            label: s.label ?? s.name,
            order,
            pipelineId: "default",
          })),
          vendor: VENDOR,
        },
      ];
    },
    async logActivity(activityInput) {
      const leadId = activityInput.dealId ?? activityInput.accountId;
      if (!leadId) {
        throw new Error(
          "Close call activities require a lead reference (pass dealId or accountId)",
        );
      }
      const call = await request<{ id: string }>("POST", "/activity/call/", {
        date_created: new Date(activityInput.occurredAt).toISOString(),
        direction: "outbound",
        duration: activityInput.durationSeconds ?? 0,
        lead_id: leadId,
        note: activityInput.body ?? activityInput.subject ?? "Voice call",
        ...(activityInput.outcome ? { status: activityInput.outcome } : {}),
      });
      return {
        ...activityInput,
        id: call.id,
        vendor: VENDOR,
      };
    },
    async lookupContactByEmail(email) {
      return lookupContact({ emails__email: email });
    },
    async lookupContactByPhone(phone) {
      const digits = phone.replace(/\D/gu, "");
      return lookupContact({ phones__phone__icontains: digits });
    },
    async searchContacts(query, limit = 10) {
      const result = await request<{ data: CloseContact[] }>(
        "GET",
        `/contact/?query=${encodeURIComponent(query)}&_limit=${limit}`,
      );
      return result.data.map(mapContact);
    },
    async updateAccount() {
      throw new Error(
        "Close has no Account/Company entity; updateAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async updateActivity(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.body !== undefined) body.note = patch.body;
      if (patch.durationSeconds !== undefined) {
        body.duration = patch.durationSeconds;
      }
      if (patch.outcome !== undefined) body.status = patch.outcome;
      const call = await request<CloseCall>(
        "PUT",
        `/activity/call/${id}/`,
        body,
      );
      return mapCall(call);
    },
    async updateContact(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        body.name = [patch.firstName, patch.lastName]
          .filter(Boolean)
          .join(" ");
      }
      if (patch.jobTitle !== undefined) body.title = patch.jobTitle;
      if (patch.emails) {
        body.emails = patch.emails.map((e) => ({
          email: e.address,
          type: "office",
        }));
      }
      if (patch.phones) {
        body.phones = patch.phones.map((p) => ({
          phone: p.number,
          type: p.label === "mobile" ? "mobile" : "office",
        }));
      }
      const contact = await request<CloseContact>(
        "PUT",
        `/contact/${id}/`,
        body,
      );
      return mapContact(contact);
    },
    async updateDeal(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.note = patch.title;
      if (patch.amount !== undefined) body.value = patch.amount;
      if (patch.stageId !== undefined) body.status_id = patch.stageId;
      const opp = await request<CloseOpportunity>(
        "PUT",
        `/opportunity/${id}/`,
        body,
      );
      return mapOpportunity(opp);
    },
    async updateLead(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.company !== undefined) body.name = patch.company;
      if (patch.source !== undefined) body.description = patch.source;
      const lead = await request<CloseLead>("PUT", `/lead/${id}/`, body);
      return mapLead(lead);
    },
    async updateNote(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.body !== undefined) body.note = patch.body;
      const note = await request<CloseNote>(
        "PUT",
        `/activity/note/${id}/`,
        body,
      );
      return mapNote(note);
    },
    async updateTask(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.subject !== undefined) body.text = patch.subject;
      if (patch.dueAt !== undefined) {
        body.date = new Date(patch.dueAt).toISOString().slice(0, 10);
      }
      if (patch.status !== undefined) {
        body.is_complete = patch.status === "completed";
      }
      const task = await request<CloseTask>("PUT", `/task/${id}/`, body);
      return mapTask(task);
    },
    vendor: VENDOR,
  };
};

export {
  mapContact as mapCloseContact,
  mapOpportunity as mapCloseOpportunity,
};
