import "server-only";

import { param } from "@/components/filters";
import type { DayRange } from "@/lib/dates";
import { ValidationError } from "@/server/errors";
import { readRange } from "@/server/modules/reports/service";

/** The date range from the URL, or the error to show instead of the report. */
export function rangeFrom(
  sp: Record<string, string | string[] | undefined>,
  fallback?: DayRange,
): { range: DayRange; error: string | null } {
  try {
    return { range: readRange({ from: param(sp.from), to: param(sp.to) }, fallback), error: null };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { range: readRange({}, fallback), error: Object.values(e.fieldErrors).flat().join(" ") };
    }
    throw e;
  }
}
