import { describe, expect, test } from "bun:test";
import {
  createMondayCRMAdapter,
  mapMondayItemToContact,
} from "../src/adapters/monday";
import type { CRMHttpClient } from "../src/adapters/_http";

const mockHttp = () => {
  const calls: { body: { query: string; variables: Record<string, unknown> } }[] =
    [];
  const responses: { match: string; data: unknown }[] = [];
  const http: CRMHttpClient = async (req) => {
    const body = req.body as {
      query: string;
      variables: Record<string, unknown>;
    };
    calls.push({ body });
    const match = responses.find((r) => body.query.includes(r.match));
    return {
      data: { data: match?.data ?? {}, errors: undefined },
      ok: true,
      status: 200,
    } as Awaited<ReturnType<CRMHttpClient>>;
  };
  return {
    calls,
    http,
    seed(matchSubstring: string, data: unknown) {
      responses.push({ data, match: matchSubstring });
    },
  };
};

const baseOptions = (httpClient: CRMHttpClient) => ({
  accessToken: "tkn",
  columnMapping: {
    email: "email_col",
    firstName: "fn_col",
    lastName: "ln_col",
    phone: "phone_col",
  },
  contactsBoardId: "board_1",
  httpClient,
});

describe("createMondayCRMAdapter", () => {
  test("createContact issues a create_item mutation with mapped column values", async () => {
    const mock = mockHttp();
    mock.seed("create_item", {
      create_item: { id: "item_42", name: "Alex Kahn" },
    });
    const adapter = await createMondayCRMAdapter(baseOptions(mock.http));
    const contact = await adapter.createContact({
      emails: [{ address: "alex@example.com" }],
      firstName: "Alex",
      lastName: "Kahn",
      phones: [{ label: "work", number: "+14155550100" }],
    });
    expect(contact.id).toBe("item_42");
    const vars = mock.calls[0]?.body.variables as Record<string, unknown>;
    expect(vars.name).toBe("Alex Kahn");
    expect(vars.boardId).toBe("board_1");
    const parsed = JSON.parse(vars.values as string);
    expect(parsed.email_col).toBe("alex@example.com");
    expect(parsed.fn_col).toBe("Alex");
    expect(parsed.phone_col).toBe("+14155550100");
  });

  test("lookupContactByEmail uses items_page_by_column_values", async () => {
    const mock = mockHttp();
    mock.seed("items_page_by_column_values", {
      items_page_by_column_values: {
        items: [
          {
            column_values: [{ id: "email_col", text: "alex@example.com" }],
            id: "item_5",
            name: "Alex K",
          },
        ],
      },
    });
    const adapter = await createMondayCRMAdapter(baseOptions(mock.http));
    const contact = await adapter.lookupContactByEmail("alex@example.com");
    expect(contact?.id).toBe("item_5");
  });

  test("createDeal requires dealsBoardId", async () => {
    const mock = mockHttp();
    const adapter = await createMondayCRMAdapter(baseOptions(mock.http));
    await expect(
      adapter.createDeal({ title: "Acme deal" }),
    ).rejects.toThrow(/dealsBoardId/);
  });

  test("logActivity creates an update note on the contact item", async () => {
    const mock = mockHttp();
    mock.seed("create_update", { create_update: { id: "upd_7" } });
    const adapter = await createMondayCRMAdapter(baseOptions(mock.http));
    const result = await adapter.logActivity({
      body: "Caller asked about pricing.",
      contactIds: ["item_42"],
      durationSeconds: 200,
      occurredAt: 0,
      subject: "Pricing call",
      type: "call",
    });
    expect(result.id).toBe("upd_7");
    const vars = mock.calls[0]?.body.variables as { body: string };
    expect(vars.body).toContain("📞 Pricing call");
    expect(vars.body).toContain("Duration: 200s");
  });

  test("GraphQL errors surface as thrown Errors", async () => {
    const http: CRMHttpClient = async () => ({
      data: { data: {}, errors: [{ message: "Bad query" }] },
      ok: true,
      status: 200,
    });
    const adapter = await createMondayCRMAdapter({
      ...baseOptions(http),
      httpClient: http,
    });
    await expect(adapter.getContact("item_1")).rejects.toThrow(/Bad query/);
  });
});

describe("monday mappers", () => {
  test("mapMondayItemToContact picks values via columnMapping", () => {
    const contact = mapMondayItemToContact(
      {
        column_values: [
          { id: "email_col", text: "alex@example.com" },
          { id: "phone_col", text: "+14155550100" },
          { id: "fn_col", text: "Alex" },
        ],
        id: "item_1",
        name: "Alex Kahn",
      },
      { email: "email_col", firstName: "fn_col", phone: "phone_col" },
    );
    expect(contact.firstName).toBe("Alex");
    expect(contact.emails[0]?.address).toBe("alex@example.com");
    expect(contact.phones[0]?.number).toBe("+14155550100");
  });
});
