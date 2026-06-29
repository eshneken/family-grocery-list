import { describe, expect, it } from "vitest";
// The launcher is deliberately plain ESM so production does not require a TypeScript runtime.
// @ts-expect-error The JavaScript launcher has no declaration file.
import { resolveLaunchConfig } from "../../../scripts/run-next-config.mjs";

const googleEnv = {
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  NEXTAUTH_SECRET: "session-secret",
  NEXTAUTH_URL: "http://localhost:3000"
};

describe("Next.js auth launcher", () => {
  it("defaults dev and start to Google with their expected app environments", () => {
    expect(resolveLaunchConfig(["dev", "--turbo"], googleEnv)).toMatchObject({
      command: "dev",
      forwardedArgs: ["--turbo"],
      env: { APP_ENV: "development", AUTH_MODE: "google" }
    });
    expect(resolveLaunchConfig(["start"], googleEnv)).toMatchObject({
      command: "start",
      env: { APP_ENV: "production", AUTH_MODE: "google" }
    });
  });

  it("removes the local mock flag before forwarding Next.js arguments", () => {
    expect(resolveLaunchConfig(["start", "--hostname", "127.0.0.1", "--mock-auth"], { APP_ENV: "test" })).toMatchObject({
      forwardedArgs: ["--hostname", "127.0.0.1"],
      env: { APP_ENV: "test", AUTH_MODE: "mock" }
    });
  });

  it("rejects mock mode in production even when supplied through the environment", () => {
    expect(() => resolveLaunchConfig(["start", "--mock-auth"], {})).toThrow("Mock authentication is disabled");
    expect(() => resolveLaunchConfig(["start"], { ...googleEnv, AUTH_MODE: "mock" })).toThrow(
      "Mock authentication is disabled"
    );
  });

  it("lists missing Google configuration", () => {
    expect(() => resolveLaunchConfig(["dev"], {})).toThrow(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL"
    );
  });

  it("rejects unsupported commands and app environments", () => {
    expect(() => resolveLaunchConfig(["build"], googleEnv)).toThrow("dev or start");
    expect(() => resolveLaunchConfig(["dev"], { ...googleEnv, APP_ENV: "preview" })).toThrow("Unknown APP_ENV");
  });
});
