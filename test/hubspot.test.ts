import { describe, expect, test } from "bun:test";
import {
  createHubSpotCRMAdapter,
  mapHubSpotContactObject,
  mapHubSpotDealObject,
  type HubSpotClientLike,
  type HubSpotObjectResponse,
} from "../src/adapters/hubspot";

type Call = { method: string; surface: string; args: unknown[] };

const makeMockClient = () => {
  const calls: Call[] = [];
  const seeded: Record<
    string,
    HubSpotObjectResponse | HubSpotObjectResponse[] | { error?: string }
  > = {};

  const basicApi = (surface: string) => ({
    async create(input: unknown) {
      calls.push({ args: [input], method: "create", surface });
      const result = seeded[`${surface}.create`];
      if (result && "error" in result && result.error)
        throw new Error(result.error);
      return (
        (result as HubSpotObjectResponse) ?? {
          id: `${surface}_id`,
          properties: {},
        }
      );
    },
    async getById(id: string, properties?: string[]) {
      calls.push({ args: [id, properties], method: "getById", surface });
      const seeded2 = seeded[`${surface}.getById.${id}`];
      return (
        (seeded2 as HubSpotObjectResponse) ?? { id, properties: {} }
      );
    },
    async update(id: string, input: unknown) {
      calls.push({ args: [id, input], method: "update", surface });
      const seeded2 = seeded[`${surface}.update.${id}`];
      return (
        (seeded2 as HubSpotObjectResponse) ?? {
          id,
          properties: (input as { properties: Record<string, string> }).properties,
        }
      );
    },
  });

  const searchApi = (surface: string) => ({
    async doSearch(input: unknown) {
      calls.push({ args: [input], method: "doSearch", surface });
      const seeded2 = seeded[`${surface}.search`];
      const results = (seeded2 as HubSpotObjectResponse[] | undefined) ?? [];
      return { results, total: results.length };
    },
  });

  const client: HubSpotClientLike = {
    crm: {
      companies: {
        basicApi: basicApi("companies"),
        searchApi: searchApi("companies"),
      },
      contacts: {
        basicApi: basicApi("contacts"),
        searchApi: searchApi("contacts"),
      },
      deals: { basicApi: basicApi("deals"), searchApi: searchApi("deals") },
      objects: {
        calls: { basicApi: basicApi("calls") },
        notes: { basicApi: basicApi("notes") },
        tasks: { basicApi: basicApi("tasks") },
      },
      pipelines: {
        pipelinesApi: {
          async getAll(objectType: string) {
            calls.push({
              args: [objectType],
              method: "getAll",
              surface: "pipelines",
            });
            return {
              results: [
                {
                  id: "default",
                  label: "Sales Pipeline",
                  stages: [
                    {
                      displayOrder: 0,
                      id: "appointmentscheduled",
                      label: "Appointment scheduled",
                      metadata: { probability: "0.2" },
                    },
                    {
                      displayOrder: 99,
                      id: "closedwon",
                      label: "Closed Won",
                      metadata: { isClosed: "true", probability: "1.0" },
                    },
                  ],
                },
              ],
            };
          },
        },
      },
    },
  };

  return {
    calls,
    client,
    seed(key: string, value: HubSpotObjectResponse | HubSpotObjectResponse[] | { error?: string }) {
      seeded[key] = value;
    },
  };
};

