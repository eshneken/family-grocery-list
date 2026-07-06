export type AppEnvironment = "development" | "test" | "production";
export type AuthMode = "google" | "mock";

type Environment = Record<string, string | undefined>;

/** Validates the app environment rather than letting an unknown value silently choose defaults. */
export function resolveAppEnvironment(env: Environment = process.env): AppEnvironment {
  const appEnv = env.APP_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
  if (appEnv !== "development" && appEnv !== "test" && appEnv !== "production") {
    throw new Error(`Unknown APP_ENV: ${appEnv}`);
  }
  return appEnv;
}

/** Validates the auth mode and forbids test-only mock authentication in production. */
export function resolveAuthMode(env: Environment = process.env): AuthMode {
  const mode = env.AUTH_MODE ?? "google";
  if (mode !== "google" && mode !== "mock") {
    throw new Error(`Unknown AUTH_MODE: ${mode}`);
  }
  if (mode === "mock" && resolveAppEnvironment(env) === "production") {
    throw new Error("Mock authentication is disabled when APP_ENV=production.");
  }
  return mode;
}

/** Convenience guard for code that needs to select the mock-auth flow. */
export function isMockAuthEnabled(env: Environment = process.env) {
  return resolveAuthMode(env) === "mock";
}
