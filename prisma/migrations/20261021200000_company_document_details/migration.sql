-- Company details printed on invoices: tagline, M-Pesa paybill and account, VAT registration.

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "mpesa_account" TEXT,
ADD COLUMN     "mpesa_paybill" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "vat_registered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_mpesa_paybill_chk" CHECK ("mpesa_paybill" IS NULL OR "mpesa_paybill" ~ '^[0-9]{5,7}$');
