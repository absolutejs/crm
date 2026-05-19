import type {
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
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
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsLeads: true,
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
    async getContact(id) {
      const contact = await request<CloseContact>("GET", `/contact/${id}/`);
      return mapContact(contact);
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
    vendor: VENDOR,
  };
};

export {
  mapContact as mapCloseContact,
  mapOpportunity as mapCloseOpportunity,
};