describe("createHubSpotCRMAdapter", () => {
  test("vendor + capabilities (HubSpot has no Lead object)", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    expect(adapter.vendor).toBe("hubspot");
    expect(adapter.capabilities.supportsLeads).toBe(false);
  });

  test("lookupContactByEmail uses search filter operator EQ", async () => {
    const mock = makeMockClient();
    mock.seed("contacts.search", [
      {
        id: "c_1",
        properties: { email: "alex@example.com", firstname: "Alex" },
      },
    ]);
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("c_1");
    const searchCall = mock.calls.find((c) => c.method === "doSearch");
    const arg = searchCall?.args[0] as {
      filterGroups: { filters: { operator: string }[] }[];
    };
    expect(arg.filterGroups[0]?.filters[0]?.operator).toBe("EQ");
  });

  test("createContact maps to HubSpot properties shape", async () => {
    const mock = makeMockClient();
    mock.seed("contacts.create", { id: "c_99", properties: {} });
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      jobTitle: "CTO",
      lastName: "Kahn",
      phones: [
        { label: "work", number: "+14155550100" },
        { label: "mobile", number: "+14155550200" },
      ],
    });
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.surface === "contacts",
    );
    const input = createCall?.args[0] as {
      properties: Record<string, string>;
    };
    expect(input.properties.firstname).toBe("Alex");
    expect(input.properties.lastname).toBe("Kahn");
    expect(input.properties.email).toBe("alex@example.com");
    expect(input.properties.phone).toBe("+14155550100");
    expect(input.properties.mobilephone).toBe("+14155550200");
    expect(input.properties.jobtitle).toBe("CTO");
  });

  test("createLead routes through Contacts with lifecyclestage=lead", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    await adapter.createLead({
      company: "Acme",
      emails: [{ address: "a@b.com" }],
      firstName: "Alex",
      phones: [],
    });
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.surface === "contacts",
    );
    const input = createCall?.args[0] as {
      properties: Record<string, string>;
    };
    expect(input.properties.lifecyclestage).toBe("lead");
    expect(input.properties.company).toBe("Acme");
  });

  test("createDeal maps title/amount/closedate to HubSpot deal properties", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    await adapter.createDeal({
      amount: 10_000,
      expectedCloseAt: new Date("2026-06-01").getTime(),
      stageId: "appointmentscheduled",
      title: "Acme deal",
    });
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.surface === "deals",
    );
    const input = createCall?.args[0] as {
      properties: Record<string, string>;
    };
    expect(input.properties.dealname).toBe("Acme deal");
    expect(input.properties.amount).toBe("10000");
    expect(input.properties.dealstage).toBe("appointmentscheduled");
    expect(input.properties.closedate).toContain("2026-06-01");
  });

  test("logActivity creates a call engagement with duration in ms", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    await adapter.logActivity({
      body: "Spoke with Alex.",
      durationSeconds: 180,
      occurredAt: new Date("2026-05-19T10:00:00Z").getTime(),
      type: "call",
    });
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.surface === "calls",
    );
    const input = createCall?.args[0] as {
      properties: Record<string, string>;
    };
    expect(input.properties.hs_call_duration).toBe("180000");
    expect(input.properties.hs_call_body).toBe("Spoke with Alex.");
  });

  test("addNote associates with contact via association type 202", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    await adapter.addNote({
      body: "Important note",
      contactIds: ["c_42"],
    });
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.surface === "notes",
    );
    const input = createCall?.args[0] as {
      associations?: { to: { id: string }; types: { associationTypeId: number }[] }[];
    };
    expect(input.associations?.[0]?.to.id).toBe("c_42");
    expect(input.associations?.[0]?.types[0]?.associationTypeId).toBe(202);
  });

  test("updateContact returns mapped result", async () => {
    const mock = makeMockClient();
    mock.seed("contacts.update.c_1", {
      id: "c_1",
      properties: { email: "new@example.com", firstname: "Alex" },
    });
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    const result = await adapter.updateContact("c_1", {
      emails: [{ address: "new@example.com" }],
    });
    expect(result.emails[0]?.address).toBe("new@example.com");
  });

  test("listPipelines maps HubSpot stage metadata to closed/won flags", async () => {
    const mock = makeMockClient();
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    const pipelines = await adapter.listPipelines();
    expect(pipelines).toHaveLength(1);
    const wonStage = pipelines[0]?.stages.find((s) => s.id === "closedwon");
    expect(wonStage?.isClosed).toBe(true);
    expect(wonStage?.isWon).toBe(true);
    expect(wonStage?.probability).toBe(1);
  });

  test("getContact uses basicApi with property list", async () => {
    const mock = makeMockClient();
    mock.seed("contacts.getById.c_5", {
      id: "c_5",
      properties: { firstname: "Alex", lastname: "K" },
    });
    const adapter = await createHubSpotCRMAdapter({
      accessToken: "x",
      client: mock.client,
    });
    const contact = await adapter.getContact("c_5");
    expect(contact?.fullName).toBe("Alex K");
  });
});

describe("HubSpot mappers", () => {
  test("mapHubSpotContactObject builds fullName from first + last", () => {
    const contact = mapHubSpotContactObject({
      id: "c_1",
      properties: { firstname: "Alex", lastname: "Kahn" },
    });
    expect(contact.fullName).toBe("Alex Kahn");
  });

  test("mapHubSpotDealObject parses amount + closedate", () => {
    const deal = mapHubSpotDealObject({
      id: "d_1",
      properties: {
        amount: "5000",
        closedate: "2026-06-01T00:00:00.000Z",
        dealname: "Acme",
      },
    });
    expect(deal.amount).toBe(5_000);
    expect(deal.expectedCloseAt).toBe(new Date("2026-06-01").getTime());
  });
});
