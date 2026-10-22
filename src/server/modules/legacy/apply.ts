import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, toDbDate, todayInNairobi } from "@/lib/dates";
import { writeAudit } from "@/server/audit/audit";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { postStockValue } from "@/server/modules/accounting/journal";
import { insertProduct } from "@/server/modules/catalogue/service";
import { applyStockChanges } from "@/server/modules/inventory/stock";
import { insertCustomer, nameKey } from "@/server/modules/customers/service";
import { getDefaultPriceListId, writePrices } from "@/server/modules/pricing/service";

import { WHOLESALE_PRICE_LIST } from "./decisions";
import type { LegacyPlan } from "./plan";

export type ImportActor = { id: string; email: string };

export type ImportResult = {
  productsCreated: number;
  productsKept: number;
  pricesSet: number;
  customersCreated: number;
  customersMatched: number;
  invoicesCreated: number;
  invoicesAlreadyThere: number;
  /** Products given an opening stock balance; products that already had stock movements are left alone. */
  stockSet: number;
  stockSkipped: number;
};

/** Fixed key, so the opening-stock adjustment can only ever be posted once. */
export const LEGACY_OPENING_STOCK_KEY = "00000000-0000-4000-8000-000000000001";

/**
 * Write the plan in one transaction: all of it or none of it. Safe to run
 * again: products are matched by SKU, customers by name (or an old name), and
 * invoices by their VJL- number, so nothing is created twice and nothing
 * already edited in the new system is overwritten.
 */
