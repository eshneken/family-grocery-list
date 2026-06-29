import { describe, expect, it, vi } from "vitest";
// The launcher is deliberately plain ESM so production does not require a TypeScript runtime.
// @ts-expect-error The JavaScript launcher has no declaration file.
import { prepareLaunchConfig } from "../../../scripts/run-next.mjs";

describe("Next.js environment loading", () => {
  it("loads the project environment before validating Google configuration", () => {
    const env: Record<string, string> = {};
    const loadEnvironment = vi.fn(() => {
      env.GOOGLE_CLIENT_ID = "client";
      env.GOOGLE_CLIENT_SECRET = "secret";
      env.NEXTAUTH_SECRET = "session-secret";
      env.NEXTAUTH_URL = "http://localhost:3000";
    });

    expect(prepareLaunchConfig(["dev"], env, loadEnvironment)).toMatchObject({
      env: { AUTH_MODE: "google", APP_ENV: "development" }
    });
    expect(loadEnvironment).toHaveBeenCalledWith(process.cwd(), true);
  });

  it("keeps production mock-mode rejection after environment loading", () => {
    const loadEnvironment = vi.fn();

    expect(() => prepareLaunchConfig(["start", "--mock-auth"], {}, loadEnvironment)).toThrow(
      "Mock authentication is disabled"
    );
    expect(loadEnvironment).toHaveBeenCalledWith(process.cwd(), false);
  });
});
