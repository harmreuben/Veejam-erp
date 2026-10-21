import { z } from "zod";

/**
 * Company profile.
 *
 * These are the INITIAL values only. In Phase 2 they are written to the
 * `CompanySettings` table by the seed script, and from then on the app reads
 * them from the database and an authorised user edits them on the Settings
 * page. Nothing else in the codebase should hard-code the company name,
 * phone or email — import from here (Phase 1) or the settings service (Phase 2+).
 */

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  telephone: z
    .string()
    .trim()
    .regex(/^(?:\+?254|0)\d{9}$/, "Enter a Kenyan number such as 0712345678 or +254712345678"),
  documentEmail: z.email(),
  country: z.string().trim().min(2),
  currency: z.string().length(3),
  timezone: z.string().trim().min(3),
  businessType: z.string().trim().min(2),
  productScope: z.string().trim().min(2),
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = companyProfileSchema.parse({
  name: "VeeJam Limited",
  telephone: "0115924570",
  // Display only: the system never sends email.
  documentEmail: "wanjiruvenus980@gmail.com",
  country: "Kenya",
  currency: "KES",
  timezone: "Africa/Nairobi",
  businessType: "Wrigley products distribution",
  productScope: "Wrigley products only",
});
