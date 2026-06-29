const GOOGLE_ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];

export function resolveLaunchConfig(argv, sourceEnv = process.env) {
  const [command, ...rawArgs] = argv;
  if (command !== "dev" && command !== "start") {
    throw new Error("run-next requires either the dev or start command.");
  }

  const mockAuth = rawArgs.includes("--mock-auth");
  const forwardedArgs = rawArgs.filter((argument) => argument !== "--mock-auth");
  const appEnv = sourceEnv.APP_ENV || (command === "dev" ? "development" : "production");
  const authMode = mockAuth ? "mock" : "google";

  if (!new Set(["development", "test", "production"]).has(appEnv)) {
    throw new Error(`Unknown APP_ENV: ${appEnv}`);
  }
  if (appEnv === "production" && (mockAuth || sourceEnv.AUTH_MODE === "mock")) {
    throw new Error("Mock authentication is disabled when APP_ENV=production.");
  }

  if (authMode === "google") {
    const missing = GOOGLE_ENV_KEYS.filter((key) => !sourceEnv[key]?.trim());
    if (missing.length > 0) {
      throw new Error(`Google authentication requires: ${missing.join(", ")}`);
    }
  }

  return {
    command,
    forwardedArgs,
    env: {
      ...sourceEnv,
      APP_ENV: appEnv,
      AUTH_MODE: authMode
    }
  };
}
