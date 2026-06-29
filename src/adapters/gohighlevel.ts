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
  CRMStage,
  CRMTask,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "gohighlevel" as const;

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_DEFAULT_API_VERSION = "2021-07-28";

const GHL_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  // GHL exposes DELETE on contacts, opportunities, contact-scoped notes & tasks.
  supportsAccounts: false,
  // GHL has no first-class Account/Company object (company info lives on contacts).
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsDelete: true,
  // No native lead→contact/deal conversion; "leads" are just contacts here.
  supportsLeadConversion: false,
  supportsLeads: false,
  // Paginated GET listing exists for contacts + opportunities (startAfter cursor).
  supportsListing: true,
  supportsPipelines: true,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

type GHLContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
};

type GHLOpportunity = {
  id: string;
  name: string;
  monetaryValue?: number;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  contactId?: string;
};

type GHLNote = {
  id: string;
  body: string;
  contactId?: string;
  dateAdded?: string;
};

type GHLTask = {
  id: string;
  title: string;
  body?: string;
  dueDate?: string;
  completed?: boolean;
  contactId?: string;
  assignedTo?: string;
};

type GHLPipeline = {
  id: string;
  name: string;
  stages: { id: string; name: string; position?: number }[];
};

// Cursor metadata returned by GHL's paginated list endpoints (contacts +
// opportunities). `startAfter` (a ms timestamp) + `startAfterId` together form
// the next-page cursor; `nextPageUrl` is null on the final page.
type GHLListMeta = {
  total?: number;
  nextPageUrl?: string | null;
  startAfter?: number;
  startAfterId?: string;
};

// GHL notes/tasks (and the notes we use to model activities) are CONTACT-scoped:
// their REST paths are /contacts/{contactId}/{notes|tasks}/{id}. The generic
// CRMAdapter get/update/delete verbs only receive a single `id`, so callers
// address a scoped entity with a composite id of the form `contactId:entityId`.
const splitScopedId = (
  id: string,
): { contactId?: string; entityId: string } => {
  const idx = id.indexOf(":");
  if (idx === -1) return { entityId: id };
  return { contactId: id.slice(0, idx), entityId: id.slice(idx + 1) };
};

// Build the opaque `{ items, nextCursor }` cursor from a GHL list `meta` block.
// Returns undefined when there is no further page so the field is omitted.
const buildCursor = (meta?: GHLListMeta): string | undefined => {
  if (
    !meta ||
    !meta.nextPageUrl ||
    meta.startAfter === undefined ||
    !meta.startAfterId
  ) {
    return undefined;
  }
  return `${meta.startAfter}|${meta.startAfterId}`;
};

const parseTimestamp = (value?: string): number | undefined => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : ts;
};

// Agency (company) OAuth credentials. GoHighLevel contacts/opportunities are
// per-LOCATION, so a company-scoped token can't push directly — the adapter mints
// a location-scoped token (POST /oauth/locationToken) lazily and caches it for the
// adapter's lifetime / until expiry, then uses it as the bearer for every call.
export type GoHighLevelAgencyAuth = {
  companyToken: string;
  companyId: string;
  locationId: string;
  // Marketplace app id (the OAuth client_id before the "-"). Carried for parity with
  // listGoHighLevelInstalledLocations; not required to mint a location token.
  appId: string;
};

// Location-mode (back-compat): a location-scoped access token + its locationId.
export type GoHighLevelLocationCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
  apiVersion?: string;
};

// Agency-mode: a company token that gets exchanged for a location token at call time.
export type GoHighLevelAgencyCRMAdapterOptions = {
  agency: GoHighLevelAgencyAuth;
  httpClient?: CRMHttpClient;
  apiVersion?: string;
};

export type CreateGoHighLevelCRMAdapterOptions =
  | GoHighLevelLocationCRMAdapterOptions
  | GoHighLevelAgencyCRMAdapterOptions;

type GHLLocationTokenResponse = {
  access_token: string;
  expires_in?: number;
};

type GHLInstalledLocationsResponse = {
  locations: { _id: string; name: string }[];
};

export type GoHighLevelInstalledLocation = {
  id: string;
  name: string;
};

