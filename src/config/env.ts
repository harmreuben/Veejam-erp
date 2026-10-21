import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration, validated with Zod.
 *
 * Phase 1: every external service is optional so the app runs on a fresh
 * machine with no accounts. Later phases tighten these rules (for example
 * DATABASE_URL becomes required in Phase 2).
 *
 * Never import this file from a client component. The `server-only` import
 * above makes the build fail if that happens, so secrets cannot leak into
 * browser bundles.
 */

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** WhatsApp IDs are international numbers as digits only, e.g. 254712345678. */
const whatsappNumber = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^[1-9]\d{7,14}$/.test(v), {
    message: "Use the international format with digits only and no plus sign, e.g. 254712345678",
  });

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_BASE_URL: z.url().default("http://localhost:3000"),

    // Database (Phase 2)
    DATABASE_URL: optionalString,
    DIRECT_URL: optionalString,

    // Supabase (Phase 2)
    NEXT_PUBLIC_SUPABASE_URL: optionalString,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    // WhatsApp (Phases 6–7)
    WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
    VEEJAM_OWNER_WHATSAPP_NUMBER: whatsappNumber,
    META_WHATSAPP_TOKEN: optionalString,
    META_WHATSAPP_PHONE_NUMBER_ID: optionalString,
    META_WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
    META_WHATSAPP_VERIFY_TOKEN: optionalString,
    META_APP_SECRET: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.WHATSAPP_PROVIDER === "meta") {
      const required = [
        "META_WHATSAPP_TOKEN",
        "META_WHATSAPP_PHONE_NUMBER_ID",
        "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
        "META_WHATSAPP_VERIFY_TOKEN",
        "META_APP_SECRET",
        "VEEJAM_OWNER_WHATSAPP_NUMBER",
      ] as const;
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when WHATSAPP_PROVIDER=meta`,
          });
        }
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parse an env object. Throws one readable error listing every problem. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Validated server environment, parsed once per process. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export type ConfigCheck = {
  key: string;
  label: string;
  phase: number;
  configured: boolean;
};

/**
 * Which integrations are configured, as booleans only.
 * Safe to show on screen: it never returns a value, only whether one exists.
 */
export function getConfigChecks(env: ServerEnv = getServerEnv()): ConfigCheck[] {
  return [
    { key: "DATABASE_URL", label: "Database connection", phase: 2, configured: !!env.DATABASE_URL },
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      label: "Supabase project",
      phase: 2,
      configured: !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    {
      key: "VEEJAM_OWNER_WHATSAPP_NUMBER",
      label: "Owner WhatsApp number",
      phase: 6,
      configured: !!env.VEEJAM_OWNER_WHATSAPP_NUMBER,
    },
    {
      key: "META_WHATSAPP_TOKEN",
      label: "Meta WhatsApp Cloud API",
      phase: 7,
      configured: !!env.META_WHATSAPP_TOKEN && !!env.META_WHATSAPP_PHONE_NUMBER_ID && !!env.META_APP_SECRET,
    },
  ];
}
