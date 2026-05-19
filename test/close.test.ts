import { describe, expect, test } from "bun:test";
import { createCloseCRMAdapter, mapCloseContact } from "../src/adapters/close";
import type { CRMHttpClient } from "../src/adapters/_http";

const mockHttp = () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const responses = new Map<string, unknown>();
  const http: CRMHttpClient = async (req) => {
    calls.push({ body: req.body, method: req.method, url: req.url });
    const key = `${req.method} ${req.url.split("?")[0]}`;
    return {
      data: responses.get(key) ?? responses.get(req.url) ?? {},
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

describe("createCloseCRMAdapter", () => {
  test("createLead POSTs to /lead/ with contacts payload", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.close.com/api/v1/lead/", { id: "lead_42" });
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const lead = await adapter.createLead({
      company: "Acme",
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [],
    });
    expect(lead.id).toBe("lead_42");
    const body = mock.calls[0]?.body as {
      contacts: { name: string; emails: { email: string }[] }[];
      name: string;
    };
    expect(body.name).toBe("Acme");
    expect(body.contacts[0]?.name).toBe("Alex Kahn");
    expect(body.contacts[0]?.emails[0]?.email).toBe("alex@example.com");
  });

  test("createContact requires accountId (Close lead_id)", async () => {
    const mock = mockHttp();
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    await expect(
      adapter.createContact({
        emails: [{ address: "a@b.com" }],
        firstName: "Alex",
        phones: [],
      }),
    ).rejects.toThrow(/Lead/);
  });

  test("logActivity POSTs to /activity/call/ with lead_id + duration", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.close.com/api/v1/activity/call/", {
      id: "act_99",
    });
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    await adapter.logActivity({
      accountId: "lead_42",
      body: "Caller asked about pricing.",
      durationSeconds: 180,
      occurredAt: 0,
      type: "call",
    });
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.lead_id).toBe("lead_42");
    expect(body.duration).toBe(180);
    expect(body.direction).toBe("outbound");
  });

  test("lookupContactByEmail uses emails__email filter", async () => {
    const mock = mockHttp();
    mock.seed("GET https://api.close.com/api/v1/contact/", {
      data: [
        {
          emails: [{ email: "alex@example.com" }],
          id: "cont_5",
          lead_id: "lead_42",
          name: "Alex Kahn",
        },
      ],
    });
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("cont_5");
    expect(mock.calls[0]?.url).toContain("emails__email");
  });

  test("listPipelines pulls /status/opportunity/", async () => {
    const mock = mockHttp();
    mock.seed("GET https://api.close.com/api/v1/status/opportunity/", {
      data: [
        { id: "stat_1", label: "Active", name: "active", status_type: "active" },
        { id: "stat_2", label: "Won", name: "won", status_type: "won" },
      ],
    });
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const pipelines = await adapter.listPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages[1]?.isWon).toBe(true);
  });

  test("addNote requires a lead reference", async () => {
    const mock = mockHttp();
    const adapter = await createCloseCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    await expect(adapter.addNote({ body: "orphan" })).rejects.toThrow(/lead/i);
  });
});

describe("Close mappers", () => {
  test("mapCloseContact splits name into first + last", () => {
    const contact = mapCloseContact({
      id: "c_1",
      lead_id: "lead_1",
      name: "Alex Kahn Smith",
    });
    expect(contact.firstName).toBe("Alex");
    expect(contact.lastName).toBe("Kahn Smith");
  });
});