// List the locations where the marketplace app is installed under an agency token.
// Lets the caller resolve which location an agency-scoped grant should target.
export const listGoHighLevelInstalledLocations = async (input: {
  companyToken: string;
  companyId: string;
  appId: string;
  apiVersion?: string;
  httpClient?: CRMHttpClient;
}): Promise<GoHighLevelInstalledLocation[]> => {
  const http = input.httpClient ?? createFetchCRMHttpClient();
  const apiVersion = input.apiVersion ?? GHL_DEFAULT_API_VERSION;
  const params = new URLSearchParams({
    appId: input.appId,
    companyId: input.companyId,
    isInstalled: "true",
  });
  const response = await http<GHLInstalledLocationsResponse>({
    headers: {
      Authorization: `Bearer ${input.companyToken}`,
      Version: apiVersion,
    },
    method: "GET",
    url: `${GHL_BASE_URL}/oauth/installedLocations?${params.toString()}`,
  });
  const data = assertHttpOk(
    response,
    "GoHighLevel GET /oauth/installedLocations",
  );
  return data.locations.map((location) => ({
    id: location._id,
    name: location.name,
  }));
};

const mapContact = (contact: GHLContact): CRMContact => ({
  emails: contact.email
    ? [{ address: contact.email, primary: true }]
    : [],
  id: contact.id,
  phones: contact.phone ? [{ label: "work", number: contact.phone }] : [],
  vendor: VENDOR,
  ...(contact.firstName ? { firstName: contact.firstName } : {}),
  ...(contact.lastName ? { lastName: contact.lastName } : {}),
  ...(contact.contactName ? { fullName: contact.contactName } : {}),
  ...(contact.tags ? { tags: contact.tags } : {}),
});

const mapOpportunity = (opp: GHLOpportunity): CRMDeal => ({
  id: opp.id,
  title: opp.name,
  vendor: VENDOR,
  ...(opp.monetaryValue !== undefined ? { amount: opp.monetaryValue } : {}),
  ...(opp.pipelineId ? { pipelineId: opp.pipelineId } : {}),
  ...(opp.pipelineStageId ? { stageId: opp.pipelineStageId } : {}),
  ...(opp.contactId ? { contactIds: [opp.contactId] } : {}),
  status:
    opp.status === "won"
      ? "won"
      : opp.status === "lost" || opp.status === "abandoned"
        ? "lost"
        : "open",
});

// GHL has no separate Lead object — createLead already maps to a contact — so
// inbound "leads" are contacts re-projected onto the CRMLead shape.
const mapContactToLead = (contact: GHLContact): CRMLead => ({
  emails: contact.email ? [{ address: contact.email, primary: true }] : [],
  id: contact.id,
  phones: contact.phone ? [{ label: "work", number: contact.phone }] : [],
  vendor: VENDOR,
  ...(contact.firstName ? { firstName: contact.firstName } : {}),
  ...(contact.lastName ? { lastName: contact.lastName } : {}),
  ...(contact.companyName ? { company: contact.companyName } : {}),
});

