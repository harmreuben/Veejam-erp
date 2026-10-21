import "server-only";

/**
 * FormData → plain object. Fields named like "lines.0.productId" become nested
 * arrays/objects, so line-item forms work without JavaScript-built JSON.
 */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const value = typeof raw === "string" ? raw : raw;
    const parts = key.split(".");
    let node: Record<string, unknown> | unknown[] = out;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]!);
      const k: string | number = /^\d+$/.test(part) ? Number(part) : part;
      const container = node as Record<string | number, unknown>;
      if (last) {
        container[k] = value;
      } else {
        container[k] ??= nextIsIndex ? [] : {};
        node = container[k] as Record<string, unknown> | unknown[];
      }
    });
  }
  // Drop holes left by removed lines (e.g. lines 0 and 2 present, 1 removed).
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) out[k] = v.filter((x) => x !== undefined);
  return out;
}
