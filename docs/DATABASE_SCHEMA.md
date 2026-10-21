# Database schema

> Phase 1: design outline. The Prisma schema and migrations are created in Phase 2, and this file is updated to match them.

## Conventions

- Postgres on Supabase, managed only through Prisma migrations (`prisma/migrations/`). No manual schema edits in the Supabase dashboard.
- Primary keys: `uuid` generated in the database.
- Money: `Decimal @db.Decimal(18, 2)`. Rates/percentages: `Decimal @db.Decimal(9, 4)`.
- Quantities: integers in base units (pieces).
- Timestamps: `timestamptz`, stored in UTC, displayed in Africa/Nairobi.
- Every table has `createdAt`, `updatedAt`; business documents also have `createdById`.
- Posted financial rows (journal lines, stock movements, posted invoices, receipts) are never updated or deleted; corrections are new rows.
- Foreign keys use `ON DELETE RESTRICT` for anything financial.

## Planned entities by phase

**Phase 2 — platform**
`User` (linked to Supabase Auth user id), `Role`, `Permission`, `UserRole`, `CompanySettings`, `DocumentSequence` (next number per document type, row-locked when incremented), `AuditLog`.

**Phase 3 — master data and stock**
`Product` (brand, category, flavour, image), `Sku` (code, barcode, unit, `unitsPerPack`, `packsPerCarton`, cost, prices, tax code, reorder level, status), `PriceList`, `PriceListItem`, `Customer`, `CustomerType`, `Supplier`, `Warehouse`, `StockBalance` (sku × warehouse × batch), `StockMovement` (ledger), `Batch` (lot, expiry), `StockCount`, `StockCountLine`, `ImportJob`, `ImportJobRow`.

**Phase 4 — sales**
`Quotation`, `QuotationLine`, `SalesOrder`, `SalesOrderLine`, `StockReservation`, `Invoice`, `InvoiceLine`, `DeliveryNote`, `DeliveryNoteLine`, `DocumentShareLink` (hashed token, expiry, revocation).

**Phase 5 — money**
`PaymentMethod`, `Payment`, `PaymentAllocation`, `Receipt`, `CreditNote`, `CreditNoteLine`, `SalesReturn`, `TaxCode`, `Account` (chart of accounts), `JournalEntry`, `JournalLine`, `AccountingPeriod`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`, `SupplierInvoice`.

**Phase 6–7 — WhatsApp**
`WhatsAppMessage` (direction, provider message id **unique**, status, body), `WhatsAppEvent` (webhook event id **unique**, for idempotency), `PendingConfirmation` (owner, action, draft reference, draft version, expiry, consumed flag).

## Integrity rules enforced in the database

- `Sku.code` unique; `Sku.barcode` unique when present.
- `Customer.code` unique; `Customer.kraPin` unique when present.
- `Invoice.number` unique; numbers issued only from `DocumentSequence` inside the posting transaction.
- `StockBalance.quantity >= 0` check constraint.
- `JournalEntry` posted only when the sum of its lines' debits equals credits (checked in the service and by a deferred constraint/trigger).
- `WhatsAppEvent.eventId` and `PendingConfirmation` consumption are unique to make replays harmless.
