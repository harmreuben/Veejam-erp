-- Owners and admins can delete invoices and payments. Deleting undoes
-- everything they did (stock, ledger, allocations) and hides them; the rows
-- stay, frozen, for the record and the audit trail.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "deleted_by_id" UUID;

-- AlterTable
ALTER TABLE "sales_documents" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "deleted_by_id" UUID;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules the database enforces ─────────────────────────────────────

-- A deleted invoice is a cancelled invoice with who/when; nothing else can be "deleted".
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_deleted_chk" CHECK (
  ("deleted_at" IS NULL) = ("deleted_by_id" IS NULL) AND
  ("deleted_at" IS NULL OR ("kind"::text = 'INVOICE' AND "status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL))
);
-- A deleted invoice that had been posted keeps its number, so numbers never vanish.
ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_number_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_number_chk" CHECK (
  ("kind"::text <> 'INVOICE' AND "number" IS NOT NULL) OR
  ("kind"::text = 'INVOICE' AND "status" = 'POSTED' AND "number" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL) OR
  ("kind"::text = 'INVOICE' AND "status" <> 'POSTED' AND "number" IS NULL AND "posted_at" IS NULL) OR
  ("kind"::text = 'INVOICE' AND "status" = 'CANCELLED' AND "deleted_at" IS NOT NULL AND
    "number" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL)
);
ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_historical_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_historical_chk" CHECK (
  NOT "historical" OR ("kind"::text = 'INVOICE' AND ("status" = 'POSTED' OR "deleted_at" IS NOT NULL))
);

ALTER TABLE "payments" ADD CONSTRAINT "payments_deleted_chk" CHECK (
  ("deleted_at" IS NULL) = ("deleted_by_id" IS NULL) AND
  ("deleted_at" IS NULL OR "status" = 'REVERSED')
);

-- Posted invoices and credit notes stay final, with one exception: an owner or
-- admin deleting a posted invoice (status → CANCELLED with deleted_at). After
-- that the row is frozen for good.
CREATE OR REPLACE FUNCTION "sales_documents_protect_posted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (OLD."kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND OLD."status" = 'POSTED') OR OLD."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'posted or deleted document % cannot be deleted', OLD."number"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'deleted document % cannot be changed', OLD."number"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND OLD."status" = 'POSTED' THEN
    IF OLD."kind"::text = 'INVOICE' AND NEW."status" = 'CANCELLED' AND NEW."deleted_at" IS NOT NULL AND
       (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_reason' - 'deleted_at' - 'deleted_by_id'
                      - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') IS NOT DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_reason' - 'deleted_at' - 'deleted_by_id'
                      - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') IS DISTINCT FROM
       (to_jsonb(OLD) - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') THEN
      RAISE EXCEPTION 'posted document % cannot be changed', OLD."number"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "sales_document_lines_protect_posted"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  doc_ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN doc_ids := ARRAY[NEW."document_id"];
  ELSIF TG_OP = 'DELETE' THEN doc_ids := ARRAY[OLD."document_id"];
  ELSE doc_ids := ARRAY[OLD."document_id", NEW."document_id"];
  END IF;
  IF EXISTS (SELECT 1 FROM "sales_documents"
              WHERE "id" = ANY(doc_ids) AND "kind"::text IN ('INVOICE', 'CREDIT_NOTE')
                AND ("status" = 'POSTED' OR "deleted_at" IS NOT NULL)) THEN
    RAISE EXCEPTION 'lines of a posted invoice or credit note (or a deleted invoice) cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- A deleted payment is frozen.
CREATE FUNCTION "payments_protect_deleted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment % cannot be deleted', OLD."number" USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'deleted payment % cannot be changed', OLD."number" USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payments_protect_deleted" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_protect_deleted"();

-- A deleted payment's M-Pesa/cheque reference is renamed "CODE (deleted RCT-…)"
-- so the same code can be entered again correctly; the original stays readable.
ALTER TABLE "payments" DROP CONSTRAINT "payments_mpesa_reference_chk";
ALTER TABLE "payments" ADD CONSTRAINT "payments_mpesa_reference_chk" CHECK (
  "method" <> 'MPESA' OR "reference" ~ '^[A-Z0-9]{10}$' OR "deleted_at" IS NOT NULL
);
