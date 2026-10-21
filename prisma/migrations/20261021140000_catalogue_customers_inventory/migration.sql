-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'CUSTOMER';
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER';
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_TRANSFER';
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_COUNT';

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SellUnit" AS ENUM ('PIECE', 'PACK', 'CARTON');

-- CreateEnum
CREATE TYPE "TaxCategory" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAIL_SHOP', 'WHOLESALER', 'SUPERMARKET', 'KIOSK', 'DISTRIBUTOR', 'INSTITUTION', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_GAIN', 'COUNT_LOSS');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('OPENING_BALANCE', 'DAMAGED', 'EXPIRED', 'LOST_OR_STOLEN', 'FOUND', 'SAMPLE_OR_PROMOTION', 'CORRECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CUSTOMERS', 'PRODUCTS', 'SUPPLIERS');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('VALIDATED', 'COMMITTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "default_price_list_id" UUID;

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "units_per_pack" INTEGER NOT NULL,
    "packs_per_carton" INTEGER NOT NULL,
    "cost_price" DECIMAL(18,2),
    "tax_category" "TaxCategory" NOT NULL DEFAULT 'STANDARD',
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit" "SellUnit" NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'RETAIL_SHOP',
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "kra_pin" TEXT,
    "physical_address" TEXT,
    "town" TEXT,
    "credit_limit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "price_list_id" UUID,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "legacy_names" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "kra_pin" TEXT,
    "physical_address" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("product_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_number" TEXT NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by_id" UUID NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adjustment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit" "SellUnit" NOT NULL,
    "unit_quantity" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by_id" UUID NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit" "SellUnit" NOT NULL,
    "unit_quantity" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER,
    "system_quantity_at_post" INTEGER,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "ImportKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'VALIDATED',
    "total_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "committed_at" TIMESTAMPTZ(3),
    "committed_by_id" UUID,
    "summary" JSONB,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "action" TEXT,
    "errors" TEXT[],

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_status_name_idx" ON "products"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_code_key" ON "price_lists"("code");

-- CreateIndex
CREATE INDEX "price_list_items_product_id_idx" ON "price_list_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_price_list_id_product_id_unit_key" ON "price_list_items"("price_list_id", "product_id", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_kra_pin_key" ON "customers"("kra_pin");

-- CreateIndex
CREATE INDEX "customers_status_name_idx" ON "customers"("status", "name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_kra_pin_key" ON "suppliers"("kra_pin");

-- CreateIndex
CREATE INDEX "suppliers_status_name_idx" ON "suppliers"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "stock_balances_warehouse_id_idx" ON "stock_balances"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_occurred_at_idx" ON "stock_movements"("product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_occurred_at_idx" ON "stock_movements"("warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_source_type_source_id_idx" ON "stock_movements"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_number_key" ON "stock_adjustments"("number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_idempotency_key_key" ON "stock_adjustments"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_adjustments_posted_at_idx" ON "stock_adjustments"("posted_at");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjustment_id_idx" ON "stock_adjustment_lines"("adjustment_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_number_key" ON "stock_transfers"("number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_idempotency_key_key" ON "stock_transfers"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_transfers_posted_at_idx" ON "stock_transfers"("posted_at");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_transfer_id_idx" ON "stock_transfer_lines"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_number_key" ON "stock_counts"("number");

-- CreateIndex
CREATE INDEX "stock_counts_status_created_at_idx" ON "stock_counts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_product_id_key" ON "stock_count_lines"("count_id", "product_id");

-- CreateIndex
CREATE INDEX "import_jobs_created_at_idx" ON "import_jobs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_rows_job_id_row_number_key" ON "import_job_rows"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_default_price_list_id_fkey" FOREIGN KEY ("default_price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_committed_by_id_fkey" FOREIGN KEY ("committed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written rules Prisma cannot express ────────────────────

-- Products: sensible pack sizes, prices and levels.
ALTER TABLE "products" ADD CONSTRAINT "products_units_per_pack_chk" CHECK ("units_per_pack" >= 1);
ALTER TABLE "products" ADD CONSTRAINT "products_packs_per_carton_chk" CHECK ("packs_per_carton" >= 1);
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_chk" CHECK ("cost_price" IS NULL OR "cost_price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_level_chk" CHECK ("reorder_level" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_sku_format_chk" CHECK ("sku" = upper("sku") AND "sku" <> '');

-- Prices are positive amounts.
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_chk" CHECK ("price" > 0);

-- Customers and suppliers.
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_limit_chk" CHECK ("credit_limit" >= 0);
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_terms_chk" CHECK ("payment_terms_days" BETWEEN 0 AND 365);
ALTER TABLE "customers" ADD CONSTRAINT "customers_phone_format_chk" CHECK ("phone" IS NULL OR "phone" ~ '^254[17][0-9]{8}$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_terms_chk" CHECK ("payment_terms_days" BETWEEN 0 AND 365);

-- Stock can never go negative.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_quantity_chk" CHECK ("quantity" >= 0);

-- Ledger rows: non-zero, the sign must match the type, the balance never negative.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_sign_chk" CHECK (
  ("type" IN ('ADJUSTMENT_IN', 'TRANSFER_IN', 'COUNT_GAIN') AND "quantity" > 0) OR
  ("type" IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'COUNT_LOSS') AND "quantity" < 0)
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_balance_after_chk" CHECK ("balance_after" >= 0);

-- Document lines.
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_quantity_chk" CHECK ("quantity" <> 0 AND "unit_quantity" <> 0);
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_quantity_chk" CHECK ("quantity" > 0 AND "unit_quantity" > 0);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_different_warehouses_chk" CHECK ("from_warehouse_id" <> "to_warehouse_id");
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_quantities_chk" CHECK (
  "expected_quantity" >= 0 AND ("counted_quantity" IS NULL OR "counted_quantity" >= 0)
);
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_status_dates_chk" CHECK (
  ("status" = 'DRAFT' AND "posted_at" IS NULL AND "cancelled_at" IS NULL) OR
  ("status" = 'POSTED' AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL) OR
  ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
);

-- The stock ledger is append-only, like the audit log.
CREATE FUNCTION "stock_movements_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "stock_movements_no_update" BEFORE UPDATE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_reject_change"();
CREATE TRIGGER "stock_movements_no_delete" BEFORE DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_reject_change"();
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "stock_movements_reject_change"();

-- Block the Supabase Data API on every new table (see the init migration).
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_list_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_adjustment_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job_rows" ENABLE ROW LEVEL SECURITY;
