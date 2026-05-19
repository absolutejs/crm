import { describe, expect, test } from "bun:test";
import {
  createSalesforceCRMAdapter,
  mapContactRow,
  mapDealRow,
  mapLeadRow,
  type SalesforceConnectionLike,
} from "../src/adapters/salesforce";

type Call = { method: string; type?: string; args: unknown[] };

const makeMockConnection = () => {
  const calls: Call[] = [];
  const sobjectResults = new Map<string, Record<string, unknown>[]>();
  const queryResults: Record<string, Record<string, unknown>[]> = {};
  const connection: SalesforceConnectionLike = {
    async query(soql: string) {
      calls.push({ args: [soql], method: "query" });
      for (const [key, rows] of Object.entries(queryResults)) {
        if (soql.includes(key)) return { records: rows };
      }
      return { records: [] };
    },
    sobject(name: string) {
      return {
        async create(record) {
          calls.push({ args: [record], method: "create", type: name });
          const seeded = sobjectResults.get(name)?.[0];
          if (seeded?.error) {
            return { errors: [{ message: String(seeded.error) }], success: false };
          }
          const id = (seeded?.Id as string) ?? `${name}_id`;
          return { id, success: true };
        },
        async retrieve(id) {
          calls.push({ args: [id], method: "retrieve", type: name });
          return sobjectResults.get(name)?.find((r) => r.Id === id) ?? { Id: id };
        },
        async update(record) {
          calls.push({ args: [record], method: "update", type: name });
          return { id: String(record.Id), success: true };
        },
      };
    },
  };
  return {
    calls,
    connection,
    seedQuery(matcher: string, rows: Record<string, unknown>[]) {
      queryResults[matcher] = rows;
    },
    seedSObject(name: string, rows: Record<string, unknown>[]) {
      sobjectResults.set(name, rows);
    },
  };
};

describe("createSalesforceCRMAdapter", () => {
  test("vendor + capabilities are wired", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    expect(adapter.vendor).toBe("salesforce");
    expect(adapter.capabilities.supportsLeads).toBe(true);
  });

  test("lookupContactByEmail issues SOQL and maps the row", async () => {
    const mock = makeMockConnection();
    mock.seedQuery("Email = 'alex@example.com'", [
      { Email: "alex@example.com", FirstName: "Alex", Id: "003abc", LastName: "K" },
    ]);
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("003abc");
    expect(contact?.emails[0]?.address).toBe("alex@example.com");
  });

  test("lookupContactByPhone strips formatting and queries Phone/MobilePhone", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    await adapter.lookupContactByPhone("+1 (415) 555-0100");
    const queryCall = mock.calls.find((c) => c.method === "query");
    expect(queryCall?.args[0]).toContain("14155550100");
  });

  test("createContact maps generic CRMContact → Salesforce Contact fields", async () => {
    const mock = makeMockConnection();
    mock.seedSObject("Contact", [{ Id: "003xyz" }]);
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      jobTitle: "CTO",
      lastName: "Kahn",
      phones: [{ label: "mobile", number: "+14155550100" }],
    });
    expect(contact.id).toBe("003xyz");
    const createCall = mock.calls.find(
      (c) => c.method === "create" && c.type === "Contact",
    );
    const record = createCall?.args[0] as Record<string, unknown>;
    expect(record.FirstName).toBe("Alex");
    expect(record.LastName).toBe("Kahn");
    expect(record.Email).toBe("alex@example.com");
    expect(record.Phone).toBe("+14155550100");
    expect(record.Title).toBe("CTO");
  });

  test("createLead defaults Company to 'Unknown' when missing", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    await adapter.createLead({
      emails: [{ address: "a@b.com" }],
      firstName: "Alex",
      phones: [],
    });
    const call = mock.calls.find(
      (c) => c.method === "create" && c.type === "Lead",
    );
    const record = call?.args[0] as Record<string, unknown>;
    expect(record.Company).toBe("Unknown");
  });

  test("createDeal maps to Opportunity with stage + CloseDate", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    await adapter.createDeal({
      amount: 10_000,
      expectedCloseAt: new Date("2026-06-01").getTime(),
      stageId: "Qualification",
      title: "Acme deal",
    });
    const call = mock.calls.find(
      (c) => c.method === "create" && c.type === "Opportunity",
    );
    const record = call?.args[0] as Record<string, unknown>;
    expect(record.Name).toBe("Acme deal");
    expect(record.Amount).toBe(10_000);
    expect(record.StageName).toBe("Qualification");
    expect(record.CloseDate).toBe("2026-06-01");
  });

  test("logActivity maps voice call type to Salesforce Task with Type=Call", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    await adapter.logActivity({
      body: "Spoke with Alex about pricing.",
      durationSeconds: 240,
      occurredAt: new Date("2026-05-19T10:00:00Z").getTime(),
      type: "call",
    });
    const call = mock.calls.find(
      (c) => c.method === "create" && c.type === "Task",
    );
    const record = call?.args[0] as Record<string, unknown>;
    expect(record.Type).toBe("Call");
    expect(record.Status).toBe("Completed");
    expect(record.CallDurationInSeconds).toBe(240);
  });

  test("updateContact retrieves the updated record after update", async () => {
    const mock = makeMockConnection();
    mock.seedSObject("Contact", [
      { Email: "new@example.com", FirstName: "Alex", Id: "003xyz", LastName: "K" },
    ]);
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    const result = await adapter.updateContact("003xyz", {
      emails: [{ address: "new@example.com" }],
    });
    expect(result.emails[0]?.address).toBe("new@example.com");
    expect(
      mock.calls.some((c) => c.method === "retrieve" && c.type === "Contact"),
    ).toBe(true);
  });

  test("ensureSaved throws when result has errors", async () => {
    const mock = makeMockConnection();
    mock.seedSObject("Contact", [{ error: "REQUIRED_FIELD_MISSING" }]);
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    await expect(
      adapter.createContact({ emails: [], firstName: "Alex", phones: [] }),
    ).rejects.toThrow(/Salesforce save failed/);
  });

  test("listPipelines returns default 8-stage pipeline", async () => {
    const mock = makeMockConnection();
    const adapter = await createSalesforceCRMAdapter({
      accessToken: "x",
      connection: mock.connection,
      instanceUrl: "https://test.my.salesforce.com",
    });
    const pipelines = await adapter.listPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages).toHaveLength(8);
    expect(pipelines[0]?.stages.at(-1)?.isClosed).toBe(true);
  });

  test("rejects when no instanceUrl + no connection provided", async () => {
    await expect(
      createSalesforceCRMAdapter({ accessToken: "x" }),
    ).rejects.toThrow(/instanceUrl/);
  });
});

describe("mapping helpers", () => {
  test("mapContactRow handles missing optional fields", () => {
    const contact = mapContactRow({ Id: "x", LastName: "K" });
    expect(contact.emails).toEqual([]);
    expect(contact.phones).toEqual([]);
    expect(contact.lastName).toBe("K");
  });

  test("mapLeadRow extracts source + company", () => {
    const lead = mapLeadRow({
      Company: "Acme",
      Id: "00Q1",
      LastName: "Doe",
      LeadSource: "Web",
    });
    expect(lead.company).toBe("Acme");
    expect(lead.source).toBe("Web");
  });

  test("mapDealRow marks closed-won correctly", () => {
    const deal = mapDealRow({
      Amount: 5_000,
      CloseDate: "2026-06-01",
      Id: "006x",
      Name: "Big Deal",
      StageName: "Closed Won",
    });
    expect(deal.status).toBe("won");
    expect(deal.amount).toBe(5_000);
  });
});
