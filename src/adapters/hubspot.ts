import type {
  CRMAccount,
  CRMActivity,
  CRMAddress,
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
  CRMStage,
  CRMTask,
} from "../types";

const VENDOR = "hubspot" as const;

const HUBSPOT_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: true,
  supportsBulkUpsert: true,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: false,
  supportsLeads: false,
  supportsListing: true,
  supportsPipelines: true,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

export type HubSpotObjectResponse = {
  id: string;
  properties: Record<string, string | null | undefined>;
  associations?: Record<
    string,
    { results: { id: string; type: string }[] }
  >;
};

export type HubSpotSearchResponse<T = HubSpotObjectResponse> = {
  total: number;
  results: T[];
};

export type HubSpotPageResponse<T = HubSpotObjectResponse> = {
  results: T[];
  paging?: { next?: { after: string; link?: string } };
};

export type HubSpotPipelineStage = {
  id: string;
  label: string;
  displayOrder?: number;
  metadata?: { probability?: string; isClosed?: string };
};

export type HubSpotPipeline = {
  id: string;
  label: string;
  stages: HubSpotPipelineStage[];
};

export type HubSpotBasicApi = {
  create(input: {
    properties: Record<string, string | undefined>;
    associations?: { to: { id: string }; types: { associationCategory: string; associationTypeId: number }[] }[];
  }): Promise<HubSpotObjectResponse>;
  update(
    id: string,
    input: { properties: Record<string, string | undefined> },
  ): Promise<HubSpotObjectResponse>;
  getById(
    id: string,
    properties?: string[],
  ): Promise<HubSpotObjectResponse>;
  getPage(
    limit?: number,
    after?: string,
    properties?: string[],
  ): Promise<HubSpotPageResponse>;
  archive(id: string): Promise<void>;
};

export type HubSpotSearchApi = {
  doSearch(input: {
    filterGroups: {
      filters: {
        propertyName: string;
        operator: string;
        value?: string;
      }[];
    }[];
    properties?: string[];
    limit?: number;
  }): Promise<HubSpotSearchResponse>;
};

export type HubSpotPipelinesApi = {
  getAll(objectType: string): Promise<{ results: HubSpotPipeline[] }>;
  getById(objectType: string, pipelineId: string): Promise<HubSpotPipeline>;
};

export type HubSpotClientLike = {
  crm: {
    contacts: { basicApi: HubSpotBasicApi; searchApi: HubSpotSearchApi };
    deals: { basicApi: HubSpotBasicApi; searchApi: HubSpotSearchApi };
    companies: { basicApi: HubSpotBasicApi; searchApi: HubSpotSearchApi };
    objects: {
      calls: { basicApi: HubSpotBasicApi };
      notes: { basicApi: HubSpotBasicApi };
      tasks: { basicApi: HubSpotBasicApi };
    };
    pipelines: { pipelinesApi: HubSpotPipelinesApi };
  };
  setAccessToken?(token: string): void;
};

export type CreateHubSpotCRMAdapterOptions = CRMAdapterFactoryInput & {
  client?: HubSpotClientLike;
};

const CONTACT_PROPERTY_NAMES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "jobtitle",
  "company",
  "lifecyclestage",
  "hs_object_id",
  "hubspot_owner_id",
];

const DEAL_PROPERTY_NAMES = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "hubspot_owner_id",
];

const COMPANY_PROPERTY_NAMES = [
  "name",
  "domain",
  "industry",
  "numberofemployees",
  "annualrevenue",
  "hubspot_owner_id",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "hs_object_id",
];

const CALL_PROPERTY_NAMES = [
  "hs_timestamp",
  "hs_call_title",
  "hs_call_body",
  "hs_call_duration",
  "hs_call_disposition",
  "hubspot_owner_id",
];

const NOTE_PROPERTY_NAMES = [
  "hs_note_body",
  "hs_timestamp",
  "hubspot_owner_id",
];

