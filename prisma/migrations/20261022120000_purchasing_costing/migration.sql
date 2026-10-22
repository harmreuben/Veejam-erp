-- Phase 5b: purchasing, supplier bills and payments, weighted-average stock costing.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_BILL';
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_PAYMENT';
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_REVALUATION';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_IN';

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierBillStatus" AS ENUM ('POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillLineKind" AS ENUM ('GOODS', 'EXPENSE');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "cost_value" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "inventory_valuations" (
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_valuations_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "stock_revaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "old_value" DECIMAL(18,2) NOT NULL,
    "new_value" DECIMAL(18,2) NOT NULL,
    "against_opening" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_revaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ordered_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" "SellUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pieces_per_unit" INTEGER NOT NULL,
    "pieces" INTEGER NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "received_pieces" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "received_on" DATE NOT NULL,
    "supplier_reference" TEXT,
    "notes" TEXT,
    "total_cost" DECIMAL(18,2) NOT NULL,
    "expected_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bill_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "posted_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_line_id" UUID,
    "unit" "SellUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pieces" INTEGER NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "line_cost" DECIMAL(18,2) NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_invoice_number" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "tax_total" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "amount_paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "SupplierBillStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "posted_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "BillLineKind" NOT NULL,
    "goods_receipt_id" UUID,
    "account_id" UUID,
    "description" TEXT NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "idempotency_key" TEXT NOT NULL,
    "paid_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reverse_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_revaluations_number_key" ON "stock_revaluations"("number");

-- CreateIndex
CREATE INDEX "stock_revaluations_product_id_created_at_idx" ON "stock_revaluations"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_order_date_idx" ON "purchase_orders"("status", "order_date");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_status_idx" ON "purchase_orders"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_product_id_idx" ON "purchase_order_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_order_id_position_key" ON "purchase_order_lines"("order_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_number_key" ON "goods_receipts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_idempotency_key_key" ON "goods_receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "goods_receipts_supplier_id_bill_id_idx" ON "goods_receipts"("supplier_id", "bill_id");

-- CreateIndex
CREATE INDEX "goods_receipts_received_on_idx" ON "goods_receipts"("received_on");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receipt_id_idx" ON "goods_receipt_lines"("receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_product_id_idx" ON "goods_receipt_lines"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_number_key" ON "supplier_bills"("number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_idempotency_key_key" ON "supplier_bills"("idempotency_key");

-- CreateIndex
CREATE INDEX "supplier_bills_supplier_id_status_idx" ON "supplier_bills"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "supplier_bills_due_date_idx" ON "supplier_bills"("due_date");

-- CreateIndex
CREATE INDEX "supplier_bill_lines_goods_receipt_id_idx" ON "supplier_bill_lines"("goods_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_lines_bill_id_position_key" ON "supplier_bill_lines"("bill_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_number_key" ON "supplier_payments"("number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_idempotency_key_key" ON "supplier_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_paid_on_idx" ON "supplier_payments"("supplier_id", "paid_on");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_payment_id_idx" ON "supplier_payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_bill_id_idx" ON "supplier_payment_allocations"("bill_id");

-- AddForeignKey
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_revaluations" ADD CONSTRAINT "stock_revaluations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_revaluations" ADD CONSTRAINT "stock_revaluations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules the database enforces ─────────────────────────────────────

-- Purchases add stock; cost moves in the same direction as the quantity.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_quantity_sign_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_sign_chk" CHECK (
  ("type"::text IN ('ADJUSTMENT_IN', 'TRANSFER_IN', 'COUNT_GAIN', 'RETURN_IN', 'PURCHASE_IN') AND "quantity" > 0) OR
  ("type"::text IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'COUNT_LOSS', 'SALE') AND "quantity" < 0)
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cost_sign_chk" CHECK (
  "cost_value" IS NULL OR ("quantity" > 0 AND "cost_value" >= 0) OR ("quantity" < 0 AND "cost_value" <= 0)
);

ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_amounts_chk" CHECK (
  "quantity" >= 0 AND "value" >= 0 AND ("quantity" > 0 OR "value" = 0)
);

ALTER TABLE "stock_revaluations" ADD CONSTRAINT "stock_revaluations_amounts_chk" CHECK (
  "quantity" > 0 AND "old_value" >= 0 AND "new_value" >= 0 AND "old_value" <> "new_value"
);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_amounts_chk" CHECK (
  "subtotal" >= 0 AND "tax_total" >= 0 AND "total" = "subtotal" + "tax_total"
);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_chk" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL) AND
  ("status" = 'DRAFT' OR "status" = 'CANCELLED' OR "ordered_at" IS NOT NULL) AND
  ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL) AND
  ("expected_date" IS NULL OR "expected_date" >= "order_date")
);

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_amounts_chk" CHECK (
  "quantity" > 0 AND "pieces_per_unit" > 0 AND "pieces" = "quantity" * "pieces_per_unit" AND
  "unit_cost" >= 0 AND "tax_rate" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0 AND
  "gross_amount" = "net_amount" + "tax_amount" AND
  "received_pieces" >= 0 AND "received_pieces" <= "pieces"
);

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_amounts_chk" CHECK (
  "total_cost" >= 0 AND "expected_tax" >= 0
);

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_amounts_chk" CHECK (
  "quantity" > 0 AND "pieces" > 0 AND "unit_cost" >= 0 AND "line_cost" >= 0 AND "tax_rate" >= 0
);

ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_amounts_chk" CHECK (
  "subtotal" >= 0 AND "tax_total" >= 0 AND "total" = "subtotal" + "tax_total" AND
  "amount_paid" >= 0 AND "amount_paid" <= "total" AND "due_date" >= "bill_date"
);
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_cancelled_chk" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by_id" IS NOT NULL AND "cancel_reason" IS NOT NULL) AND
  ("status" <> 'CANCELLED' OR "amount_paid" = 0)
);

ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_kind_chk" CHECK (
  ("kind" = 'GOODS' AND "goods_receipt_id" IS NOT NULL AND "account_id" IS NULL) OR
  ("kind" = 'EXPENSE' AND "account_id" IS NOT NULL AND "goods_receipt_id" IS NULL)
);
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_amounts_chk" CHECK (
  "net_amount" >= 0 AND "tax_amount" >= 0 AND "gross_amount" = "net_amount" + "tax_amount"
);

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversed_chk" CHECK (
  ("status" = 'REVERSED') = ("reversed_at" IS NOT NULL AND "reversed_by_id" IS NOT NULL AND "reverse_reason" IS NOT NULL)
);

ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_amount_chk" CHECK ("amount" > 0);

