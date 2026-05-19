import { describe, expect, test } from "bun:test";
import {
  createGoHighLevelCRMAdapter,
  mapGoHighLevelContact,
} from "../src/adapters/gohighlevel";
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

const baseOptions = (httpClient: CRMHttpClient) => ({
  accessToken: "tkn",
  httpClient,
  subAccountId: "loc_42",
});

describe("createGoHighLevelCRMAdapter", () => {
  test("requires subAccountId (locationId)", async () => {
    await expect(
      createGoHighLevelCRMAdapter({ accessToken: "tkn" }),
    ).rejects.toThrow(/subAccountId/);
  });

  test("createContact POSTs to /contacts/ with locationId", async () => {
    const mock = mockHttp();
    mock.seed("POST https://services.leadconnectorhq.com/contacts/", {
      contact: { id: "c_42" },
    });
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [{ label: "work", number: "+14155550100" }],
    });
    expect(contact.id).toBe("c_42");
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.locationId).toBe("loc_42");
    expect(body.firstName).toBe("Alex");
    expect(body.email).toBe("alex@example.com");
  });

  test("createDeal requires pipelineId", async () => {
    const mock = mockHttp();
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    await expect(
      adapter.createDeal({ title: "Acme deal" }),
    ).rejects.toThrow(/pipelineId/);
  });

  test("createDeal POSTs to /opportunities/ with monetaryValue + status", async () => {
    const mock = mockHttp();
    mock.seed("POST https://services.leadconnectorhq.com/opportunities/", {
      opportunity: { id: "opp_99", name: "Acme" },
    });
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    await adapter.createDeal({
      amount: 5_000,
      pipelineId: "pipe_1",
      stageId: "stage_a",
      title: "Acme deal",
    });
    const body = mock.calls[0]?.body as Record<string, unknown>;
    expect(body.name).toBe("Acme deal");
    expect(body.monetaryValue).toBe(5_000);
    expect(body.pipelineId).toBe("pipe_1");
    expect(body.pipelineStageId).toBe("stage_a");
    expect(body.status).toBe("open");
  });

  test("logActivity posts a contact note with duration", async () => {
    const mock = mockHttp();
    mock.seed("POST https://services.leadconnectorhq.com/contacts/c_42/notes", {
      note: { id: "n_77" },
    });
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    await adapter.logActivity({
      body: "Caller asked about pricing.",
      contactIds: ["c_42"],
      durationSeconds: 200,
      occurredAt: 0,
      type: "call",
    });
    const body = mock.calls[0]?.body as { body: string };
    expect(body.body).toContain("Duration: 200s");
  });

  test("lookupContactByEmail GETs /contacts/?query=", async () => {
    const mock = mockHttp();
    mock.seed("GET https://services.leadconnectorhq.com/contacts/", {
      contacts: [{ email: "alex@example.com", id: "c_5" }],
    });
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("c_5");
    expect(mock.calls[0]?.url).toContain("locationId=loc_42");
    expect(mock.calls[0]?.url).toContain("query=alex");
  });

  test("listPipelines GETs /opportunities/pipelines and maps stages", async () => {
    const mock = mockHttp();
    mock.seed(
      "GET https://services.leadconnectorhq.com/opportunities/pipelines",
      {
        pipelines: [
          {
            id: "pipe_1",
            name: "Sales",
            stages: [
              { id: "stage_a", name: "New", position: 1 },
              { id: "stage_b", name: "Won", position: 2 },
            ],
          },
        ],
      },
    );
    const adapter = await createGoHighLevelCRMAdapter(baseOptions(mock.http));
    const pipelines = await adapter.listPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.stages).toHaveLength(2);
    expect(pipelines[0]?.stages[1]?.id).toBe("stage_b");
  });
});

describe("GoHighLevel mappers", () => {
  test("mapGoHighLevelContact extracts name + tags", () => {
    const contact = mapGoHighLevelContact({
      email: "x@y.com",
      firstName: "Alex",
      id: "c_1",
      lastName: "Kahn",
      tags: ["vip"],
    });
    expect(contact.tags).toEqual(["vip"]);
    expect(contact.firstName).toBe("Alex");
  });
});
