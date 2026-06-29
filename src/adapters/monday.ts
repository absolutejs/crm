import type {
  CRMAdapter,
  CRMAdapterCapabilities,
  CRMAdapterFactoryInput,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMPipeline,
} from "../types";
import {
  assertHttpOk,
  createFetchCRMHttpClient,
  type CRMHttpClient,
} from "./_http";

const VENDOR = "monday" as const;

const MONDAY_CAPABILITIES: CRMAdapterCapabilities = {
  preferredIdField: "id",
  supportsAccounts: false,
  supportsBulkUpsert: false,
  supportsCustomFields: true,
  supportsDelete: true,
  supportsLeadConversion: false,
  supportsLeads: false,
  supportsListing: true,
  supportsPipelines: false,
  supportsWebhooks: true,
  syncDirection: "outbound-only",
};

export type VoiceMondayColumnMapping = {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  company?: string;
  notes?: string;
  dealAmount?: string;
  dealStage?: string;
  dealCloseDate?: string;
};

export type CreateMondayCRMAdapterOptions = CRMAdapterFactoryInput & {
  httpClient?: CRMHttpClient;
  contactsBoardId: string;
  dealsBoardId?: string;
  columnMapping?: VoiceMondayColumnMapping;
};

type MondayItem = {
  id: string;
  name: string;
  column_values?: { id: string; text?: string | null; value?: string | null }[];
};

type MondayUpdate = {
  id: string;
  body?: string | null;
  created_at?: string | null;
  creator_id?: string | null;
};

const parseDateMs = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

const valueFor = (
  item: MondayItem,
  columnId: string | undefined,
): string | undefined => {
  if (!columnId) return undefined;
  const col = item.column_values?.find((c) => c.id === columnId);
  return col?.text ?? undefined;
};

const mapItemToContact = (
  item: MondayItem,
  mapping: VoiceMondayColumnMapping,
): CRMContact => {
  const email = valueFor(item, mapping.email);
  const phone = valueFor(item, mapping.phone);
  return {
    emails: email ? [{ address: email, primary: true }] : [],
    id: item.id,
    phones: phone ? [{ label: "work", number: phone }] : [],
    vendor: VENDOR,
    fullName: item.name,
    ...(valueFor(item, mapping.firstName)
      ? { firstName: valueFor(item, mapping.firstName) }
      : {}),
    ...(valueFor(item, mapping.lastName)
      ? { lastName: valueFor(item, mapping.lastName) }
      : {}),
    ...(valueFor(item, mapping.jobTitle)
      ? { jobTitle: valueFor(item, mapping.jobTitle) }
      : {}),
  };
};

const mapItemToDeal = (
  item: MondayItem,
  mapping: VoiceMondayColumnMapping,
): CRMDeal => {
  const amountText = valueFor(item, mapping.dealAmount);
  const amount = amountText !== undefined ? Number(amountText) : undefined;
  const stage = valueFor(item, mapping.dealStage);
  const closeAt = parseDateMs(valueFor(item, mapping.dealCloseDate));
  return {
    id: item.id,
    status: "open",
    title: item.name,
    vendor: VENDOR,
    ...(amount !== undefined && !Number.isNaN(amount) ? { amount } : {}),
    ...(stage ? { stageId: stage } : {}),
    ...(closeAt !== undefined ? { expectedCloseAt: closeAt } : {}),
  };
};

