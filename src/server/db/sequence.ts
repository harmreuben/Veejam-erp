import "server-only";

import type { DocumentType } from "@/generated/prisma/enums";
import type { DbOrTx } from "@/server/db/client";

/**
 * Take the next number for a document type, e.g. "ADJ-000042".
 *
 * A single UPDATE … RETURNING increments and reads in one step under a row
 * lock, so two people posting at the same moment always get different numbers.
 * Call it inside the transaction that creates the document: if that
 * transaction rolls back, the number is released too, so there are no gaps.
 */
export async function nextNumber(tx: DbOrTx, type: DocumentType): Promise<string> {
  const rows = await tx.$queryRaw<{ prefix: string; n: number; padding: number }[]>`
    UPDATE document_sequences
       SET next_number = next_number + 1, updated_at = now()
     WHERE document_type = ${type}::"DocumentType"
 RETURNING prefix, next_number - 1 AS n, padding`;
  const row = rows[0];
  if (!row) throw new Error(`Document numbering for ${type} is missing. Run: npm run db:seed`);
  return `${row.prefix}${String(row.n).padStart(row.padding, "0")}`;
}