const TASK_PROPERTY_NAMES = [
  "hs_task_subject",
  "hs_task_body",
  "hs_task_priority",
  "hs_task_status",
  "hs_timestamp",
  "hubspot_owner_id",
];

const mapContactObject = (obj: HubSpotObjectResponse): CRMContact => {
  const props = obj.properties;
  const emails: CRMEmail[] = props.email
    ? [{ address: String(props.email), primary: true }]
    : [];
  const phones: CRMPhone[] = [];
  if (props.phone) phones.push({ label: "work", number: String(props.phone) });
  if (props.mobilephone)
    phones.push({ label: "mobile", number: String(props.mobilephone) });
  return {
    emails,
    id: obj.id,
    phones,
    vendor: VENDOR,
    ...(props.firstname ? { firstName: String(props.firstname) } : {}),
    ...(props.lastname ? { lastName: String(props.lastname) } : {}),
    ...(props.firstname || props.lastname
      ? {
          fullName: [props.firstname, props.lastname]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
    ...(props.jobtitle ? { jobTitle: String(props.jobtitle) } : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
  };
};

const mapDealObject = (obj: HubSpotObjectResponse): CRMDeal => {
  const props = obj.properties;
  return {
    id: obj.id,
    title: String(props.dealname ?? ""),
    vendor: VENDOR,
    ...(props.amount !== undefined && props.amount !== null
      ? { amount: Number(props.amount) }
      : {}),
    ...(props.dealstage ? { stageId: String(props.dealstage) } : {}),
    ...(props.pipeline ? { pipelineId: String(props.pipeline) } : {}),
    ...(props.closedate
      ? { expectedCloseAt: new Date(String(props.closedate)).getTime() }
      : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
    status: "open",
  };
};

const mapLeadObject = (obj: HubSpotObjectResponse): CRMLead => {
  const props = obj.properties;
  const emails: CRMEmail[] = props.email
    ? [{ address: String(props.email), primary: true }]
    : [];
  const phones: CRMPhone[] = [];
  if (props.phone) phones.push({ label: "work", number: String(props.phone) });
  if (props.mobilephone)
    phones.push({ label: "mobile", number: String(props.mobilephone) });
  return {
    emails,
    id: obj.id,
    phones,
    vendor: VENDOR,
    ...(props.firstname ? { firstName: String(props.firstname) } : {}),
    ...(props.lastname ? { lastName: String(props.lastname) } : {}),
    ...(props.company ? { company: String(props.company) } : {}),
    ...(props.jobtitle ? { jobTitle: String(props.jobtitle) } : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
  };
};

const mapCompanyObject = (obj: HubSpotObjectResponse): CRMAccount => {
  const props = obj.properties;
  const address: CRMAddress = { label: "billing" };
  if (props.address) address.street = String(props.address);
  if (props.city) address.city = String(props.city);
  if (props.state) address.state = String(props.state);
  if (props.zip) address.postalCode = String(props.zip);
  if (props.country) address.country = String(props.country);
  const hasAddress = Boolean(
    props.address || props.city || props.state || props.zip || props.country,
  );
  return {
    id: obj.id,
    name: String(props.name ?? ""),
    vendor: VENDOR,
    ...(props.domain ? { domain: String(props.domain) } : {}),
    ...(props.industry ? { industry: String(props.industry) } : {}),
    ...(props.numberofemployees !== undefined &&
    props.numberofemployees !== null
      ? { employees: Number(props.numberofemployees) }
      : {}),
    ...(props.annualrevenue !== undefined && props.annualrevenue !== null
      ? { annualRevenue: Number(props.annualrevenue) }
      : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
    ...(hasAddress ? { addresses: [address] } : {}),
  };
};

const mapCallObject = (obj: HubSpotObjectResponse): CRMActivity => {
  const props = obj.properties;
  return {
    id: obj.id,
    occurredAt: props.hs_timestamp
      ? new Date(String(props.hs_timestamp)).getTime()
      : 0,
    type: "call",
    vendor: VENDOR,
    ...(props.hs_call_title ? { subject: String(props.hs_call_title) } : {}),
    ...(props.hs_call_body ? { body: String(props.hs_call_body) } : {}),
    ...(props.hs_call_duration !== undefined && props.hs_call_duration !== null
      ? { durationSeconds: Math.round(Number(props.hs_call_duration) / 1000) }
      : {}),
    ...(props.hs_call_disposition
      ? { outcome: String(props.hs_call_disposition) }
      : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
  };
};

const mapNoteObject = (obj: HubSpotObjectResponse): CRMNote => {
  const props = obj.properties;
  return {
    body: String(props.hs_note_body ?? ""),
    id: obj.id,
    vendor: VENDOR,
    ...(props.hs_timestamp
      ? { createdAt: new Date(String(props.hs_timestamp)).getTime() }
      : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
  };
};

const mapTaskObject = (obj: HubSpotObjectResponse): CRMTask => {
  const props = obj.properties;
  const priority: CRMTask["priority"] =
    props.hs_task_priority === "HIGH"
      ? "high"
      : props.hs_task_priority === "LOW"
        ? "low"
        : "normal";
  const status: CRMTask["status"] =
    props.hs_task_status === "COMPLETED" ? "completed" : "pending";
  return {
    id: obj.id,
    priority,
    status,
    subject: String(props.hs_task_subject ?? ""),
    vendor: VENDOR,
    ...(props.hs_task_body ? { description: String(props.hs_task_body) } : {}),
    ...(props.hs_timestamp
      ? { dueAt: new Date(String(props.hs_timestamp)).getTime() }
      : {}),
    ...(props.hubspot_owner_id
      ? { ownerId: String(props.hubspot_owner_id) }
      : {}),
  };
};

const mapPipelineObject = (pipeline: HubSpotPipeline): CRMPipeline => {
  const stages: CRMStage[] = pipeline.stages
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((stage) => ({
      id: stage.id,
      isClosed:
        stage.metadata?.isClosed === "true" ||
        stage.id === "closedwon" ||
        stage.id === "closedlost",
      isWon: stage.id === "closedwon",
      label: stage.label,
      order: stage.displayOrder,
      pipelineId: pipeline.id,
      ...(stage.metadata?.probability
        ? { probability: Number(stage.metadata.probability) }
        : {}),
    }));
  return {
    id: pipeline.id,
    label: pipeline.label,
    stages,
    vendor: VENDOR,
  };
};

const buildClient = async (
  input: CreateHubSpotCRMAdapterOptions,
): Promise<HubSpotClientLike> => {
  if (input.client) return input.client;
  const mod = (await import("@hubspot/api-client")) as unknown as {
    Client: new (options: { accessToken: string }) => HubSpotClientLike;
  };
  return new mod.Client({ accessToken: input.accessToken });
};

export const createHubSpotCRMAdapter = async (
  input: CreateHubSpotCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const client = await buildClient(input);

  const searchContactBy = async (
    propertyName: string,
    operator: string,
    value: string,
  ): Promise<CRMContact | null> => {
    const result = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [
        {
          filters: [{ operator, propertyName, value }],
        },
      ],
      limit: 1,
      properties: CONTACT_PROPERTY_NAMES,
    });
    const row = result.results[0];
    return row ? mapContactObject(row) : null;
  };

  return {
    async addNote(noteInput) {
      const obj = await client.crm.objects.notes.basicApi.create({
        associations: noteInput.contactIds?.[0]
          ? [
              {
                to: { id: noteInput.contactIds[0] },
                types: [
                  { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 },
                ],
              },
            ]
          : undefined,
        properties: {
          hs_note_body: noteInput.body,
          hs_timestamp: String(Date.now()),
          ...(noteInput.ownerId
            ? { hubspot_owner_id: noteInput.ownerId }
            : {}),
        },
      });
      return {
        body: noteInput.body,
        id: obj.id,
        vendor: VENDOR,
        ...(noteInput.contactIds !== undefined
          ? { contactIds: noteInput.contactIds }
          : {}),
        ...(noteInput.dealId !== undefined ? { dealId: noteInput.dealId } : {}),
        ...(noteInput.accountId !== undefined
          ? { accountId: noteInput.accountId }
          : {}),
        ...(noteInput.ownerId !== undefined ? { ownerId: noteInput.ownerId } : {}),
      } satisfies CRMNote;
    },
    capabilities: HUBSPOT_CAPABILITIES,
    async createAccount(accountInput) {
      const properties: Record<string, string | undefined> = {
        name: accountInput.name,
      };
      if (accountInput.domain) properties.domain = accountInput.domain;
      if (accountInput.industry) properties.industry = accountInput.industry;
      if (accountInput.employees !== undefined)
        properties.numberofemployees = String(accountInput.employees);
      if (accountInput.annualRevenue !== undefined)
        properties.annualrevenue = String(accountInput.annualRevenue);
      if (accountInput.ownerId)
        properties.hubspot_owner_id = accountInput.ownerId;
      const addr = accountInput.addresses?.[0];
      if (addr) {
        if (addr.street) properties.address = addr.street;
        if (addr.city) properties.city = addr.city;
        if (addr.state) properties.state = addr.state;
        if (addr.postalCode) properties.zip = addr.postalCode;
        if (addr.country) properties.country = addr.country;
      }
      const obj = await client.crm.companies.basicApi.create({ properties });
      return { ...accountInput, id: obj.id, vendor: VENDOR };
    },
    async createContact(contactInput) {
      const properties: Record<string, string | undefined> = {};
      if (contactInput.firstName) properties.firstname = contactInput.firstName;
      if (contactInput.lastName) properties.lastname = contactInput.lastName;
      if (contactInput.emails[0]?.address)
        properties.email = contactInput.emails[0].address;
      const workPhone = contactInput.phones.find((p) => p.label !== "mobile");
      const mobile = contactInput.phones.find((p) => p.label === "mobile");
      if (workPhone) properties.phone = workPhone.number;
      if (mobile) properties.mobilephone = mobile.number;
      if (contactInput.jobTitle) properties.jobtitle = contactInput.jobTitle;
      if (contactInput.ownerId)
        properties.hubspot_owner_id = contactInput.ownerId;
      const obj = await client.crm.contacts.basicApi.create({ properties });
      return { ...contactInput, id: obj.id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const properties: Record<string, string | undefined> = {
        dealname: dealInput.title,
      };
      if (dealInput.amount !== undefined)
        properties.amount = String(dealInput.amount);
      if (dealInput.stageId) properties.dealstage = dealInput.stageId;
      if (dealInput.pipelineId) properties.pipeline = dealInput.pipelineId;
      if (dealInput.expectedCloseAt) {
        properties.closedate = new Date(dealInput.expectedCloseAt).toISOString();
      }
      if (dealInput.ownerId) properties.hubspot_owner_id = dealInput.ownerId;
      const obj = await client.crm.deals.basicApi.create({
        associations: dealInput.contactIds?.[0]
          ? [
              {
                to: { id: dealInput.contactIds[0] },
                types: [
                  { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 },
                ],
              },
            ]
          : undefined,
        properties,
      });
      return { ...dealInput, id: obj.id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const properties: Record<string, string | undefined> = {
        lifecyclestage: "lead",
      };
      if (leadInput.firstName) properties.firstname = leadInput.firstName;
      if (leadInput.lastName) properties.lastname = leadInput.lastName;
      if (leadInput.emails[0]?.address)
        properties.email = leadInput.emails[0].address;
      if (leadInput.phones[0]?.number)
        properties.phone = leadInput.phones[0].number;
      if (leadInput.company) properties.company = leadInput.company;
      if (leadInput.jobTitle) properties.jobtitle = leadInput.jobTitle;
      if (leadInput.source) properties.hs_lead_status = leadInput.source;
      if (leadInput.ownerId) properties.hubspot_owner_id = leadInput.ownerId;
      const obj = await client.crm.contacts.basicApi.create({ properties });
      return { ...leadInput, id: obj.id, vendor: VENDOR } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const obj = await client.crm.objects.tasks.basicApi.create({
        associations: taskInput.contactIds?.[0]
          ? [
              {
                to: { id: taskInput.contactIds[0] },
                types: [
                  { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 },
                ],
              },
            ]
          : undefined,
        properties: {
          hs_task_priority:
            taskInput.priority === "high"
              ? "HIGH"
              : taskInput.priority === "low"
                ? "LOW"
                : "MEDIUM",
          hs_task_status:
            taskInput.status === "completed" ? "COMPLETED" : "NOT_STARTED",
          hs_task_subject: taskInput.subject,
          hs_timestamp: String(taskInput.dueAt ?? Date.now()),
          ...(taskInput.description
            ? { hs_task_body: taskInput.description }
            : {}),
          ...(taskInput.ownerId
            ? { hubspot_owner_id: taskInput.ownerId }
            : {}),
        },
      });
      return { ...taskInput, id: obj.id, vendor: VENDOR } satisfies CRMTask;
    },
    async deleteAccount(id) {
      await client.crm.companies.basicApi.archive(id);
    },
    async deleteContact(id) {
      await client.crm.contacts.basicApi.archive(id);
    },
    async deleteDeal(id) {
      await client.crm.deals.basicApi.archive(id);
    },
    async deleteLead(id) {
      await client.crm.contacts.basicApi.archive(id);
    },
    async deleteNote(id) {
      await client.crm.objects.notes.basicApi.archive(id);
    },
    async deleteTask(id) {
      await client.crm.objects.tasks.basicApi.archive(id);
    },
    async getAccount(id) {
      const obj = await client.crm.companies.basicApi.getById(
        id,
        COMPANY_PROPERTY_NAMES,
      );
      return mapCompanyObject(obj);
    },
    async getActivity(id) {
      const obj = await client.crm.objects.calls.basicApi.getById(
        id,
        CALL_PROPERTY_NAMES,
      );
      return mapCallObject(obj);
    },
    async getContact(id) {
      const obj = await client.crm.contacts.basicApi.getById(
        id,
        CONTACT_PROPERTY_NAMES,
      );
      return mapContactObject(obj);
    },
    async getDeal(id) {
      const obj = await client.crm.deals.basicApi.getById(
        id,
        DEAL_PROPERTY_NAMES,
      );
      return mapDealObject(obj);
    },
    async getLead(id) {
      const obj = await client.crm.contacts.basicApi.getById(
        id,
        CONTACT_PROPERTY_NAMES,
      );
      return mapLeadObject(obj);
    },
    async getNote(id) {
      const obj = await client.crm.objects.notes.basicApi.getById(
        id,
        NOTE_PROPERTY_NAMES,
      );
      return mapNoteObject(obj);
    },
    async getPipeline(id) {
      const pipeline = await client.crm.pipelines.pipelinesApi.getById(
        "deals",
        id,
      );
      return mapPipelineObject(pipeline);
    },
    async getTask(id) {
      const obj = await client.crm.objects.tasks.basicApi.getById(
        id,
        TASK_PROPERTY_NAMES,
      );
      return mapTaskObject(obj);
    },
    async listAccounts(opts) {
      const page = await client.crm.companies.basicApi.getPage(
        opts?.limit ?? 100,
        opts?.cursor,
        COMPANY_PROPERTY_NAMES,
      );
      return {
        items: page.results.map(mapCompanyObject),
        ...(page.paging?.next?.after
          ? { nextCursor: page.paging.next.after }
          : {}),
      };
    },
    async listContacts(opts) {
      const page = await client.crm.contacts.basicApi.getPage(
        opts?.limit ?? 100,
        opts?.cursor,
        CONTACT_PROPERTY_NAMES,
      );
      return {
        items: page.results.map(mapContactObject),
        ...(page.paging?.next?.after
          ? { nextCursor: page.paging.next.after }
          : {}),
      };
    },
    async listDeals(opts) {
      const page = await client.crm.deals.basicApi.getPage(
        opts?.limit ?? 100,
        opts?.cursor,
        DEAL_PROPERTY_NAMES,
      );
      return {
        items: page.results.map(mapDealObject),
        ...(page.paging?.next?.after
          ? { nextCursor: page.paging.next.after }
          : {}),
      };
    },
    async listLeads(opts) {
      const page = await client.crm.contacts.basicApi.getPage(
        opts?.limit ?? 100,
        opts?.cursor,
        CONTACT_PROPERTY_NAMES,
      );
      return {
        items: page.results
          .filter((row) => row.properties.lifecyclestage === "lead")
          .map(mapLeadObject),
        ...(page.paging?.next?.after
          ? { nextCursor: page.paging.next.after }
          : {}),
      };
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      const result = await client.crm.pipelines.pipelinesApi.getAll("deals");
      return result.results.map(mapPipelineObject);
    },
    async logActivity(activityInput) {
      const properties: Record<string, string | undefined> = {
        hs_timestamp: String(activityInput.occurredAt),
      };
      if (activityInput.subject) properties.hs_call_title = activityInput.subject;
      if (activityInput.body) properties.hs_call_body = activityInput.body;
      if (activityInput.durationSeconds !== undefined) {
        properties.hs_call_duration = String(
          activityInput.durationSeconds * 1000,
        );
      }
      if (activityInput.outcome) properties.hs_call_disposition = activityInput.outcome;
      if (activityInput.ownerId)
        properties.hubspot_owner_id = activityInput.ownerId;
      const obj = await client.crm.objects.calls.basicApi.create({
        associations: activityInput.contactIds?.[0]
          ? [
              {
                to: { id: activityInput.contactIds[0] },
                types: [
                  { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 194 },
                ],
              },
            ]
          : undefined,
        properties,
      });
      return {
        ...activityInput,
        id: obj.id,
        vendor: VENDOR,
      } satisfies CRMActivity;
    },
    async lookupContactByEmail(email) {
      return searchContactBy("email", "EQ", email);
    },
    async lookupContactByPhone(phone) {
      return (
        (await searchContactBy("phone", "CONTAINS_TOKEN", phone)) ??
        (await searchContactBy("mobilephone", "CONTAINS_TOKEN", phone))
      );
    },
    async searchContacts(query, limit = 10) {
      const result = await client.crm.contacts.searchApi.doSearch({
        filterGroups: [
          { filters: [{ operator: "CONTAINS_TOKEN", propertyName: "email", value: query }] },
          { filters: [{ operator: "CONTAINS_TOKEN", propertyName: "firstname", value: query }] },
          { filters: [{ operator: "CONTAINS_TOKEN", propertyName: "lastname", value: query }] },
        ],
        limit,
        properties: CONTACT_PROPERTY_NAMES,
      });
      return result.results.map(mapContactObject);
    },
    async updateAccount(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.name !== undefined) properties.name = patch.name;
      if (patch.domain !== undefined) properties.domain = patch.domain;
      if (patch.industry !== undefined) properties.industry = patch.industry;
      if (patch.employees !== undefined)
        properties.numberofemployees = String(patch.employees);
      if (patch.annualRevenue !== undefined)
        properties.annualrevenue = String(patch.annualRevenue);
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const addr = patch.addresses?.[0];
      if (addr) {
        if (addr.street !== undefined) properties.address = addr.street;
        if (addr.city !== undefined) properties.city = addr.city;
        if (addr.state !== undefined) properties.state = addr.state;
        if (addr.postalCode !== undefined) properties.zip = addr.postalCode;
        if (addr.country !== undefined) properties.country = addr.country;
      }
      const obj = await client.crm.companies.basicApi.update(id, { properties });
      return mapCompanyObject(obj);
    },
    async updateActivity(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.subject !== undefined) properties.hs_call_title = patch.subject;
      if (patch.body !== undefined) properties.hs_call_body = patch.body;
      if (patch.durationSeconds !== undefined)
        properties.hs_call_duration = String(patch.durationSeconds * 1000);
      if (patch.outcome !== undefined)
        properties.hs_call_disposition = patch.outcome;
      if (patch.occurredAt !== undefined)
        properties.hs_timestamp = String(patch.occurredAt);
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const obj = await client.crm.objects.calls.basicApi.update(id, {
        properties,
      });
      return mapCallObject(obj);
    },
    async updateContact(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.firstName !== undefined) properties.firstname = patch.firstName;
      if (patch.lastName !== undefined) properties.lastname = patch.lastName;
      if (patch.jobTitle !== undefined) properties.jobtitle = patch.jobTitle;
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      if (patch.emails && patch.emails[0])
        properties.email = patch.emails[0].address;
      if (patch.phones) {
        const work = patch.phones.find((p) => p.label !== "mobile");
        const mob = patch.phones.find((p) => p.label === "mobile");
        if (work) properties.phone = work.number;
        if (mob) properties.mobilephone = mob.number;
      }
      const obj = await client.crm.contacts.basicApi.update(id, { properties });
      return mapContactObject(obj);
    },
    async updateDeal(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.title !== undefined) properties.dealname = patch.title;
      if (patch.amount !== undefined) properties.amount = String(patch.amount);
      if (patch.stageId !== undefined) properties.dealstage = patch.stageId;
      if (patch.pipelineId !== undefined) properties.pipeline = patch.pipelineId;
      if (patch.expectedCloseAt !== undefined) {
        properties.closedate = new Date(patch.expectedCloseAt).toISOString();
      }
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const obj = await client.crm.deals.basicApi.update(id, { properties });
      return mapDealObject(obj);
    },
    async updateLead(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.firstName !== undefined) properties.firstname = patch.firstName;
      if (patch.lastName !== undefined) properties.lastname = patch.lastName;
      if (patch.emails && patch.emails[0])
        properties.email = patch.emails[0].address;
      if (patch.phones && patch.phones[0])
        properties.phone = patch.phones[0].number;
      if (patch.company !== undefined) properties.company = patch.company;
      if (patch.jobTitle !== undefined) properties.jobtitle = patch.jobTitle;
      if (patch.source !== undefined) properties.hs_lead_status = patch.source;
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const obj = await client.crm.contacts.basicApi.update(id, { properties });
      return mapLeadObject(obj);
    },
    async updateNote(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.body !== undefined) properties.hs_note_body = patch.body;
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const obj = await client.crm.objects.notes.basicApi.update(id, {
        properties,
      });
      return mapNoteObject(obj);
    },
    async updateTask(id, patch) {
      const properties: Record<string, string | undefined> = {};
      if (patch.subject !== undefined)
        properties.hs_task_subject = patch.subject;
      if (patch.description !== undefined)
        properties.hs_task_body = patch.description;
      if (patch.priority !== undefined)
        properties.hs_task_priority =
          patch.priority === "high"
            ? "HIGH"
            : patch.priority === "low"
              ? "LOW"
              : "MEDIUM";
      if (patch.status !== undefined)
        properties.hs_task_status =
          patch.status === "completed" ? "COMPLETED" : "NOT_STARTED";
      if (patch.dueAt !== undefined)
        properties.hs_timestamp = String(patch.dueAt);
      if (patch.ownerId !== undefined)
        properties.hubspot_owner_id = patch.ownerId;
      const obj = await client.crm.objects.tasks.basicApi.update(id, {
        properties,
      });
      return mapTaskObject(obj);
    },
    vendor: VENDOR,
  };
};

export {
  mapContactObject as mapHubSpotContactObject,
  mapDealObject as mapHubSpotDealObject,
  CONTACT_PROPERTY_NAMES as HUBSPOT_CONTACT_PROPERTY_NAMES,
  DEAL_PROPERTY_NAMES as HUBSPOT_DEAL_PROPERTY_NAMES,
};
