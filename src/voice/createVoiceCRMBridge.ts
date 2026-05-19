import type {
  VoiceCRMCallActivityInput,
  VoiceCRMContactSummary,
  VoiceCRMContract,
  VoiceCRMLeadInput,
  VoiceCRMNoteInput,
  VoiceCRMTaskInput,
} from "@absolutejs/voice";
import type { CRMAdapter, CRMContact, CRMLead } from "../types";

const contactToSummary = (
  contact: CRMContact | CRMLead,
): VoiceCRMContactSummary => ({
  id: contact.id,
  vendor: contact.vendor,
  ...(contact.firstName !== undefined ? { firstName: contact.firstName } : {}),
  ...(contact.lastName !== undefined ? { lastName: contact.lastName } : {}),
  ...(contact.emails[0]?.address !== undefined
    ? { email: contact.emails[0]?.address }
    : {}),
  ...(contact.phones[0]?.number !== undefined
    ? { phone: contact.phones[0]?.number }
    : {}),
  ...("jobTitle" in contact && contact.jobTitle !== undefined
    ? { jobTitle: contact.jobTitle }
    : {}),
});

export type CreateVoiceCRMBridgeOptions = {
  adapter: CRMAdapter;
};

export const createVoiceCRMBridge = (
  options: CreateVoiceCRMBridgeOptions,
): VoiceCRMContract => {
  const adapter = options.adapter;

  return {
    vendor: adapter.vendor,
    async addNote(input: VoiceCRMNoteInput) {
      const note = await adapter.addNote({
        body: input.body,
        contactIds: [input.contactId],
      });
      return { noteId: note.id };
    },
    async createLead(input: VoiceCRMLeadInput) {
      const lead = await adapter.createLead({
        emails: input.email ? [{ address: input.email, primary: true }] : [],
        phones: input.phone ? [{ label: "work", number: input.phone }] : [],
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.company !== undefined ? { company: input.company } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      });
      return contactToSummary(lead);
    },
    async createTask(input: VoiceCRMTaskInput) {
      const task = await adapter.createTask({
        subject: input.subject,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.contactId !== undefined
          ? { contactIds: [input.contactId] }
          : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      });
      return { taskId: task.id };
    },
    async logCall(input: VoiceCRMCallActivityInput) {
      const summary = input.summary ?? `Voice call ${input.sessionId}`;
      const activity = await adapter.logActivity({
        durationSeconds: input.durationSeconds,
        occurredAt: input.startedAt,
        subject: summary.slice(0, 80),
        type: "call",
        ...(input.summary !== undefined ? { body: input.summary } : {}),
        ...(input.contactId !== undefined
          ? { contactIds: [input.contactId] }
          : {}),
        ...(input.disposition !== undefined
          ? { outcome: input.disposition }
          : {}),
        ...(input.metadata !== undefined
          ? {
              metadata: Object.fromEntries(
                Object.entries(input.metadata).map(([k, v]) => [
                  k,
                  String(v),
                ]),
              ),
            }
          : {}),
      });
      return { activityId: activity.id };
    },
    async lookupByEmail(email) {
      const contact = await adapter.lookupContactByEmail(email);
      return contact ? contactToSummary(contact) : null;
    },
    async lookupByPhone(phone) {
      const contact = await adapter.lookupContactByPhone(phone);
      return contact ? contactToSummary(contact) : null;
    },
  };
};