export async function applyLegacyPlan(db: Db, actor: ImportActor, plan: LegacyPlan): Promise<ImportResult> {
  if (plan.problems.some((p) => p.level === "error")) {
    throw new Error("The import plan has errors. Fix them (see the report) before importing.");
  }
  const via = "old system import";
  return db.$transaction(
    async (tx) => {
      const result: ImportResult = {
        productsCreated: 0,
        productsKept: 0,
        pricesSet: 0,
        customersCreated: 0,
        customersMatched: 0,
        invoicesCreated: 0,
        invoicesAlreadyThere: 0,
        stockSet: 0,
        stockSkipped: 0,
      };

      // Products and prices
      const defaultList = await getDefaultPriceListId(tx);
      if (!defaultList) throw new Error("There is no default price list. Run npm run db:seed first.");
      const wholesaleList =
        (await tx.priceList.findUnique({ where: { code: WHOLESALE_PRICE_LIST.code } })) ??
        (await tx.priceList.create({ data: { ...WHOLESALE_PRICE_LIST, pricesIncludeTax: true } }));

      const productIds = new Map<string, { id: string; unitsPerPack: number }>();
      for (const p of plan.products) {
        let product = await tx.product.findUnique({ where: { sku: p.sku } });
        if (product) result.productsKept++;
        else {
          product = await insertProduct(
            tx,
            actor,
            {
              sku: p.sku,
              barcode: null,
              name: p.name,
              brand: "Wrigley's",
              category: p.category,
              unitsPerPack: p.unitsPerPack,
              packsPerCarton: p.packsPerCarton,
              costPrice: null,
              taxCategory: "STANDARD",
              reorderLevel: p.reorderLevel,
              status: "ACTIVE",
              notes: "Brought across from the old system. Check the pack sizes against a real carton.",
            },
            undefined,
            { via },
          );
          result.productsCreated++;
        }
        productIds.set(p.sku, { id: product.id, unitsPerPack: product.unitsPerPack });
      }
      // Prices are only filled in where none is set yet.
      for (const [listId, entries] of [
        [defaultList, plan.products.map((p) => ({ sku: p.sku, unit: "PACK" as const, price: p.retailPack }))],
        [
          wholesaleList.id,
          plan.products.flatMap((p) => [
            { sku: p.sku, unit: "PACK" as const, price: p.wholesalePack },
            { sku: p.sku, unit: "CARTON" as const, price: p.wholesaleCarton },
          ]),
        ],
      ] as const) {
        const existing = await tx.priceListItem.findMany({ where: { priceListId: listId } });
        const have = new Set(existing.map((e) => `${e.productId}:${e.unit}`));
        const missing = entries
          .map((e) => ({ productId: productIds.get(e.sku)!.id, unit: e.unit, price: e.price }))
          .filter((e) => !have.has(`${e.productId}:${e.unit}`));
        result.pricesSet += await writePrices(tx, actor, listId, missing, { via });
      }

      // Customers
      const all = await tx.customer.findMany();
      const customerIds = new Map<string, string>();
      for (const c of plan.customers) {
        const keys = new Set([c.name, ...c.legacyNames].map(nameKey));
        const match = all.find(
          (x) => keys.has(nameKey(x.name)) || x.legacyNames.some((n) => keys.has(nameKey(n))),
        );
        if (match) {
          customerIds.set(c.name, match.id);
          result.customersMatched++;
          const names = [...new Set([...match.legacyNames, ...c.legacyNames])];
          if (names.length !== match.legacyNames.length) {
            await tx.customer.update({ where: { id: match.id }, data: { legacyNames: names } });
          }
          continue;
        }
        const created = await insertCustomer(
          tx,
          actor,
          {
            name: c.name,
            type: c.type,
            contactPerson: null,
            phone: c.phone,
            email: null,
            kraPin: null,
            physicalAddress: null,
            town: null,
            creditLimit: "0.00",
            paymentTermsDays: 0,
            priceListId: c.wholesale ? wholesaleList.id : null,
            status: "ACTIVE",
            notes: c.note ? `From the old system. ${c.note}` : "From the old system.",
          },
          { via, legacyNames: c.legacyNames },
        );
        customerIds.set(c.name, created.id);
        result.customersCreated++;
      }

      // Historical invoices
      const warehouse = await tx.warehouse.findFirst({ where: { code: "MAIN" } });
      const anyWarehouse =
        warehouse ?? (await tx.warehouse.findFirstOrThrow({ orderBy: { createdAt: "asc" } }));
      const company = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
      const existingNumbers = new Set(
        (
          await tx.salesDocument.findMany({
            where: { number: { in: plan.invoices.map((i) => i.number) } },
            select: { number: true },
          })
        ).map((d) => d.number),
      );
      const customers = new Map((await tx.customer.findMany()).map((c) => [c.id, c]));

      for (const inv of plan.invoices) {
        if (existingNumbers.has(inv.number)) {
          result.invoicesAlreadyThere++;
          continue;
        }
        const customer = customers.get(customerIds.get(inv.customer)!)!;
        const doc = await tx.salesDocument.create({
          data: {
            kind: "INVOICE",
            customerId: customer.id,
            warehouseId: anyWarehouse.id,
            pricesIncludeTax: true,
            issueDate: toDbDate(inv.issueDay),
            notes: [
              "Imported from the previous system.",
              inv.oldCustomerName !== customer.name
                ? `Customer on the original: ${inv.oldCustomerName}.`
                : "",
              inv.correction ?? "",
            ]
              .filter(Boolean)
              .join(" "),
            subtotal: inv.subtotal,
            discountTotal: inv.discountTotal,
            taxTotal: inv.taxTotal,
            total: inv.total,
            createdById: actor.id,
            createdAt: inv.postedAt,
          },
        });
        await tx.salesDocumentLine.createMany({
          data: inv.lines.map((l, i) => {
            const p = productIds.get(l.sku)!;
            return {
              documentId: doc.id,
              position: i + 1,
              productId: p.id,
              sku: l.sku,
              description: plan.products.find((x) => x.sku === l.sku)!.name,
              unit: "PACK" as const,
              quantity: l.quantity,
              piecesPerUnit: p.unitsPerPack,
              pieces: l.quantity * p.unitsPerPack,
              unitPrice: l.unitPrice,
              discountPercent: "0",
              taxCategory: "STANDARD" as const,
              taxRate: "16",
              netAmount: l.netAmount,
              discountAmount: "0",
              taxAmount: l.taxAmount,
              grossAmount: l.grossAmount,
            };
          }),
        });
        await tx.salesDocument.update({
          where: { id: doc.id },
          data: {
            number: inv.number,
            status: "POSTED",
            historical: true,
            // The old system gave 30 days to pay.
            dueDate: toDbDate(addDays(inv.issueDay, 30)),
            postedAt: inv.postedAt,
            postedById: actor.id,
            amountPaid: inv.amountPaid,
            companySnapshot: snapshotCompany(company),
            customerSnapshot: {
              code: customer.code,
              name: customer.name,
              contactPerson: customer.contactPerson,
              phone: customer.phone,
              email: customer.email,
              kraPin: customer.kraPin,
              physicalAddress: customer.physicalAddress,
              town: customer.town,
            },
          },
        });
        result.invoicesCreated++;
      }

      // Opening stock (one adjustment, posted once)
      if (plan.openingStock.length) {
        const already = await tx.stockAdjustment.findUnique({
          where: { idempotencyKey: LEGACY_OPENING_STOCK_KEY },
        });
        if (already) {
          result.stockSkipped = plan.openingStock.length;
        } else {
          const moved = new Set(
            (
              await tx.stockMovement.findMany({
                where: { productId: { in: [...productIds.values()].map((p) => p.id) } },
                select: { productId: true },
                distinct: ["productId"],
              })
            ).map((m) => m.productId),
          );
          const lines = plan.openingStock.filter((s) => !moved.has(productIds.get(s.sku)!.id));
          result.stockSkipped = plan.openingStock.length - lines.length;
          if (lines.length) {
            const number = await nextNumber(tx, "STOCK_ADJUSTMENT");
            const adj = await tx.stockAdjustment.create({
              data: {
                number,
                warehouseId: anyWarehouse.id,
                reason: "OPENING_BALANCE",
                notes: "Opening stock from the old system's inventory report. Confirm with a stock count.",
                idempotencyKey: LEGACY_OPENING_STOCK_KEY,
                postedById: actor.id,
                lines: {
                  create: lines.map((l) => ({
                    productId: productIds.get(l.sku)!.id,
                    unit: "PACK" as const,
                    unitQuantity: l.packs,
                    quantity: l.pieces,
                  })),
                },
              },
            });
            const stock = await applyStockChanges(
              tx,
              lines.map((l) => ({
                productId: productIds.get(l.sku)!.id,
                warehouseId: anyWarehouse.id,
                quantity: l.pieces,
                type: "ADJUSTMENT_IN" as const,
              })),
              {
                type: "StockAdjustment",
                id: adj.id,
                number,
                reason: "Opening balance (old system)",
                actorId: actor.id,
              },
            );
            // Zero unless cost prices were known; the owner enters opening costs later.
            await postStockValue(tx, {
              change: stock.total,
              against: "OPENING",
              date: todayInNairobi(),
              description: `Opening stock from the old system (${number})`,
              sourceType: "StockAdjustment",
              sourceId: adj.id,
              sourceNumber: number,
              actorId: actor.id,
            });
            result.stockSet = lines.length;
          }
        }
      }

      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "LEGACY_IMPORTED",
        entityType: "System",
        summary:
          `Old system import: ${result.customersCreated} customers, ${result.productsCreated} products, ` +
          `${result.invoicesCreated} historical invoices (KES ${plan.totals.invoiced}, outstanding ${plan.totals.outstanding})`,
        after: { ...result, totals: plan.totals, defaultsUsed: plan.defaults },
      });
      return result;
    },
    { maxWait: 60_000, timeout: 600_000 },
  );
}

function snapshotCompany(c: Awaited<ReturnType<DbOrTx["companySettings"]["findUniqueOrThrow"]>>) {
  return {
    name: c.name,
    telephone: c.telephone,
    documentEmail: c.documentEmail,
    kraPin: c.kraPin,
    physicalAddress: c.physicalAddress,
    postalAddress: c.postalAddress,
    paymentInstructions: c.paymentInstructions,
    invoiceTerms: c.invoiceTerms,
    currency: c.currency,
  } satisfies Prisma.InputJsonObject;
}
