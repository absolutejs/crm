import { describe, expect, test } from "bun:test";
import {
  createZohoCRMAdapter,
  mapZohoContact,
} from "../src/adapters/zoho";
import type { CRMHttpClient } from "../src/adapters/_http";

const mockHttp = () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const responses = new Map<string, unknown>();
  const http: CRMHttpClient = async (req) => {
    calls.push({ body: req.body, method: req.method, url: req.url });
    const key = `${req.method} ${req.url.split("?")[0]}`;
    const data = responses.get(key) ?? responses.get(req.url) ?? {};
    return {
      data,
      ok: true,
      status: 200,
    } as Awaited<ReturnType<CRMHttpClient>>;
  };
  return {
    calls,
    http,
    seed(key: string, data: unknown) {
      responses.set(key, data);
    },
  };
};

const base = (httpClient: CRMHttpClient) =>
  createZohoCRMAdapter({
    accessToken: "tkn",
    httpClient,
    region: "com",
  });

describe("createZohoCRMAdapter", () => {
  test("defaults to https://www.zohoapis.com when no region", async () => {
    const mock = mockHttp();
    mock.seed("POST https://www.zohoapis.com/crm/v2/Contacts", {
      data: [{ code: "SUCCESS", details: { id: "C1" } }],
    });
    const adapter = await base(mock.http);
    await adapter.createContact({
      emails: [{ address: "a@b.com" }],
      firstName: "A",
      lastName: "B",
      phones: [],
    });
    expect(mock.calls[0]?.url).toContain("https://www.zohoapis.com/crm/v2/Contacts");
  });

  test("custom region builds the right URL", async () => {
    const mock = mockHttp();
    mock.seed("POST https://www.zohoapis.eu/crm/v2/Contacts", {
      data: [{ code: "SUCCESS", details: { id: "C1" } }],
    });
    const adapter = await createZohoCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
      region: "eu",
    });
    await adapter.createContact({
      emails: [],
      lastName: "X",
      phones: [],
    });
    expect(mock.calls[0]?.url).toContain("https://www.zohoapis.eu");
  });

  test("createContact writes through /Contacts with data envelope", async () => {
    const mock = mockHttp();
    mock.seed("POST https://www.zohoapis.com/crm/v2/Contacts", {
      data: [{ code: "SUCCESS", details: { id: "C42" } }],
    });
    const adapter = await base(mock.http);
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [{ label: "mobile", number: "+14155550100" }],
    });
    expect(contact.id).toBe("C42");
    const body = mock.calls[0]?.body as { data: Record<string, unknown>[] };
    expect(body.data[0]?.First_Name).toBe("Alex");
    expect(body.data[0]?.Mobile).toBe("+14155550100");
  });

  test("createLead requires Company (defaults to Unknown)", async () => {
    const mock = mockHttp();
    mock.seed("POST https://www.zohoapis.com/crm/v2/Leads", {
      data: [{ code: "SUCCESS", details: { id: "L42" } }],
    });
    const adapter = await base(mock.http);
    await adapter.createLead({
      emails: [{ address: "a@b.com" }],
      firstName: "Alex",
      phones: [],
    });
    const body = mock.calls[0]?.body as { data: Record<string, unknown>[] };
    expect(body.data[0]?.Company).toBe("Unknown");
  });

  test("logActivity creates a Call record", async () => {
    const mock = mockHttp();
    mock.seed("POST https://www.zohoapis.com/crm/v2/Calls", {
      data: [{ code: "SUCCESS", details: { id: "K42" } }],
    });
    const adapter = await base(mock.http);
    await adapter.logActivity({
      durationSeconds: 200,
      occurredAt: new Date("2026-05-19T10:00:00Z").getTime(),
      subject: "Demo call",
      type: "call",
    });
    const body = mock.calls[0]?.body as { data: Record<string, unknown>[] };
    expect(body.data[0]?.Call_Duration_in_seconds).toBe(200);
    expect(body.data[0]?.Call_Purpose).toBe("Demo call");
  });

  test("addNote throws when no parent ID provided", async () => {
    const mock = mockHttp();
    const adapter = await base(mock.http);
    await expect(
      adapter.addNote({ body: "orphan" }),
    ).rejects.toThrow(/contactId|dealId|accountId/);
  });

  test("lookupContactByEmail GETs /Contacts/search?email=", async () => {
    const mock = mockHttp();
    mock.seed("GET https://www.zohoapis.com/crm/v2/Contacts/search", {
      data: [{ Email: "alex@example.com", First_Name: "Alex", id: "C5" }],
    });
    const adapter = await base(mock.http);
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("C5");
    expect(mock.calls[0]?.url).toContain("email=");
  });
});

describe("Zoho mappers", () => {
  test("mapZohoContact handles minimum fields", () => {
    const contact = mapZohoContact({ id: "C1", Last_Name: "K" });
    expect(contact.id).toBe("C1");
    expect(contact.lastName).toBe("K");
  });
});
