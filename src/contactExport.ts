import type { CRMAdapter, CRMContact } from "./types";

/** Export without overwriting a CRM record that already exists. The host should
 * persist returned IDs for future updates; email lookup is only an initial match.
 * Queue-level idempotency is still required across workers/processes.
 */
export const exportCRMContacts = async <
  T extends { ref: string; contact: Omit<CRMContact, "id" | "vendor"> },
>(
  adapter: CRMAdapter,
  items: T[],
  options: { concurrency?: number } = {},
): Promise<{ ref: string; contact: CRMContact | null; error?: string }[]> => {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10)
    throw new Error("CRM export concurrency must be between 1 and 10");
  const byEmail = new Map<string, Promise<CRMContact>>();
  const results: { ref: string; contact: CRMContact | null; error?: string }[] =
    new Array(items.length);
  let next = 0;
  const exportOne = async (item: T) => {
    const email = item.contact.emails[0]?.address.trim().toLowerCase();
    if (!email) throw new Error("CRM contact export requires an email");
    let operation = byEmail.get(email);
    if (!operation) {
      operation = (async () => {
        const existing = await adapter.lookupContactByEmail(email);
        if (existing) return existing;
        try {
          return await adapter.createContact(item.contact);
        } catch (error) {
          // Another worker may have created this contact after our initial lookup.
          const raced = await adapter.lookupContactByEmail(email);
          if (raced) return raced;
          throw error;
        }
      })();
      byEmail.set(email, operation);
    }
    return operation;
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index]!;
        try {
          results[index] = { ref: item.ref, contact: await exportOne(item) };
        } catch {
          results[index] = {
            ref: item.ref,
            contact: null,
            error: "CRM export failed; check permissions and retry",
          };
        }
      }
    }),
  );
  return results;
};