export const createMondayCRMAdapter = async (
  input: CreateMondayCRMAdapterOptions,
): Promise<CRMAdapter> => {
  const http = input.httpClient ?? createFetchCRMHttpClient();
  const mapping = input.columnMapping ?? {};
  const authHeaders = (): Record<string, string> => ({
    Authorization: input.accessToken,
    "API-Version": "2024-10",
    "Content-Type": "application/json",
  });

  const graphql = async <T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> => {
    const response = await http<{ data: T; errors?: { message: string }[] }>({
      body: { query, variables },
      headers: authHeaders(),
      method: "POST",
      url: "https://api.monday.com/v2",
    });
    const payload = assertHttpOk(response, "monday GraphQL");
    if (payload.errors && payload.errors.length > 0) {
      throw new Error(
        `monday GraphQL error: ${payload.errors.map((e) => e.message).join("; ")}`,
      );
    }
    return payload.data;
  };

  const buildColumnValuesJson = (
    fields: Record<string, string | number | undefined>,
  ): string => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === "") continue;
      const columnId = mapping[key as keyof VoiceMondayColumnMapping];
      if (!columnId) continue;
      out[columnId] = String(value);
    }
    return JSON.stringify(out);
  };

  const findByColumnValue = async (
    columnId: string,
    value: string,
  ): Promise<MondayItem | null> => {
    const query = `query($boardId: ID!, $columnId: String!, $value: String!) {
      items_page_by_column_values(
        board_id: $boardId,
        columns: [{ column_id: $columnId, column_values: [$value] }],
        limit: 1
      ) {
        items { id name column_values { id text value } }
      }
    }`;
    const result = await graphql<{
      items_page_by_column_values: { items: MondayItem[] };
    }>(query, {
      boardId: input.contactsBoardId,
      columnId,
      value,
    });
    return result.items_page_by_column_values.items[0] ?? null;
  };

  const listItemsPage = async (
    boardId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<{ items: MondayItem[]; nextCursor?: string }> => {
    if (cursor) {
      const query = `query($limit: Int!, $cursor: String!) {
        next_items_page(limit: $limit, cursor: $cursor) {
          cursor
          items { id name column_values { id text value } }
        }
      }`;
      const result = await graphql<{
        next_items_page: { cursor: string | null; items: MondayItem[] };
      }>(query, { cursor, limit });
      const next = result.next_items_page.cursor;
      return {
        items: result.next_items_page.items,
        ...(next ? { nextCursor: next } : {}),
      };
    }
    const query = `query($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          cursor
          items { id name column_values { id text value } }
        }
      }
    }`;
    const result = await graphql<{
      boards: { items_page: { cursor: string | null; items: MondayItem[] } }[];
    }>(query, { boardId, limit });
    const page = result.boards[0]?.items_page;
    const next = page?.cursor ?? null;
    return {
      items: page?.items ?? [],
      ...(next ? { nextCursor: next } : {}),
    };
  };

  const getUpdateById = async (id: string): Promise<MondayUpdate | null> => {
    const query = `query($ids: [ID!]) {
      updates(ids: $ids) { id body created_at creator_id }
    }`;
    const result = await graphql<{ updates: MondayUpdate[] }>(query, {
      ids: [id],
    });
    return result.updates[0] ?? null;
  };

  const deleteUpdate = async (id: string): Promise<void> => {
    const query = `mutation($id: ID!) { delete_update(id: $id) { id } }`;
    await graphql<{ delete_update: { id: string } | null }>(query, { id });
  };

  return {
    async addNote(noteInput) {
      const itemId = noteInput.contactIds?.[0] ?? noteInput.dealId;
      if (!itemId) {
        throw new Error("monday note requires contactIds[0] or dealId");
      }
      const query = `mutation($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }`;
      const result = await graphql<{ create_update: { id: string } }>(query, {
        body: noteInput.body,
        itemId,
      });
      return {
        body: noteInput.body,
        id: result.create_update.id,
        vendor: VENDOR,
        ...(noteInput.contactIds !== undefined
          ? { contactIds: noteInput.contactIds }
          : {}),
        ...(noteInput.dealId !== undefined ? { dealId: noteInput.dealId } : {}),
        ...(noteInput.accountId !== undefined
          ? { accountId: noteInput.accountId }
          : {}),
        ...(noteInput.ownerId !== undefined ? { ownerId: noteInput.ownerId } : {}),
      };
    },
    capabilities: MONDAY_CAPABILITIES,
    async createAccount() {
      throw new Error(
        "monday has no first-class Account/Company entity; createAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async createContact(contactInput) {
      const joined = [contactInput.firstName, contactInput.lastName]
        .filter(Boolean)
        .join(" ");
      const name =
        contactInput.fullName ??
        (joined || contactInput.emails[0]?.address || "Unknown contact");
      const columnValues = buildColumnValuesJson({
        email: contactInput.emails[0]?.address,
        firstName: contactInput.firstName,
        jobTitle: contactInput.jobTitle,
        lastName: contactInput.lastName,
        phone: contactInput.phones[0]?.number,
      });
      const query = `mutation($boardId: ID!, $name: String!, $values: JSON) {
        create_item(board_id: $boardId, item_name: $name, column_values: $values) { id name }
      }`;
      const result = await graphql<{ create_item: MondayItem }>(query, {
        boardId: input.contactsBoardId,
        name,
        values: columnValues,
      });
      return { ...contactInput, id: result.create_item.id, vendor: VENDOR };
    },
    async createDeal(dealInput) {
      const boardId = input.dealsBoardId;
      if (!boardId) {
        throw new Error("monday deals require dealsBoardId at adapter setup");
      }
      const columnValues = buildColumnValuesJson({
        dealAmount: dealInput.amount,
        dealCloseDate: dealInput.expectedCloseAt
          ? new Date(dealInput.expectedCloseAt).toISOString().slice(0, 10)
          : undefined,
        dealStage: dealInput.stageId,
      });
      const query = `mutation($boardId: ID!, $name: String!, $values: JSON) {
        create_item(board_id: $boardId, item_name: $name, column_values: $values) { id name }
      }`;
      const result = await graphql<{ create_item: MondayItem }>(query, {
        boardId,
        name: dealInput.title,
        values: columnValues,
      });
      return { ...dealInput, id: result.create_item.id, vendor: VENDOR };
    },
    async createLead(leadInput) {
      const joined = [leadInput.firstName, leadInput.lastName]
        .filter(Boolean)
        .join(" ");
      const leadName =
        joined || leadInput.emails[0]?.address || "Unknown lead";
      const leadColumnValues = buildColumnValuesJson({
        email: leadInput.emails[0]?.address,
        firstName: leadInput.firstName,
        jobTitle: leadInput.jobTitle,
        lastName: leadInput.lastName,
        phone: leadInput.phones[0]?.number,
      });
      const leadQuery = `mutation($boardId: ID!, $name: String!, $values: JSON) {
        create_item(board_id: $boardId, item_name: $name, column_values: $values) { id name }
      }`;
      const leadResult = await graphql<{ create_item: MondayItem }>(leadQuery, {
        boardId: input.contactsBoardId,
        name: leadName,
        values: leadColumnValues,
      });
      return {
        ...leadInput,
        id: leadResult.create_item.id,
        vendor: VENDOR,
      } satisfies CRMLead;
    },
    async createTask(taskInput) {
      const itemId = taskInput.contactIds?.[0];
      if (!itemId) {
        throw new Error("monday task requires contactIds[0] to create an update");
      }
      const query = `mutation($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }`;
      const result = await graphql<{ create_update: { id: string } }>(query, {
        body: `Task: ${taskInput.subject}${taskInput.description ? `\n${taskInput.description}` : ""}`,
        itemId,
      });
      return { ...taskInput, id: result.create_update.id, vendor: VENDOR };
    },
    async deleteAccount() {
      // No Account entity on monday (supportsAccounts: false) → no-op void.
    },
    async deleteContact(id) {
      const query = `mutation($itemId: ID!) {
        delete_item(item_id: $itemId) { id }
      }`;
      await graphql<{ delete_item: { id: string } | null }>(query, {
        itemId: id,
      });
    },
    async deleteDeal(id) {
      const query = `mutation($itemId: ID!) {
        delete_item(item_id: $itemId) { id }
      }`;
      await graphql<{ delete_item: { id: string } | null }>(query, {
        itemId: id,
      });
    },
    async deleteLead(id) {
      // monday models leads as items on the contacts board, so deleting a lead
      // is deleting the backing item.
      const query = `mutation($itemId: ID!) {
        delete_item(item_id: $itemId) { id }
      }`;
      await graphql<{ delete_item: { id: string } | null }>(query, {
        itemId: id,
      });
    },
    async deleteNote(id) {
      await deleteUpdate(id);
    },
    async deleteTask(id) {
      await deleteUpdate(id);
    },
    async getAccount() {
      // No Account entity on monday (supportsAccounts: false) → no-op null.
      return null;
    },
    async getActivity(id) {
      const update = await getUpdateById(id);
      if (!update) return null;
      return {
        id: update.id,
        occurredAt: parseDateMs(update.created_at) ?? Date.now(),
        type: "other",
        vendor: VENDOR,
        ...(update.body ? { body: update.body } : {}),
        ...(update.creator_id ? { ownerId: update.creator_id } : {}),
      };
    },
    async getContact(id) {
      const query = `query($id: [ID!]!) {
        items(ids: $id) { id name column_values { id text value } }
      }`;
      const result = await graphql<{ items: MondayItem[] }>(query, {
        id: [id],
      });
      const item = result.items[0];
      return item ? mapItemToContact(item, mapping) : null;
    },
    async getDeal(id) {
      const query = `query($id: [ID!]!) {
        items(ids: $id) { id name column_values { id text value } }
      }`;
      const result = await graphql<{ items: MondayItem[] }>(query, {
        id: [id],
      });
      const item = result.items[0];
      return item ? mapItemToDeal(item, mapping) : null;
    },
    async getLead(id) {
      // Leads are items on the contacts board; map the backing item to a lead.
      const query = `query($id: [ID!]!) {
        items(ids: $id) { id name column_values { id text value } }
      }`;
      const result = await graphql<{ items: MondayItem[] }>(query, {
        id: [id],
      });
      const item = result.items[0];
      if (!item) return null;
      const email = valueFor(item, mapping.email);
      const phone = valueFor(item, mapping.phone);
      return {
        emails: email ? [{ address: email, primary: true }] : [],
        id: item.id,
        phones: phone ? [{ label: "work", number: phone }] : [],
        vendor: VENDOR,
        ...(valueFor(item, mapping.firstName)
          ? { firstName: valueFor(item, mapping.firstName) }
          : {}),
        ...(valueFor(item, mapping.lastName)
          ? { lastName: valueFor(item, mapping.lastName) }
          : {}),
        ...(valueFor(item, mapping.jobTitle)
          ? { jobTitle: valueFor(item, mapping.jobTitle) }
          : {}),
        ...(valueFor(item, mapping.company)
          ? { company: valueFor(item, mapping.company) }
          : {}),
      };
    },
    async getNote(id) {
      const update = await getUpdateById(id);
      if (!update) return null;
      return {
        body: update.body ?? "",
        id: update.id,
        vendor: VENDOR,
        ...(update.creator_id ? { ownerId: update.creator_id } : {}),
        ...(parseDateMs(update.created_at) !== undefined
          ? { createdAt: parseDateMs(update.created_at) }
          : {}),
      };
    },
    async getPipeline(): Promise<CRMPipeline | null> {
      // monday has no pipeline entity (supportsPipelines: false).
      return null;
    },
    async getTask(id) {
      const update = await getUpdateById(id);
      if (!update) return null;
      return {
        id: update.id,
        subject: update.body ?? "",
        vendor: VENDOR,
        ...(update.creator_id ? { ownerId: update.creator_id } : {}),
      };
    },
    async listAccounts() {
      // No Account entity on monday (supportsAccounts: false) → empty page.
      return { items: [] };
    },
    async listContacts(opts) {
      const page = await listItemsPage(
        input.contactsBoardId,
        opts?.limit ?? 25,
        opts?.cursor,
      );
      return {
        items: page.items.map((item) => mapItemToContact(item, mapping)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    async listDeals(opts) {
      if (!input.dealsBoardId) return { items: [] };
      const page = await listItemsPage(
        input.dealsBoardId,
        opts?.limit ?? 25,
        opts?.cursor,
      );
      return {
        items: page.items.map((item) => mapItemToDeal(item, mapping)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    async listLeads() {
      // No first-class lead entity to enumerate (supportsLeads: false); leads
      // live as items on the contacts board and are not separable.
      return { items: [] };
    },
    async listPipelines(): Promise<CRMPipeline[]> {
      return [];
    },
    async logActivity(activityInput) {
      const itemId = activityInput.contactIds?.[0] ?? activityInput.dealId;
      if (!itemId) {
        throw new Error("monday call activity requires contactIds[0] or dealId");
      }
      const body = `📞 ${activityInput.subject ?? "Voice call"}\n${activityInput.body ?? ""}${activityInput.durationSeconds ? `\nDuration: ${activityInput.durationSeconds}s` : ""}`;
      const query = `mutation($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }`;
      const result = await graphql<{ create_update: { id: string } }>(query, {
        body,
        itemId,
      });
      return { ...activityInput, id: result.create_update.id, vendor: VENDOR };
    },
    async lookupContactByEmail(email) {
      if (!mapping.email) return null;
      const item = await findByColumnValue(mapping.email, email);
      return item ? mapItemToContact(item, mapping) : null;
    },
    async lookupContactByPhone(phone) {
      if (!mapping.phone) return null;
      const item = await findByColumnValue(mapping.phone, phone);
      return item ? mapItemToContact(item, mapping) : null;
    },
    async searchContacts(query, limit = 10) {
      const gql = `query($boardId: ID!, $limit: Int!) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit) {
            items { id name column_values { id text value } }
          }
        }
      }`;
      const result = await graphql<{
        boards: { items_page: { items: MondayItem[] } }[];
      }>(gql, { boardId: input.contactsBoardId, limit });
      const items = result.boards[0]?.items_page.items ?? [];
      const needle = query.toLowerCase();
      return items
        .filter((item) =>
          item.name.toLowerCase().includes(needle) ||
          (valueFor(item, mapping.email)?.toLowerCase().includes(needle) ?? false),
        )
        .map((item) => mapItemToContact(item, mapping));
    },
    async updateAccount() {
      throw new Error(
        "monday has no first-class Account/Company entity; updateAccount is unsupported (capabilities.supportsAccounts=false)",
      );
    },
    async updateActivity() {
      throw new Error(
        "monday activities are immutable via the API (no edit mutation), so updateActivity is unsupported",
      );
    },
    async updateContact(id, patch) {
      const values = buildColumnValuesJson({
        email: patch.emails?.[0]?.address,
        firstName: patch.firstName,
        jobTitle: patch.jobTitle,
        lastName: patch.lastName,
        phone: patch.phones?.[0]?.number,
      });
      if (values !== "{}") {
        const query = `mutation($boardId: ID!, $itemId: ID!, $values: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
        }`;
        await graphql<{ change_multiple_column_values: MondayItem }>(query, {
          boardId: input.contactsBoardId,
          itemId: id,
          values,
        });
      }
      const refreshQuery = `query($id: [ID!]!) {
        items(ids: $id) { id name column_values { id text value } }
      }`;
      const refreshed = await graphql<{ items: MondayItem[] }>(refreshQuery, {
        id: [id],
      });
      const item = refreshed.items[0];
      if (!item) {
        throw new Error(`monday contact ${id} not found after update`);
      }
      return mapItemToContact(item, mapping);
    },
    async updateDeal(id, patch) {
      if (!input.dealsBoardId) {
        throw new Error("monday deals require dealsBoardId at adapter setup");
      }
      const values = buildColumnValuesJson({
        dealAmount: patch.amount,
        dealCloseDate: patch.expectedCloseAt
          ? new Date(patch.expectedCloseAt).toISOString().slice(0, 10)
          : undefined,
        dealStage: patch.stageId,
      });
      if (values !== "{}") {
        const query = `mutation($boardId: ID!, $itemId: ID!, $values: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
        }`;
        await graphql<{ change_multiple_column_values: MondayItem }>(query, {
          boardId: input.dealsBoardId,
          itemId: id,
          values,
        });
      }
      return {
        id,
        title: patch.title ?? "",
        vendor: VENDOR,
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.stageId !== undefined ? { stageId: patch.stageId } : {}),
        status: "open",
      };
    },
    async updateLead(id, patch) {
      // Leads are items on the contacts board; update the backing item's
      // mapped columns, then echo the patched lead shape.
      const values = buildColumnValuesJson({
        company: patch.company,
        email: patch.emails?.[0]?.address,
        firstName: patch.firstName,
        jobTitle: patch.jobTitle,
        lastName: patch.lastName,
        phone: patch.phones?.[0]?.number,
      });
      if (values !== "{}") {
        const query = `mutation($boardId: ID!, $itemId: ID!, $values: JSON!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $values) { id }
        }`;
        await graphql<{ change_multiple_column_values: MondayItem }>(query, {
          boardId: input.contactsBoardId,
          itemId: id,
          values,
        });
      }
      return {
        emails: patch.emails ?? [],
        id,
        phones: patch.phones ?? [],
        vendor: VENDOR,
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.company !== undefined ? { company: patch.company } : {}),
        ...(patch.jobTitle !== undefined ? { jobTitle: patch.jobTitle } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.estimatedValue !== undefined
          ? { estimatedValue: patch.estimatedValue }
          : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.customFields !== undefined
          ? { customFields: patch.customFields }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.createdAt !== undefined ? { createdAt: patch.createdAt } : {}),
        ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
      };
    },
    async updateNote() {
      throw new Error(
        "monday notes are immutable via the API (no edit mutation), so updateNote is unsupported",
      );
    },
    async updateTask() {
      throw new Error(
        "monday tasks are immutable via the API (no edit mutation), so updateTask is unsupported",
      );
    },
    vendor: VENDOR,
  };
};

export { mapItemToContact as mapMondayItemToContact };
