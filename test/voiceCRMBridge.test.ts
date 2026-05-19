import { describe, expect, test } from "bun:test";
import { createVoiceCRMBridge } from "../src/voice";
import type { CRMAdapter } from "../src/types";

const stub = (overrides: Partial<CRMAdapter> = {}): CRMAdapter => ({
  capabilities: {
    preferredIdField: "id",
    supportsBulkUpsert: false,
    supportsCustomFields: false,
    supportsLeads: true,
    supportsPipelines: true,
    supportsWebhooks: true,
    syncDirection: "outbound-only",
  },
  addNote: async () => ({
    body: "x",
    id: "n_99",
    vendor: "hubspot",
  }),
  createContact: async (i) => ({ ...i, id: "c_99", vendor: "hubspot" }),
  createDeal: async (i) => ({ ...i, id: "d_99", vendor: "hubspot" }),
  createLead: async (i) => ({ ...i, id: "l_99", vendor: "hubspot" }),
  createTask: async (i) => ({ ...i, id: "t_99", vendor: "hubspot" }),
  getContact: async () => null,
  listPipelines: async () => [],
  logActivity: async (i) => ({ ...i, id: "a_99", vendor: "hubspot" }),
  lookupContactByEmail: async () => null,
  lookupContactByPhone: async () => null,
  searchContacts: async () => [],
  updateContact: async (id) => ({
    emails: [],
    id,
    phones: [],
    vendor: "hubspot",
  }),
  updateDeal: async (id, p) => ({
    id,
    title: p.title ?? "",
    vendor: "hubspot",
  }),
  vendor: "hubspot",
  ...overrides,
});

describe("createVoiceCRMBridge", () => {
  test("vendor is forwarded from the adapter", () => {
    const bridge = createVoiceCRMBridge({ adapter: stub() });
    expect(bridge.vendor).toBe("hubspot");
  });

  test("lookupByEmail maps adapter CRMContact → VoiceCRMContactSummary", async () => {
    const bridge = createVoiceCRMBridge({
      adapter: stub({
        lookupContactByEmail: async () => ({
          emails: [{ address: "alex@example.com", primary: true }],
          firstName: "Alex",
          id: "c_42",
          lastName: "Kahn",
          phones: [{ label: "mobile", number: "+14155550100" }],
          vendor: "hubspot",
        }),
      }),
    });
    const result = await bridge.lookupByEmail("alex@example.com");
    expect(result?.email).toBe("alex@example.com");
    expect(result?.phone).toBe("+14155550100");
    expect(result?.firstName).toBe("Alex");
  });

  test("createLead translates VoiceCRMLeadInput → CRMLead create", async () => {
    let createdWith: Record<string, unknown> | null = null;
    const bridge = createVoiceCRMBridge({
      adapter: stub({
        createLead: async (input) => {
          createdWith = input as Record<string, unknown>;
          return { ...input, id: "l_500", vendor: "hubspot" };
        },
      }),
    });
    const summary = await bridge.createLead({
      company: "Acme",
      email: "alex@example.com",
      firstName: "Alex",
      lastName: "Kahn",
      phone: "+14155550100",
      source: "voice-agent",
    });
    expect(summary.id).toBe("l_500");
    expect(createdWith?.firstName).toBe("Alex");
    expect((createdWith?.emails as { address: string }[])[0]?.address).toBe(
      "alex@example.com",
    );
    expect((createdWith?.phones as { number: string }[])[0]?.number).toBe(
      "+14155550100",
    );
  });

  test("logCall translates call activity into adapter.logActivity", async () => {
    let captured: Record<string, unknown> | null = null;
    const bridge = createVoiceCRMBridge({
      adapter: stub({
        logActivity: async (input) => {
          captured = input as Record<string, unknown>;
          return { ...input, id: "a_500", vendor: "hubspot" };
        },
      }),
    });
    const result = await bridge.logCall({
      contactId: "c_42",
      disposition: "qualified",
      durationSeconds: 180,
      endedAt: 60_000,
      sessionId: "call_1",
      startedAt: 0,
      summary: "Caller asked about pricing.",
    });
    expect(result.activityId).toBe("a_500");
    expect(captured?.type).toBe("call");
    expect(captured?.outcome).toBe("qualified");
    expect(captured?.body).toBe("Caller asked about pricing.");
    expect(captured?.durationSeconds).toBe(180);
  });

  test("addNote routes through adapter.addNote with contactIds", async () => {
    let noteInput: Record<string, unknown> | null = null;
    const bridge = createVoiceCRMBridge({
      adapter: stub({
        addNote: async (input) => {
          noteInput = input as Record<string, unknown>;
          return { body: input.body, id: "n_500", vendor: "hubspot" };
        },
      }),
    });
    const result = await bridge.addNote({
      body: "Caller wants a callback.",
      contactId: "c_42",
    });
    expect(result.noteId).toBe("n_500");
    expect((noteInput?.contactIds as string[])[0]).toBe("c_42");
  });

  test("createTask is optional but works when implemented", async () => {
    const bridge = createVoiceCRMBridge({ adapter: stub() });
    const result = await bridge.createTask?.({
      contactId: "c_42",
      priority: "high",
      subject: "Follow up next week",
    });
    expect(result?.taskId).toBe("t_99");
  });
});
