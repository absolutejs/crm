import { describe, expect, test } from "bun:test";
import { createAttioCRMAdapter, mapAttioPerson } from "../src/adapters/attio";
import type { CRMHttpClient } from "../src/adapters/_http";

const mockHttp = () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const responses = new Map<string, unknown>();
  const http: CRMHttpClient = async (req) => {
    calls.push({ body: req.body, method: req.method, url: req.url });
    const key = `${req.method} ${req.url}`;
    return {
      data: responses.get(key) ?? {},
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

describe("createAttioCRMAdapter", () => {
  test("createContact POSTs to /objects/people/records with values envelope", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.attio.com/v2/objects/people/records", {
      data: { id: { record_id: "p_42" }, values: {} },
    });
    const adapter = await createAttioCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [{ label: "work", number: "+14155550100" }],
    });
    expect(contact.id).toBe("p_42");
    const body = mock.calls[0]?.body as {
      data: { values: Record<string, unknown> };
    };
    expect(body.data.values.email_addresses).toEqual(["alex@example.com"]);
    expect(body.data.values.phone_numbers).toEqual(["+14155550100"]);
  });

  test("lookupContactByEmail uses POST query with filter", async () => {
    const mock = mockHttp();
    mock.seed(
      "POST https://api.attio.com/v2/objects/people/records/query",
      {
        data: [
          {
            id: { record_id: "p_5" },
            values: {
              email_addresses: [{ value: "alex@example.com" }],
              name: [{ value: { first_name: "Alex", last_name: "Kahn" } }],
            },
          },
        ],
      },
    );
    const adapter = await createAttioCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("p_5");
    const body = mock.calls[0]?.body as { filter: Record<string, unknown> };
    expect(body.filter.email_addresses).toBe("alex@example.com");
  });

  test("createDeal POSTs to /objects/deals/records with currency value", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.attio.com/v2/objects/deals/records", {
      data: { id: { record_id: "d_99" }, values: {} },
    });
    const adapter = await createAttioCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    await adapter.createDeal({
      amount: 5_000,
      currency: "USD",
      title: "Acme deal",
    });
    const body = mock.calls[0]?.body as {
      data: { values: { value: { currency_value: number; currency_code: string } } };
    };
    expect(body.data.values.value.currency_value).toBe(5_000);
    expect(body.data.values.value.currency_code).toBe("USD");
  });

  test("addNote POSTs to /notes with people parent_object", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.attio.com/v2/notes", {
      data: { id: { note_id: "n_77" } },
    });
    const adapter = await createAttioCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    const note = await adapter.addNote({
      body: "Test note",
      contactIds: ["p_42"],
    });
    expect(note.id).toBe("n_77");
    const body = mock.calls[0]?.body as { data: Record<string, unknown> };
    expect(body.data.parent_object).toBe("people");
    expect(body.data.parent_record_id).toBe("p_42");
  });

  test("logActivity routes through addNote with type-prefixed body", async () => {
    const mock = mockHttp();
    mock.seed("POST https://api.attio.com/v2/notes", {
      data: { id: { note_id: "n_88" } },
    });
    const adapter = await createAttioCRMAdapter({
      accessToken: "tkn",
      httpClient: mock.http,
    });
    await adapter.logActivity({
      body: "Pricing discussion",
      occurredAt: 0,
      subject: "Sales call",
      type: "call",
    });
    const body = mock.calls[0]?.body as { data: { content: string } };
    expect(body.data.content).toContain("[call]");
    expect(body.data.content).toContain("Sales call");
  });
});

describe("Attio mappers", () => {
  test("mapAttioPerson extracts first/last/full from name value", () => {
    const contact = mapAttioPerson({
      id: { record_id: "p_1" },
      values: {
        name: [
          {
            value: {
              first_name: "Alex",
              full_name: "Alex Kahn",
              last_name: "Kahn",
            },
          },
        ],
      },
    });
    expect(contact.firstName).toBe("Alex");
    expect(contact.lastName).toBe("Kahn");
    expect(contact.fullName).toBe("Alex Kahn");
  });
});
