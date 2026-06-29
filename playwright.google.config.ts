import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth-shell.spec.ts",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "npm run build && APP_ENV=production GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret NEXTAUTH_SECRET=test-session-secret-at-least-32-characters NEXTAUTH_URL=http://127.0.0.1:3200 PORT=3200 npm run start",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [{ name: "Google auth shell", use: { ...devices["Desktop Chrome"] } }]
});
