import { describe, expect, test } from "bun:test";
import {
  createPipedriveCRMAdapter,
  mapPipedrivePersonToContact,
} from "../src/adapters/pipedrive";
import type { CRMHttpClient } from "../src/adapters/_http";

const mockHttp = () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const responses = new Map<string, unknown>();
  const http: CRMHttpClient = async (req) => {
    calls.push({ body: req.body, method: req.method, url: req.url });
    const key = `${req.method} ${req.url.split("?")[0]}`;
    const data = responses.get(key) ?? responses.get(req.url);
    return {
      data: { data, success: true },
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

describe("createPipedriveCRMAdapter", () => {
  test("requires apiDomain", async () => {
    await expect(
      createPipedriveCRMAdapter({ accessToken: "tkn" }),
    ).rejects.toThrow(/apiDomain/);
  });

  test("createContact POSTs to /persons with mapped fields", async () => {
    const mock = mockHttp();
    mock.seed("POST https://acme.pipedrive.com/api/v1/persons", { id: 42 });
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com", primary: true }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [{ label: "mobile", number: "+14155550100", primary: true }],
    });
    expect(contact.id).toBe("42");
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.first_name).toBe("Alex");
    expect((body.email as { value: string }[])[0]?.value).toBe(
      "alex@example.com",
    );
  });

  test("lookupContactByEmail uses /persons/search with fields=email", async () => {
    const mock = mockHttp();
    mock.seed("GET https://acme.pipedrive.com/api/v1/persons/search", {
      items: [
        {
          item: {
            email: [{ primary: true, value: "alex@example.com" }],
            first_name: "Alex",
            id: 42,
            name: "Alex Kahn",
            phone: [],
          },
        },
      ],
    });
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("42");
    expect(mock.calls[0]?.url).toContain("fields=email");
  });

  test("createDeal POSTs to /deals with stage_id + expected_close_date", async () => {
    const mock = mockHttp();
    mock.seed("POST https://acme.pipedrive.com/api/v1/deals", {
      id: 99,
      title: "Acme deal",
    });
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    await adapter.createDeal({
      amount: 5_000,
      expectedCloseAt: new Date("2026-06-01").getTime(),
      stageId: "12",
      title: "Acme deal",
    });
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.title).toBe("Acme deal");
    expect(body.value).toBe(5_000);
    expect(body.stage_id).toBe(12);
    expect(body.expected_close_date).toBe("2026-06-01");
  });

  test("logActivity maps voice call to type=call with duration HH:MM:SS", async () => {
    const mock = mockHttp();
    mock.seed("POST https://acme.pipedrive.com/api/v1/activities", { id: 7 });
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    await adapter.logActivity({
      durationSeconds: 185,
      occurredAt: new Date("2026-05-19T10:00:00Z").getTime(),
      type: "call",
    });
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.type).toBe("call");
    expect(body.duration).toBe("00:03:05");
  });

  test("listPipelines combines /pipelines + /stages", async () => {
    const mock = mockHttp();
    mock.seed("GET https://acme.pipedrive.com/api/v1/pipelines", [
      { id: 1, name: "Sales", selected: true },
    ]);
    mock.seed("GET https://acme.pipedrive.com/api/v1/stages", [
      { deal_probability: 50, id: 10, name: "Qualified", order_nr: 1, pipeline_id: 1 },
      { id: 20, name: "Won", order_nr: 2, pipeline_id: 1 },
    ]);
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    const pipelines = await adapter.listPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages).toHaveLength(2);
    expect(pipelines[0]?.stages[0]?.probability).toBeCloseTo(0.5);
  });

  test("addNote POSTs with deal_id when provided", async () => {
    const mock = mockHttp();
    mock.seed("POST https://acme.pipedrive.com/api/v1/notes", { id: 13 });
    const adapter = await createPipedriveCRMAdapter({
      accessToken: "tkn",
      apiDomain: "https://acme.pipedrive.com",
      httpClient: mock.http,
    });
    await adapter.addNote({ body: "n", dealId: "99" });
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.content).toBe("n");
    expect(body.deal_id).toBe(99);
  });
});

describe("Pipedrive mappers", () => {
  test("mapPipedrivePersonToContact handles missing optional fields", () => {
    const contact = mapPipedrivePersonToContact({ id: 1 });
    expect(contact.id).toBe("1");
    expect(contact.emails).toEqual([]);
    expect(contact.phones).toEqual([]);
  });
});
