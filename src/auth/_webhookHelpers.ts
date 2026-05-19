export const headerValue = (
  headers: Record<string, string | undefined>,
  ...names: string[]
): string | undefined => {
  for (const name of names) {
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (v !== undefined) return v;
  }
  return undefined;
};

export const timingSafeEqualString = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
