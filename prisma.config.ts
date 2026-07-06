import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

// Prisma stops loading .env automatically when a config file exists. CI supplies DATABASE_URL
// directly, while local development needs the same value loaded from the ignored .env file.
if (existsSync(".env")) loadEnvFile(".env");

/**
 * Central Prisma CLI configuration.
 * Keeping the schema, migrations, and seed command here replaces the deprecated package.json key.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  }
});
