import type {
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMPipeline,
  CRMStage,
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
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsLeads: false,
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
      const result = await request<{
        pipelines: {
          id: string;
          name: string;
          stages: { id: string; name: string; position?: number }[];
        }[];
      }>(
        "GET",
        `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
      );
      return result.pipelines.map((p) => {
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
      });
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
    vendor: VENDOR,
  };
};

export {
  mapContact as mapGoHighLevelContact,
  mapOpportunity as mapGoHighLevelOpportunity,
};
