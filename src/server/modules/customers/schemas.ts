import { z } from "zod";

import { CustomerType, RecordStatus } from "@/generated/prisma/enums";
import {
  intField,
  moneyField,
  optionalEmail,
  optionalKraPin,
  optionalPhone,
  optionalText,
  requiredText,
  versionField,
} from "@/server/shared/validation";

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  RETAIL_SHOP: "Retail shop",
  WHOLESALER: "Wholesaler",
  SUPERMARKET: "Supermarket",
  KIOSK: "Kiosk",
  DISTRIBUTOR: "Distributor",
  INSTITUTION: "Institution",
  WALK_IN: "Walk-in",
  OTHER: "Other",
};

const checkbox = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const optionalUuid = z
  .union([z.literal(""), z.uuid()])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const customerFieldsSchema = z.object({
  name: requiredText(120, "Enter the customer's name"),
  type: z.enum(CustomerType).default("RETAIL_SHOP"),
  contactPerson: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  kraPin: optionalKraPin,
  physicalAddress: optionalText(300),
  town: optionalText(80),
  creditLimit: moneyField({ allowBlank: true, min: "0" }).transform((v) => v ?? "0.00"),
  paymentTermsDays: intField("payment terms", 0, 365).default(0),
  priceListId: optionalUuid,
  status: z.enum(RecordStatus).default("ACTIVE"),
  notes: optionalText(2000),
});
export type CustomerValues = z.output<typeof customerFieldsSchema>;

export const createCustomerSchema = customerFieldsSchema.extend({
  /** Ticked when the person confirms a same-name customer is a different business. */
  allowDuplicateName: checkbox,
});

export const updateCustomerSchema = customerFieldsSchema.extend({ version: versionField });

export const supplierFieldsSchema = z.object({
  name: requiredText(120, "Enter the supplier's name"),
  contactPerson: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  kraPin: optionalKraPin,
  physicalAddress: optionalText(300),
  paymentTermsDays: intField("payment terms", 0, 365).default(0),
  status: z.enum(RecordStatus).default("ACTIVE"),
  notes: optionalText(2000),
});
export type SupplierValues = z.output<typeof supplierFieldsSchema>;
export const updateSupplierSchema = supplierFieldsSchema.extend({ version: versionField });
