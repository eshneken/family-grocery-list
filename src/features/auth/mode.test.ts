import { describe, expect, it } from "vitest";
import { isMockAuthEnabled, resolveAppEnvironment, resolveAuthMode } from "./mode";

describe("auth mode", () => {
  it("defaults to Google", () => {
    expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("google");
    expect(resolveAppEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnvironment({})).toBe("development");
  });

  it("allows mock mode in development and test", () => {
    expect(resolveAuthMode({ APP_ENV: "development", AUTH_MODE: "mock" })).toBe("mock");
    expect(resolveAuthMode({ APP_ENV: "test", AUTH_MODE: "mock" })).toBe("mock");
    expect(isMockAuthEnabled({ APP_ENV: "test", AUTH_MODE: "mock" })).toBe(true);
    expect(isMockAuthEnabled({ APP_ENV: "test", AUTH_MODE: "google" })).toBe(false);
  });

  it("rejects mock mode in production", () => {
    expect(() => resolveAuthMode({ APP_ENV: "production", AUTH_MODE: "mock" })).toThrow(
      "Mock authentication is disabled"
    );
  });

  it("rejects unknown environment and auth mode values", () => {
    expect(() => resolveAppEnvironment({ APP_ENV: "preview" })).toThrow("Unknown APP_ENV");
    expect(() => resolveAuthMode({ APP_ENV: "test", AUTH_MODE: "fake" })).toThrow("Unknown AUTH_MODE");
  });
});