-- A posted bill is final: only the amount paid and cancellation may change; never deleted.
CREATE FUNCTION supplier_bills_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier bills can''t be deleted (%)', OLD.number;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'supplier bill % is cancelled and can''t be changed', OLD.number;
  END IF;
  IF (NEW.number, NEW.supplier_id, NEW.supplier_invoice_number, NEW.bill_date, NEW.due_date,
      NEW.subtotal, NEW.tax_total, NEW.total, NEW.notes, NEW.idempotency_key, NEW.posted_by_id, NEW.posted_at)
     IS DISTINCT FROM
     (OLD.number, OLD.supplier_id, OLD.supplier_invoice_number, OLD.bill_date, OLD.due_date,
      OLD.subtotal, OLD.tax_total, OLD.total, OLD.notes, OLD.idempotency_key, OLD.posted_by_id, OLD.posted_at) THEN
    RAISE EXCEPTION 'supplier bill % is posted and can''t be edited', OLD.number;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_bills_protect BEFORE UPDATE OR DELETE ON "supplier_bills"
  FOR EACH ROW EXECUTE FUNCTION supplier_bills_protect();

CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows can''t be changed or deleted once posted (% blocked)', TG_TABLE_NAME, TG_OP;
END $$;
CREATE TRIGGER supplier_bill_lines_immutable BEFORE UPDATE OR DELETE ON "supplier_bill_lines"
  FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER goods_receipt_lines_immutable BEFORE UPDATE OR DELETE ON "goods_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER stock_revaluations_immutable BEFORE UPDATE OR DELETE ON "stock_revaluations"
  FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- A goods received note is final; only the link to its bill may be set (or cleared when the bill is cancelled).
CREATE FUNCTION goods_receipts_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goods received notes can''t be deleted (%)', OLD.number;
  END IF;
  IF (NEW.number, NEW.supplier_id, NEW.warehouse_id, NEW.purchase_order_id, NEW.received_on,
      NEW.supplier_reference, NEW.notes, NEW.total_cost, NEW.expected_tax, NEW.idempotency_key,
      NEW.posted_by_id, NEW.posted_at)
     IS DISTINCT FROM
     (OLD.number, OLD.supplier_id, OLD.warehouse_id, OLD.purchase_order_id, OLD.received_on,
      OLD.supplier_reference, OLD.notes, OLD.total_cost, OLD.expected_tax, OLD.idempotency_key,
      OLD.posted_by_id, OLD.posted_at) THEN
    RAISE EXCEPTION 'goods received note % is posted and can''t be edited', OLD.number;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER goods_receipts_protect BEFORE UPDATE OR DELETE ON "goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION goods_receipts_protect();

-- ─── Existing stock: start every product's valuation from what's on hand ─────
-- Valued at the product's cost price where one is set, otherwise at zero until
-- the owner enters the opening cost (Inventory → Stock value).
INSERT INTO "inventory_valuations" ("product_id", "quantity", "value", "updated_at")
SELECT p."id",
       COALESCE(b.qty, 0),
       CASE WHEN COALESCE(b.qty, 0) > 0 THEN ROUND(COALESCE(b.qty, 0) * COALESCE(p."cost_price", 0), 2) ELSE 0 END,
       CURRENT_TIMESTAMP
  FROM "products" p
  LEFT JOIN (SELECT "product_id", SUM("quantity")::int AS qty FROM "stock_balances" GROUP BY "product_id") b
         ON b."product_id" = p."id";

-- Supabase's Data API is not used; block it on the new tables as on all others.
ALTER TABLE "inventory_valuations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_revaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_bill_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payment_allocations" ENABLE ROW LEVEL SECURITY;
