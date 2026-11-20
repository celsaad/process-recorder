import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const LIVE = process.env.GEMINI_LIVE === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse a server we didn't start: a plain `pnpm dev` on :3100 has no fake Gemini.
    reuseExistingServer: false,
    timeout: 240_000,
    // The live spec needs the real Gemini client, so the fake is only on for the other runs.
    env: LIVE ? {} : { GEMINI_FAKE: "1" },
  },
});
