import { defineConfig, devices } from "@playwright/test";

import {
  E2E_ANON_KEY,
  E2E_DATABASE_URL,
  E2E_META_APP_SECRET,
  E2E_OWNER_WHATSAPP,
  E2E_SERVICE_KEY,
  E2E_VERIFY_TOKEN,
  MOCK_AUTH_PORT,
} from "./tests/e2e/support/fixtures.mjs";

const PORT = 3100;

/**
 * Browser tests run against a production build of the app, connected to:
 * - a disposable Postgres database (E2E_DATABASE_URL; its name must contain "test"),
 *   rebuilt from prisma/migrations on every run;
 * - a TEST-ONLY stand-in for Supabase Auth (tests/e2e/support/mock-supabase-auth.mjs).
 * The build goes to .next-e2e so it never mixes with your real .next build.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Tests share one database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Most tests open pages directly by URL; the real app sends fresh loads to the
    // start page. This header switches that off, and only the test server honours it
    // (VEEJAM_TEST_DEEP_LINKS below). start-page.spec.ts tests the real behaviour.
    extraHTTPHeaders: { "x-veejam-deep-links": "1" },
    // Optional: point at an already-installed Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile-menu\.spec\.ts/ },
    // Phones: read-only smoke checks of layout and sign-in.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(smoke|theme|mobile-menu)\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "node tests/e2e/support/mock-supabase-auth.mjs",
      url: `http://127.0.0.1:${MOCK_AUTH_PORT}/auth/v1/health`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command:
        "tsx --conditions=react-server tests/e2e/support/prepare-db.mts && next build && next start -p " +
        PORT,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_AUTH_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: E2E_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: E2E_SERVICE_KEY,
        DATABASE_URL: E2E_DATABASE_URL,
        DIRECT_URL: E2E_DATABASE_URL,
        APP_BASE_URL: `http://localhost:${PORT}`,
        WHATSAPP_PROVIDER: "mock",
        VEEJAM_TEST_DEEP_LINKS: "1",
        VEEJAM_OWNER_WHATSAPP_NUMBER: E2E_OWNER_WHATSAPP,
        META_APP_SECRET: E2E_META_APP_SECRET,
        META_WHATSAPP_VERIFY_TOKEN: E2E_VERIFY_TOKEN,
      },
    },
  ],
});
