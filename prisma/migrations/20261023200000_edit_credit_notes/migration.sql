-- Owners and admins can correct or delete a credit note. The credit note is
-- undone (credit, stock, ledger) and kept, cancelled and frozen, for the record;
-- a correction is a new credit note that points at the one it replaces.

-- AlterTable
ALTER TABLE "sales_documents" ADD COLUMN     "replaces_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_replaces_id_key" ON "sales_documents"("replaces_id");

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules the database enforces ─────────────────────────────────────

-- Only a credit note replaces another credit note.
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_replaces_chk" CHECK (
  "replaces_id" IS NULL OR ("kind"::text = 'CREDIT_NOTE' AND "replaces_id" <> "id")
);

-- A credit note can now be cancelled, but only by being deleted.
ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_kind_status_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_kind_status_chk" CHECK (
  ("kind"::text = 'QUOTATION' AND "status" IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'CANCELLED')) OR
  ("kind"::text = 'SALES_ORDER' AND "status" IN ('DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED')) OR
  ("kind"::text = 'INVOICE' AND "status" IN ('DRAFT', 'POSTED', 'CANCELLED')) OR
  ("kind"::text = 'CREDIT_NOTE' AND "status" IN ('DRAFT', 'POSTED', 'CANCELLED') AND "source_document_id" IS NOT NULL AND
    ("status" <> 'POSTED' OR ("posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL)) AND
    ("status" <> 'CANCELLED' OR ("deleted_at" IS NOT NULL AND "posted_at" IS NOT NULL)))
);

ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_deleted_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_deleted_chk" CHECK (
  ("deleted_at" IS NULL) = ("deleted_by_id" IS NULL) AND
  ("deleted_at" IS NULL OR ("kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND "status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL))
);

-- Posted invoices and credit notes stay final, with one exception: an owner or
-- admin deleting one (status → CANCELLED with deleted_at). After that the row
-- is frozen for good.
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
    IF NEW."status" = 'CANCELLED' AND NEW."deleted_at" IS NOT NULL AND
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
