import type { VoicePathway, VoicePathwaySlot } from "@absolutejs/voice";

export type VoiceLeadCaptureField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "company"
  | "jobTitle"
  | "source"
  | "notes";

export type CreateVoiceLeadCapturePathwayOptions = {
  id?: string;
  label?: string;
  vendor?: string;
  requiredFields?: VoiceLeadCaptureField[];
  optionalFields?: VoiceLeadCaptureField[];
  greeting?: string;
  closing?: string;
  toolId?: string;
};

const SLOT_DEFINITIONS: Record<VoiceLeadCaptureField, Omit<VoicePathwaySlot, "id">> = {
  company: {
    description: "Caller's company name",
    prompt: "What company are you with?",
    type: "string",
  },
  email: {
    description: "Best email to reach them at",
    prompt: "What's the best email to reach you at?",
    type: "email",
  },
  firstName: {
    description: "Caller's first name",
    prompt: "What's your first name?",
    type: "string",
  },
  jobTitle: {
    description: "Caller's job title",
    prompt: "And what's your role there?",
    type: "string",
  },
  lastName: {
    description: "Caller's last name",
    prompt: "And your last name?",
    type: "string",
  },
  notes: {
    description: "Free-text context about the inquiry",
    prompt: "Anything else I should know about your inquiry?",
    type: "string",
  },
  phone: {
    description: "Best phone to call them back on",
    prompt: "What's the best phone number to reach you at?",
    type: "phone",
  },
  source: {
    description: "How the caller heard about us",
    prompt: "How did you hear about us?",
    type: "string",
  },
};

export const DEFAULT_VOICE_LEAD_CAPTURE_REQUIRED_FIELDS: VoiceLeadCaptureField[] =
  ["firstName", "lastName", "email", "phone"];

export const DEFAULT_VOICE_LEAD_CAPTURE_OPTIONAL_FIELDS: VoiceLeadCaptureField[] =
  ["company", "jobTitle", "source", "notes"];

export const createVoiceLeadCapturePathway = (
  options: CreateVoiceLeadCapturePathwayOptions = {},
): VoicePathway => {
  const id = options.id ?? "lead-capture";
  const label = options.label ?? "Lead capture pathway";
  const toolId = options.toolId ?? "crm.create_lead";
  const required =
    options.requiredFields ?? DEFAULT_VOICE_LEAD_CAPTURE_REQUIRED_FIELDS;
  const optional =
    options.optionalFields ?? DEFAULT_VOICE_LEAD_CAPTURE_OPTIONAL_FIELDS;
  const allFields = [...required, ...optional];
  const greeting =
    options.greeting ??
    "Thanks for reaching out — I'd love to grab a few details so we can follow up.";
  const closing =
    options.closing ??
    "Got it. We'll be in touch shortly — have a great day.";

  const slots: VoicePathwaySlot[] = allFields.map((field) => ({
    id: field,
    required: required.includes(field),
    ...SLOT_DEFINITIONS[field],
  }));

  const collectStates = allFields.map((field, index) => {
    const next = allFields[index + 1] ?? "submit";
    return {
      actions: [{ kind: "collect-slot" as const, slotId: field }],
      id: `collect-${field}`,
      kind: "collect" as const,
      label: `Collect ${field}`,
      transitions: [
        {
          condition: { kind: "slot-filled" as const, slotId: field },
          to: `collect-${next}`.replace("-submit", "-submit"),
        },
      ],
    };
  });
  if (collectStates.length > 0) {
    const last = collectStates[collectStates.length - 1]!;
    last.transitions = [
      {
        condition: { kind: "slot-filled" as const, slotId: allFields[allFields.length - 1]! },
        to: "submit",
      },
    ];
  }

  return {
    entryStateId: "greet",
    id,
    label,
    metadata: {
      ...(options.vendor !== undefined ? { vendor: options.vendor } : {}),
    },
    slots,
    states: [
      {
        actions: [{ kind: "say", text: greeting }],
        id: "greet",
        kind: "entry",
        label: "Greet",
        transitions: [
          {
            condition: { kind: "always" },
            to: allFields[0] ? `collect-${allFields[0]}` : "submit",
          },
        ],
      },
      ...collectStates,
      {
        actions: [
          {
            argsFromSlots: allFields,
            kind: "call-tool",
            toolId,
          },
          { kind: "say", text: closing },
        ],
        id: "submit",
        kind: "action",
        label: "Submit lead",
        transitions: [{ condition: { kind: "always" }, to: "done" }],
      },
      {
        actions: [{ kind: "end-call", reason: "lead-captured" }],
        id: "done",
        kind: "terminal",
        label: "Done",
        transitions: [],
      },
    ],
    tools: [
      {
        description: `Create a new lead in the CRM with the collected fields.`,
        id: toolId,
      },
    ],
  };
};
