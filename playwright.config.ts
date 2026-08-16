import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Give the test process the same .env.local the app was built with. A test
// that needs to know which backend the app talks to should read it from the
// same source the app did, rather than hardcoding a spelling that is only
// correct while the stack happens to be local.
loadEnvConfig(process.cwd());

/**
 * E2E configuration.
 *
 * Mobile-first for real: the primary project is an iPhone viewport, because
 * that is where this app is used — standing on someone's porch, not at a
 * desk. A desktop project runs the same journeys to catch layouts that only
 * hold together at one width.
 *
 * `webServer` is deliberately NOT set. These tests need the seeded Summerlake
 * community to exist; starting a server that points at an unseeded database
 * would produce confident green runs against an empty neighbourhood. Start
 * `npm run dev` first, against whichever Supabase project .env.local names —
 * the local stack (`supabase start`) or the hosted one. Both carry the same
 * seed, and the journeys write to it, so do not point this at a database
 * whose contents matter.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Journeys share one seeded database and several of them write to it
  // (approving a claim, posting a notice). Running them concurrently would
  // make failures depend on scheduling order.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "iphone", use: { ...devices["iPhone 14"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
