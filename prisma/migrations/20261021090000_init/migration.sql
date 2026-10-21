-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'STOREKEEPER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('QUOTATION', 'SALES_ORDER', 'INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DELIVERY_NOTE', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'STOCK_ADJUSTMENT', 'JOURNAL_ENTRY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "document_email" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "product_scope" TEXT NOT NULL,
    "kra_pin" TEXT,
    "physical_address" TEXT,
    "postal_address" TEXT,
    "payment_instructions" TEXT,
    "invoice_terms" TEXT,
    "default_payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "document_type" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("document_type")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_file" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "columns" TEXT[],
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" UUID,

    CONSTRAINT "legacy_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_rows" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "legacy_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_import_batches_source_file_file_sha256_key" ON "legacy_import_batches"("source_file", "file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_rows_batch_id_row_number_key" ON "legacy_rows"("batch_id", "row_number");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_import_batches" ADD CONSTRAINT "legacy_import_batches_imported_by_id_fkey" FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_rows" ADD CONSTRAINT "legacy_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "legacy_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written rules Prisma cannot express ────────────────────

-- Company settings is a single row.
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_singleton_chk" CHECK ("id" = 1);
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_payment_terms_chk" CHECK ("default_payment_terms_days" BETWEEN 0 AND 365);

-- Sequences never go backwards or below 1.
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_next_number_chk" CHECK ("next_number" >= 1);
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_padding_chk" CHECK ("padding" BETWEEN 1 AND 12);

-- A deactivated user must record when; an active one must not.
ALTER TABLE "users" ADD CONSTRAINT "users_deactivation_chk" CHECK (("is_active" AND "deactivated_at" IS NULL) OR (NOT "is_active" AND "deactivated_at" IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

-- The audit log is append-only: updates and deletes are rejected.
CREATE FUNCTION "audit_log_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_no_update" BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_change"();
CREATE TRIGGER "audit_log_no_delete" BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_change"();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_reject_change"();

-- Supabase exposes the public schema through its Data API. Enabling row-level
-- security with no policies blocks the anon and authenticated keys entirely;
-- only the server (connecting as the database owner via Prisma) can read or write.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_rows" ENABLE ROW LEVEL SECURITY;
