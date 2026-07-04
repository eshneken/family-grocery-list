import { afterEach, describe, expect, it, vi } from "vitest";
// The launcher is deliberately plain ESM so production does not require a TypeScript runtime.
// @ts-expect-error The JavaScript launcher has no declaration file.
import { launchNext, prepareLaunchConfig } from "../../../scripts/run-next.mjs";

describe("Next.js environment loading", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

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

  it("launches Next.js and forwards child lifecycle failures", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const child = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
        return child;
      })
    };
    const spawnProcess = vi.fn(() => child);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      GOOGLE_CLIENT_ID: "client",
      GOOGLE_CLIENT_SECRET: "secret",
      NEXTAUTH_SECRET: "session-secret",
      NEXTAUTH_URL: "http://localhost:3000"
    };

    expect(launchNext(["start", "--hostname", "127.0.0.1"], env, vi.fn(), spawnProcess)).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["start", "--hostname", "127.0.0.1"]),
      expect.objectContaining({ env: expect.objectContaining({ APP_ENV: "production", AUTH_MODE: "google" }) })
    );

    handlers.error(new Error("port is busy"));
    expect(consoleError).toHaveBeenCalledWith("Unable to start Next.js: port is busy");
    expect(process.exitCode).toBe(1);

    handlers.exit(0, null);
    expect(process.exitCode).toBe(0);
    handlers.exit(undefined, null);
    expect(process.exitCode).toBe(1);
    handlers.exit(null, "SIGTERM");
    expect(process.exitCode).toBe(1);
  });
});
