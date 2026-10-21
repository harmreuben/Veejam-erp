-- Historical invoices brought across from the old system (original VJL- numbers).

-- AlterTable
ALTER TABLE "sales_documents" ADD COLUMN     "historical" BOOLEAN NOT NULL DEFAULT false;

-- Only posted invoices can be historical.
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_historical_chk" CHECK (
  NOT "historical" OR ("kind" = 'INVOICE' AND "status" = 'POSTED')
);
