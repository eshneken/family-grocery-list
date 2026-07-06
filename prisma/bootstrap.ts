import { bootstrapHousehold } from "../src/features/household/bootstrap.service";
import { prisma } from "../src/lib/prisma";

/** Reads the token following a named CLI option without introducing another argument dependency. */
function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Validates bootstrap CLI input and delegates idempotent first-household creation to the service. */
async function main() {
  const adminEmail = readArgument("--admin-email");
  const householdName = readArgument("--household-name");
  if (!adminEmail || !householdName) {
    throw new Error("Usage: npm run db:bootstrap -- --admin-email <email> --household-name <name>");
  }

  const result = await bootstrapHousehold({ adminEmail, householdName });
  console.log(result.created ? `Created ${result.household.name}.` : `${result.household.name} is already bootstrapped.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
