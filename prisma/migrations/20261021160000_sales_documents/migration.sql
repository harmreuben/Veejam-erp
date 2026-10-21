-- Phase 4: tax rates, quotations, sales orders, invoices, stock reservations,
-- delivery notes and share links.

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'SALE';

-- CreateEnum
CREATE TYPE "SalesDocumentKind" AS ENUM ('QUOTATION', 'SALES_ORDER', 'INVOICE');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'CONFIRMED', 'INVOICED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PREPARED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tax_rates" (
    "category" "TaxCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "sales_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "SalesDocumentKind" NOT NULL,
    "number" TEXT,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "price_list_id" UUID,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "issue_date" DATE NOT NULL,
    "valid_until" DATE,
    "due_date" DATE,
    "customer_reference" TEXT,
    "notes" TEXT,
    "source_document_id" UUID,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "company_snapshot" JSONB,
    "customer_snapshot" JSONB,
    "credit_override_reason" TEXT,
    "credit_override_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,

    CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" "SellUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pieces_per_unit" INTEGER NOT NULL,
    "pieces" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_category" "TaxCategory" NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PREPARED',
    "vehicle" TEXT,
    "driver" TEXT,
    "notes" TEXT,
    "dispatched_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "received_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_share_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "document_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_number_key" ON "sales_documents"("number");

-- CreateIndex
CREATE INDEX "sales_documents_kind_status_issue_date_idx" ON "sales_documents"("kind", "status", "issue_date");

-- CreateIndex
CREATE INDEX "sales_documents_customer_id_kind_status_idx" ON "sales_documents"("customer_id", "kind", "status");

-- CreateIndex
CREATE INDEX "sales_document_lines_product_id_idx" ON "sales_document_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_document_lines_document_id_position_key" ON "sales_document_lines"("document_id", "position");

-- CreateIndex
CREATE INDEX "stock_reservations_product_id_warehouse_id_idx" ON "stock_reservations"("product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_document_id_product_id_warehouse_id_key" ON "stock_reservations"("document_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_number_key" ON "delivery_notes"("number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_invoice_id_key" ON "delivery_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "delivery_notes_status_created_at_idx" ON "delivery_notes"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_share_links_token_hash_key" ON "document_share_links"("token_hash");

-- CreateIndex
CREATE INDEX "document_share_links_document_id_idx" ON "document_share_links"("document_id");

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_credit_override_by_id_fkey" FOREIGN KEY ("credit_override_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sales_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_share_links" ADD CONSTRAINT "document_share_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_share_links" ADD CONSTRAINT "document_share_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules Prisma can't express ──────────────────────────────────

-- Sales now remove stock. ("type"::text so the new enum value can be named
-- in the same transaction that adds it.)
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_quantity_sign_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_sign_chk" CHECK (
  ("type"::text IN ('ADJUSTMENT_IN', 'TRANSFER_IN', 'COUNT_GAIN') AND "quantity" > 0) OR
  ("type"::text IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'COUNT_LOSS', 'SALE') AND "quantity" < 0)
);

ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_chk" CHECK ("rate" >= 0 AND "rate" <= 100);

-- Each kind of document uses only its own statuses.
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_kind_status_chk" CHECK (
  ("kind" = 'QUOTATION' AND "status" IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'CANCELLED')) OR
  ("kind" = 'SALES_ORDER' AND "status" IN ('DRAFT', 'CONFIRMED', 'INVOICED', 'CANCELLED')) OR
  ("kind" = 'INVOICE' AND "status" IN ('DRAFT', 'POSTED', 'CANCELLED'))
);
-- Quotes and orders are numbered at creation; invoices only when posted.
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_number_chk" CHECK (
  ("kind" <> 'INVOICE' AND "number" IS NOT NULL) OR
  ("kind" = 'INVOICE' AND "status" = 'POSTED' AND "number" IS NOT NULL AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL) OR
  ("kind" = 'INVOICE' AND "status" <> 'POSTED' AND "number" IS NULL AND "posted_at" IS NULL)
);
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_amounts_chk" CHECK (
  "subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "total" >= 0 AND
  "amount_paid" >= 0 AND "amount_paid" <= "total"
);
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_cancel_chk" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
);
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_credit_override_chk" CHECK (
  ("credit_override_by_id" IS NULL) = ("credit_override_reason" IS NULL)
);
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_dates_chk" CHECK (
  ("valid_until" IS NULL OR "valid_until" >= "issue_date") AND
  ("due_date" IS NULL OR "due_date" >= "issue_date")
);

ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_amounts_chk" CHECK (
  "position" >= 1 AND "quantity" > 0 AND "pieces_per_unit" >= 1 AND
  "pieces" = "quantity" * "pieces_per_unit" AND
  "unit_price" >= 0 AND "discount_percent" >= 0 AND "discount_percent" <= 100 AND
  "tax_rate" >= 0 AND "net_amount" >= 0 AND "discount_amount" >= 0 AND "tax_amount" >= 0 AND
  "gross_amount" = "net_amount" + "tax_amount"
);

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_chk" CHECK ("quantity" > 0);

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_status_dates_chk" CHECK (
  ("status" IN ('DISPATCHED', 'DELIVERED')) <= ("dispatched_at" IS NOT NULL) AND
  ("status" = 'DELIVERED') = ("delivered_at" IS NOT NULL)
);

ALTER TABLE "document_share_links" ADD CONSTRAINT "document_share_links_expiry_chk" CHECK ("expires_at" > "created_at");

-- A posted invoice is final. Only the amount paid (Phase 5 payments) and the
-- bookkeeping columns may change; it can't be deleted, and its lines can't be
-- added, changed or removed. Corrections are credit notes (Phase 5).
CREATE FUNCTION "sales_documents_protect_posted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."kind" = 'INVOICE' AND OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'posted invoice % cannot be deleted', OLD."number"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."kind" = 'INVOICE' AND OLD."status" = 'POSTED' AND
     (to_jsonb(NEW) - 'amount_paid' - 'updated_at' - 'version') IS DISTINCT FROM
     (to_jsonb(OLD) - 'amount_paid' - 'updated_at' - 'version') THEN
    RAISE EXCEPTION 'posted invoice % cannot be changed', OLD."number"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sales_documents_protect_posted_update" BEFORE UPDATE ON "sales_documents"
  FOR EACH ROW EXECUTE FUNCTION "sales_documents_protect_posted"();
CREATE TRIGGER "sales_documents_protect_posted_delete" BEFORE DELETE ON "sales_documents"
  FOR EACH ROW EXECUTE FUNCTION "sales_documents_protect_posted"();

CREATE FUNCTION "sales_document_lines_protect_posted"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  doc_ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN doc_ids := ARRAY[NEW."document_id"];
  ELSIF TG_OP = 'DELETE' THEN doc_ids := ARRAY[OLD."document_id"];
  ELSE doc_ids := ARRAY[OLD."document_id", NEW."document_id"];
  END IF;
  IF EXISTS (SELECT 1 FROM "sales_documents"
              WHERE "id" = ANY(doc_ids) AND "kind" = 'INVOICE' AND "status" = 'POSTED') THEN
    RAISE EXCEPTION 'lines of a posted invoice cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sales_document_lines_protect_posted" BEFORE INSERT OR UPDATE OR DELETE ON "sales_document_lines"
  FOR EACH ROW EXECUTE FUNCTION "sales_document_lines_protect_posted"();

-- Block the Supabase Data API on every new table (see the init migration).
ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_document_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_share_links" ENABLE ROW LEVEL SECURITY;