const mapNote = (note: GHLNote, fallbackContactId?: string): CRMNote => {
  const contactId = note.contactId ?? fallbackContactId;
  const createdAt = parseTimestamp(note.dateAdded);
  return {
    body: note.body,
    id: note.id,
    vendor: VENDOR,
    ...(contactId ? { contactIds: [contactId] } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
};

// Activities are logged as contact notes (see logActivity), so inbound reads
// project a note back onto the CRMActivity shape.
const mapNoteToActivity = (
  note: GHLNote,
  fallbackContactId?: string,
): CRMActivity => {
  const contactId = note.contactId ?? fallbackContactId;
  const occurredAt = parseTimestamp(note.dateAdded);
  return {
    id: note.id,
    occurredAt: occurredAt ?? Date.now(),
    type: "note",
    vendor: VENDOR,
    ...(note.body ? { body: note.body } : {}),
    ...(contactId ? { contactIds: [contactId] } : {}),
  };
};

const mapTask = (task: GHLTask, fallbackContactId?: string): CRMTask => {
  const contactId = task.contactId ?? fallbackContactId;
  const dueAt = parseTimestamp(task.dueDate);
  return {
    id: task.id,
    status: task.completed ? "completed" : "pending",
    subject: task.title,
    vendor: VENDOR,
    ...(task.body ? { description: task.body } : {}),
    ...(contactId ? { contactIds: [contactId] } : {}),
    ...(dueAt !== undefined ? { dueAt } : {}),
    ...(task.assignedTo ? { ownerId: task.assignedTo } : {}),
  };
};

const mapPipeline = (p: GHLPipeline): CRMPipeline => {
  const stages: CRMStage[] = p.stages.map((s) => ({
    id: s.id,
    label: s.name,
    ...(s.position !== undefined ? { order: s.position } : {}),
    pipelineId: p.id,
  }));
  return {
    id: p.id,
    label: p.name,
    stages,
    vendor: VENDOR,
  };
};

export const createGoHighLevelCRMAdapter = async (
  input: CreateGoHighLevelCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const http = input.httpClient ?? createFetchCRMHttpClient();
  const baseUrl = GHL_BASE_URL;
  const apiVersion = input.apiVersion ?? GHL_DEFAULT_API_VERSION;

  // Lazily-minted, cached location token used only in agency mode.
  let cachedLocationToken: { value: string; expiresAtMs: number } | null = null;
  const mintLocationToken = async (
    agency: GoHighLevelAgencyAuth,
  ): Promise<string> => {
    const now = Date.now();
    if (cachedLocationToken && cachedLocationToken.expiresAtMs - now > 60000) {
      return cachedLocationToken.value;
    }
    const response = await http<GHLLocationTokenResponse>({
      body: new URLSearchParams({
        companyId: agency.companyId,
        locationId: agency.locationId,
      }),
      headers: {
        Authorization: `Bearer ${agency.companyToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Version: apiVersion,
      },
      method: "POST",
      url: `${baseUrl}/oauth/locationToken`,
    });
    const data = assertHttpOk(response, "GoHighLevel POST /oauth/locationToken");
    cachedLocationToken = {
      expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
      value: data.access_token,
    };
    return data.access_token;
  };

  // Resolve the locationId + the bearer-token provider once, branching on mode.
  // Agency mode exchanges the company token for a location token at call time;
  // location mode uses the supplied access token directly (back-compat).
  const resolveAuth = (): {
    locationId: string;
    getBearer: () => Promise<string>;
  } => {
    if ("agency" in input) {
      const { agency } = input;
      return {
        getBearer: () => mintLocationToken(agency),
        locationId: agency.locationId,
      };
    }
    const { accessToken, subAccountId } = input;
    if (!subAccountId) {
      throw new Error(
        "GoHighLevel adapter requires subAccountId (locationId from OAuth token response)",
      );
    }
    return {
      getBearer: () => Promise.resolve(accessToken),
      locationId: subAccountId,
    };
  };

  const { getBearer, locationId } = resolveAuth();

  const authHeaders = async (): Promise<Record<string, string>> => ({
    Authorization: `Bearer ${await getBearer()}`,
    "Content-Type": "application/json",
    Version: apiVersion,
  });

  const request = async <T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await http<T>({
      body,
      headers: await authHeaders(),
      method,
      url: `${baseUrl}${path}`,
    });
    return assertHttpOk(response, `GoHighLevel ${method} ${path}`);
  };

  // Append the decoded `startAfter`/`startAfterId` cursor pair (see buildCursor)
  // onto a list request's query params.
  const applyCursor = (params: URLSearchParams, cursor?: string): void => {
    if (!cursor) return;
    const [startAfter, startAfterId] = cursor.split("|");
    if (startAfter) params.set("startAfter", startAfter);
    if (startAfterId) params.set("startAfterId", startAfterId);
  };

  const fetchPipelines = async (): Promise<CRMPipeline[]> => {
    const result = await request<{ pipelines: GHLPipeline[] }>(
      "GET",
      `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    );
    return result.pipelines.map(mapPipeline);
  };

  return {
    async addNote(noteInput) {
      const contactId = noteInput.contactIds?.[0];
      if (!contactId) {
        throw new Error("GoHighLevel notes require contactIds[0]");
      }
      const result = await request<{ note: { id: string } }>(
        "POST",
        `/contacts/${contactId}/notes`,
        { body: noteInput.body },
      );
      return {
        body: noteInput.body,
        id: result.note.id,
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
    capabilities: GHL_CAPABILITIES,
    async createContact(contactInput) {
      const result = await request<{ contact: GHLContact }>(
        "POST",
        "/contacts/",
        {
          locationId,
          ...(contactInput.firstName
            ? { firstName: contactInput.firstName }
            : {}),
          ...(contactInput.lastName ? { lastName: contactInput.lastName } : {}),
          ...(contactInput.emails[0]?.address
            ? { email: contactInput.emails[0]?.address }
            : {}),
          ...(contactInput.phones[0]?.number
            ? { phone: contactInput.phones[0]?.number }
            : {}),
          ...(contactInput.tags ? { tags: contactInput.tags } : {}),
        },
      );
      return { ...contactInput, id: result.contact.id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      if (!dealInput.pipelineId) {
        throw new Error("GoHighLevel opportunities require pipelineId");
      }
      const result = await request<{ opportunity: GHLOpportunity }>(
        "POST",
        "/opportunities/",
        {
          locationId,
          name: dealInput.title,
          pipelineId: dealInput.pipelineId,
          status: "open",
          ...(dealInput.amount !== undefined
            ? { monetaryValue: dealInput.amount }
            : {}),
          ...(dealInput.stageId
            ? { pipelineStageId: dealInput.stageId }
            : {}),
          ...(dealInput.contactIds?.[0]
            ? { contactId: dealInput.contactIds[0] }
            : {}),
        },
      );
      return { ...dealInput, id: result.opportunity.id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const result = await request<{ contact: GHLContact }>(
        "POST",
        "/contacts/",
        {
          locationId,
          ...(leadInput.firstName ? { firstName: leadInput.firstName } : {}),
          ...(leadInput.lastName ? { lastName: leadInput.lastName } : {}),
          ...(leadInput.emails[0]?.address
            ? { email: leadInput.emails[0]?.address }
            : {}),
          ...(leadInput.phones[0]?.number
            ? { phone: leadInput.phones[0]?.number }
            : {}),
        },
      );
      return {
        ...leadInput,
        id: result.contact.id,
        vendor: VENDOR,
      } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const contactId = taskInput.contactIds?.[0];
      if (!contactId) {
        throw new Error("GoHighLevel tasks require contactIds[0]");
      }
      const result = await request<{ task: { id: string } }>(
        "POST",
        `/contacts/${contactId}/tasks`,
        {
          body: taskInput.description ?? "",
          completed: taskInput.status === "completed",
          dueDate: taskInput.dueAt
            ? new Date(taskInput.dueAt).toISOString()
            : new Date().toISOString(),
          title: taskInput.subject,
        },
      );
      return { ...taskInput, id: result.task.id, vendor: VENDOR };
    },
    async getContact(id) {
      const result = await request<{ contact: GHLContact }>(
        "GET",
        `/contacts/${id}`,
      );
      return mapContact(result.contact);
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      return fetchPipelines();
    },
    async logActivity(activityInput) {
      const contactId = activityInput.contactIds?.[0];
      if (!contactId) {
        throw new Error("GoHighLevel call log requires contactIds[0]");
      }
      const result = await request<{ note: { id: string } }>(
        "POST",
        `/contacts/${contactId}/notes`,
        {
          body: `📞 ${activityInput.subject ?? "Voice call"}${activityInput.body ? `\n${activityInput.body}` : ""}${activityInput.durationSeconds ? `\nDuration: ${activityInput.durationSeconds}s` : ""}`,
        },
      );
      return { ...activityInput, id: result.note.id, vendor: VENDOR };
    },
    async lookupContactByEmail(email) {
      const result = await request<{ contacts: GHLContact[] }>(
        "GET",
        `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(email)}&limit=1`,
      );
      const contact = result.contacts[0];
      return contact ? mapContact(contact) : null;
    },
    async lookupContactByPhone(phone) {
      const result = await request<{ contacts: GHLContact[] }>(
        "GET",
        `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(phone)}&limit=1`,
      );
      const contact = result.contacts[0];
      return contact ? mapContact(contact) : null;
    },
    async searchContacts(query, limit = 10) {
      const result = await request<{ contacts: GHLContact[] }>(
        "GET",
        `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=${limit}`,
      );
      return result.contacts.map(mapContact);
    },
    async updateContact(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.firstName !== undefined) body.firstName = patch.firstName;
      if (patch.lastName !== undefined) body.lastName = patch.lastName;
      if (patch.emails?.[0]) body.email = patch.emails[0].address;
      if (patch.phones?.[0]) body.phone = patch.phones[0].number;
      if (patch.tags !== undefined) body.tags = patch.tags;
      const result = await request<{ contact: GHLContact }>(
        "PUT",
        `/contacts/${id}`,
        body,
      );
      return mapContact(result.contact);
    },
    async updateDeal(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.name = patch.title;
      if (patch.amount !== undefined) body.monetaryValue = patch.amount;
      if (patch.stageId !== undefined) body.pipelineStageId = patch.stageId;
      if (patch.pipelineId !== undefined) body.pipelineId = patch.pipelineId;
      const result = await request<{ opportunity: GHLOpportunity }>(
        "PUT",
        `/opportunities/${id}`,
        body,
      );
      return mapOpportunity(result.opportunity);
    },

    // --- Contacts (delete + list) ---
    async deleteContact(id) {
      await request<{ succeded?: boolean }>("DELETE", `/contacts/${id}`);
    },
    async listContacts(opts) {
      const params = new URLSearchParams({
        limit: String(opts?.limit ?? 20),
        locationId,
      });
      applyCursor(params, opts?.cursor);
      const result = await request<{
        contacts: GHLContact[];
        meta?: GHLListMeta;
      }>("GET", `/contacts/?${params.toString()}`);
      const nextCursor = buildCursor(result.meta);
      return {
        items: result.contacts.map(mapContact),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },

    // --- Leads (GHL has no Lead object — leads ARE contacts) ---
    async getLead(id) {
      const result = await request<{ contact: GHLContact }>(
        "GET",
        `/contacts/${id}`,
      );
      return mapContactToLead(result.contact);
    },
    async listLeads(opts) {
      const params = new URLSearchParams({
        limit: String(opts?.limit ?? 20),
        locationId,
      });
      applyCursor(params, opts?.cursor);
      const result = await request<{
        contacts: GHLContact[];
        meta?: GHLListMeta;
      }>("GET", `/contacts/?${params.toString()}`);
      const nextCursor = buildCursor(result.meta);
      return {
        items: result.contacts.map(mapContactToLead),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    async updateLead(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.firstName !== undefined) body.firstName = patch.firstName;
      if (patch.lastName !== undefined) body.lastName = patch.lastName;
      if (patch.emails?.[0]) body.email = patch.emails[0].address;
      if (patch.phones?.[0]) body.phone = patch.phones[0].number;
      if (patch.company !== undefined) body.companyName = patch.company;
      const result = await request<{ contact: GHLContact }>(
        "PUT",
        `/contacts/${id}`,
        body,
      );
      return mapContactToLead(result.contact);
    },
    async deleteLead(id) {
      await request<{ succeded?: boolean }>("DELETE", `/contacts/${id}`);
    },

    // --- Deals (opportunities) ---
    async getDeal(id) {
      const result = await request<{ opportunity: GHLOpportunity }>(
        "GET",
        `/opportunities/${id}`,
      );
      return mapOpportunity(result.opportunity);
    },
    async listDeals(opts) {
      const params = new URLSearchParams({
        limit: String(opts?.limit ?? 20),
        location_id: locationId,
      });
      applyCursor(params, opts?.cursor);
      const result = await request<{
        opportunities: GHLOpportunity[];
        meta?: GHLListMeta;
      }>("GET", `/opportunities/search?${params.toString()}`);
      const nextCursor = buildCursor(result.meta);
      return {
        items: result.opportunities.map(mapOpportunity),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    async deleteDeal(id) {
      await request<{ succeded?: boolean }>("DELETE", `/opportunities/${id}`);
    },

    // --- Accounts (UNSUPPORTED: GHL has no Account/Company entity) ---
    async getAccount() {
      return null;
    },
    async listAccounts() {
      return { items: [] };
    },
    async createAccount() {
      throw new Error(
        "GoHighLevel has no Account/Company entity; createAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async updateAccount() {
      throw new Error(
        "GoHighLevel has no Account/Company entity; updateAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async deleteAccount() {
      // No-op: no Account entity to delete (supportsAccounts=false).
    },

    // --- Activities (modelled as contact-scoped notes) ---
    async getActivity(id) {
      const { contactId, entityId } = splitScopedId(id);
      if (!contactId) {
        throw new Error(
          "GoHighLevel activities are stored as contact notes; getActivity requires a composite id of the form `contactId:noteId`",
        );
      }
      const result = await request<{ note: GHLNote }>(
        "GET",
        `/contacts/${contactId}/notes/${entityId}`,
      );
      return mapNoteToActivity(result.note, contactId);
    },
    async updateActivity(id, patch) {
      const scoped = splitScopedId(id);
      const contactId = patch.contactIds?.[0] ?? scoped.contactId;
      if (!contactId) {
        throw new Error(
          "GoHighLevel activities are stored as contact notes; updateActivity requires patch.contactIds[0] or a composite id `contactId:noteId`",
        );
      }
      const body: Record<string, unknown> = {};
      if (patch.body !== undefined) body.body = patch.body;
      const result = await request<{ note: GHLNote }>(
        "PUT",
        `/contacts/${contactId}/notes/${scoped.entityId}`,
        body,
      );
      return mapNoteToActivity(result.note, contactId);
    },

    // --- Notes (contact-scoped) ---
    async getNote(id) {
      const { contactId, entityId } = splitScopedId(id);
      if (!contactId) {
        throw new Error(
          "GoHighLevel notes are contact-scoped; getNote requires a composite id of the form `contactId:noteId`",
        );
      }
      const result = await request<{ note: GHLNote }>(
        "GET",
        `/contacts/${contactId}/notes/${entityId}`,
      );
      return mapNote(result.note, contactId);
    },
    async updateNote(id, patch) {
      const scoped = splitScopedId(id);
      const contactId = patch.contactIds?.[0] ?? scoped.contactId;
      if (!contactId) {
        throw new Error(
          "GoHighLevel notes are contact-scoped; updateNote requires patch.contactIds[0] or a composite id `contactId:noteId`",
        );
      }
      const body: Record<string, unknown> = {};
      if (patch.body !== undefined) body.body = patch.body;
      const result = await request<{ note: GHLNote }>(
        "PUT",
        `/contacts/${contactId}/notes/${scoped.entityId}`,
        body,
      );
      return mapNote(result.note, contactId);
    },
    async deleteNote(id) {
      const { contactId, entityId } = splitScopedId(id);
      if (!contactId) {
        throw new Error(
          "GoHighLevel notes are contact-scoped; deleteNote requires a composite id of the form `contactId:noteId`",
        );
      }
      await request<{ succeded?: boolean }>(
        "DELETE",
        `/contacts/${contactId}/notes/${entityId}`,
      );
    },

    // --- Tasks (contact-scoped) ---
    async getTask(id) {
      const { contactId, entityId } = splitScopedId(id);
      if (!contactId) {
        throw new Error(
          "GoHighLevel tasks are contact-scoped; getTask requires a composite id of the form `contactId:taskId`",
        );
      }
      const result = await request<{ task: GHLTask }>(
        "GET",
        `/contacts/${contactId}/tasks/${entityId}`,
      );
      return mapTask(result.task, contactId);
    },
    async updateTask(id, patch) {
      const scoped = splitScopedId(id);
      const contactId = patch.contactIds?.[0] ?? scoped.contactId;
      if (!contactId) {
        throw new Error(
          "GoHighLevel tasks are contact-scoped; updateTask requires patch.contactIds[0] or a composite id `contactId:taskId`",
        );
      }
      const body: Record<string, unknown> = {};
      if (patch.subject !== undefined) body.title = patch.subject;
      if (patch.description !== undefined) body.body = patch.description;
      if (patch.dueAt !== undefined) {
        body.dueDate = new Date(patch.dueAt).toISOString();
      }
      if (patch.status !== undefined) {
        body.completed = patch.status === "completed";
      }
      const result = await request<{ task: GHLTask }>(
        "PUT",
        `/contacts/${contactId}/tasks/${scoped.entityId}`,
        body,
      );
      return mapTask(result.task, contactId);
    },
    async deleteTask(id) {
      const { contactId, entityId } = splitScopedId(id);
      if (!contactId) {
        throw new Error(
          "GoHighLevel tasks are contact-scoped; deleteTask requires a composite id of the form `contactId:taskId`",
        );
      }
      await request<{ succeded?: boolean }>(
        "DELETE",
        `/contacts/${contactId}/tasks/${entityId}`,
      );
    },

    // --- Pipelines (single get filtered from list; no single-get endpoint) ---
    async getPipeline(id) {
      const pipelines = await fetchPipelines();
      return pipelines.find((p) => p.id === id) ?? null;
    },

    vendor: VENDOR,
  };
};

export {
  mapContact as mapGoHighLevelContact,
  mapOpportunity as mapGoHighLevelOpportunity,
};
