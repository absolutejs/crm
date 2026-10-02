import { expect, test } from "bun:test";
import { exportCRMContacts, type CRMAdapter, type CRMContact } from "../src";
test("export preserves CRM records and deduplicates a batch while limiting concurrency", async () => {
  let active = 0,
    peak = 0,
    creates = 0;
  const existing: CRMContact = {
    id: "existing",
    vendor: "hubspot",
    emails: [{ address: "exists@test.dev" }],
    phones: [],
  };
  const adapter = {
    async lookupContactByEmail(email: string) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return email === "exists@test.dev" ? existing : null;
    },
    async createContact(contact: Omit<CRMContact, "id" | "vendor">) {
      creates++;
      return { ...contact, id: "new", vendor: "hubspot" };
    },
  } as CRMAdapter;
  const items = ["exists@test.dev", "new@test.dev", "NEW@test.dev"].map(
    (email, index) => ({
      ref: String(index),
      contact: { emails: [{ address: email }], phones: [] },
    }),
  );
  const result = await exportCRMContacts(adapter, items, { concurrency: 2 });
  expect(creates).toBe(1);
  expect(peak).toBeLessThanOrEqual(2);
  expect(result[0]?.contact).toBe(existing);
  expect(result[1]?.contact?.id).toBe(result[2]?.contact?.id);
});
