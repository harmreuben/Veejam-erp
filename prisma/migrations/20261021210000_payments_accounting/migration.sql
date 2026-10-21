-- Phase 5a: chart of accounts, journal, payments, allocations, credit notes.

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_IN';

-- AlterEnum
ALTER TYPE "SalesDocumentKind" ADD VALUE 'CREDIT_NOTE';

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "books_closed_until" DATE;

-- AlterTable
ALTER TABLE "sales_documents" ADD COLUMN     "amount_credited" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "returns_to_stock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "system_key" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_number" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" BIGSERIAL NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "customer_id" UUID,
    "description" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT NOT NULL,
    "received_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reverse_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "payment_id" UUID,
    "credit_note_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_idempotency_key_key" ON "sales_documents"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_system_key_key" ON "accounts"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_source_type_source_id_key" ON "journal_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "journal_lines_customer_id_idx" ON "journal_lines"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_number_key" ON "payments"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_customer_id_received_on_idx" ON "payments"("customer_id", "received_on");

-- CreateIndex
CREATE UNIQUE INDEX "payments_method_reference_key" ON "payments"("method", "reference");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_credit_note_id_idx" ON "payment_allocations"("credit_note_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules Prisma can't express ──────────────────────────────────

-- Returns put stock back. ("type"::text so the new value can be named in this transaction.)
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_quantity_sign_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_sign_chk" CHECK (
  ("type"::text IN ('ADJUSTMENT_IN', 'TRANSFER_IN', 'COUNT_GAIN', 'RETURN_IN') AND "quantity" > 0) OR
  ("type"::text IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'COUNT_LOSS', 'SALE') AND "quantity" < 0)
);

-- Credit notes are written and posted in one transaction (DRAFT only exists inside it), always against an invoice.
ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_kind_status_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_kind_status_chk" CHECK (
  ("kind"::text = 'QUOTATION' AND "status" IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'CANCELLED')) OR
  ("kind"::text = 'SALES_ORDER' AND "status" IN ('DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED')) OR
  ("kind"::text = 'INVOICE' AND "status" IN ('DRAFT', 'POSTED', 'CANCELLED')) OR
  ("kind"::text = 'CREDIT_NOTE' AND "status" IN ('DRAFT', 'POSTED') AND "source_document_id" IS NOT NULL AND
    ("status" <> 'POSTED' OR ("posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL)))
);
ALTER TABLE "sales_documents" DROP CONSTRAINT "sales_documents_amounts_chk";
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_amounts_chk" CHECK (
  "subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "total" >= 0 AND
  "amount_paid" >= 0 AND "amount_credited" >= 0 AND "amount_paid" + "amount_credited" <= "total"
);

-- Posted invoices and credit notes are final. Only the settled amounts (and bookkeeping
-- columns) may change on an invoice; credit notes never change.
CREATE OR REPLACE FUNCTION "sales_documents_protect_posted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'posted document % cannot be deleted', OLD."number"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND OLD."status" = 'POSTED' AND
     (to_jsonb(NEW) - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') IS DISTINCT FROM
     (to_jsonb(OLD) - 'amount_paid' - 'amount_credited' - 'updated_at' - 'version') THEN
    RAISE EXCEPTION 'posted document % cannot be changed', OLD."number"
      USING ERRCODE = 'insufficient_privilege';
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
              WHERE "id" = ANY(doc_ids) AND "kind"::text IN ('INVOICE', 'CREDIT_NOTE') AND "status" = 'POSTED') THEN
    RAISE EXCEPTION 'lines of a posted invoice or credit note cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_code_chk" CHECK ("code" ~ '^[0-9]{4}$');

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_chk" CHECK (
  "debit" >= 0 AND "credit" >= 0 AND ("debit" > 0) <> ("credit" > 0)
);

-- Every journal entry balances: checked when the transaction commits, so all lines
-- of an entry are written first.
CREATE FUNCTION "journal_entries_check_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d NUMERIC;
  c NUMERIC;
  n INTEGER;
BEGIN
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO d, c, n FROM "journal_lines" WHERE "entry_id" = NEW."entry_id";
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'journal entry % does not balance (debits %, credits %, lines %)', NEW."entry_id", d, c, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_entries_check_balanced"();

-- The journal is append-only.
CREATE FUNCTION "journal_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the journal is append-only (% on % blocked)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "journal_entries_no_update" BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "journal_reject_change"();
CREATE TRIGGER "journal_entries_no_truncate" BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "journal_reject_change"();
CREATE TRIGGER "journal_lines_no_update" BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "journal_reject_change"();
CREATE TRIGGER "journal_lines_no_truncate" BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "journal_reject_change"();

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_chk" CHECK (
  ("status" = 'REVERSED') = ("reversed_at" IS NOT NULL) AND
  ("status" = 'REVERSED') = ("reverse_reason" IS NOT NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_mpesa_reference_chk" CHECK (
  "method" <> 'MPESA' OR "reference" ~ '^[A-Z0-9]{10}$'
);

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_chk" CHECK (
  ("payment_id" IS NULL) <> ("credit_note_id" IS NULL)
);

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
