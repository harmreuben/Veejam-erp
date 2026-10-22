// Accounts used by the browser tests. Test-only values; never use them anywhere real.
export const MOCK_AUTH_PORT = 54329;
export const E2E_ANON_KEY = "e2e-anon-key";
export const E2E_SERVICE_KEY = "e2e-service-role-key";
export const E2E_OWNER_WHATSAPP = "254711000001";
export const E2E_META_APP_SECRET = "e2e-app-secret-not-real";
export const E2E_VERIFY_TOKEN = "e2e-verify-token";
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://veejam:veejam_local@localhost:5432/veejam_e2e_test";

export const E2E_USERS = {
  owner: {
    authUserId: "11111111-1111-4111-8111-111111111111",
    email: "owner@veejam.test",
    password: "Owner-pass-2026",
    fullName: "Venus Owner",
    role: "OWNER",
  },
  sales: {
    authUserId: "22222222-2222-4222-8222-222222222222",
    email: "sales@veejam.test",
    password: "Sales-pass-2026",
    fullName: "Sam Sales",
    role: "SALES",
  },
  storekeeper: {
    authUserId: "44444444-4444-4444-8444-444444444444",
    email: "store@veejam.test",
    password: "Store-pass-2026",
    fullName: "Sue Storekeeper",
    role: "STOREKEEPER",
  },
  // Has a Supabase sign-in but was never given ERP access.
  stranger: {
    authUserId: "33333333-3333-4333-8333-333333333333",
    email: "stranger@veejam.test",
    password: "Stranger-pass-2026",
    fullName: "No Access",
    role: null,
  },
};
