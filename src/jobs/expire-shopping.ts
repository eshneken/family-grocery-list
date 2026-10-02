import { expireShoppingTrips } from "../features/shopping/shopping.service";
import { prisma } from "../lib/prisma";

// The process exits after a bounded sweep; Kubernetes handles scheduling and retries.
async function main() {
  try {
    const result = await expireShoppingTrips();
    console.log(JSON.stringify({ event: "shopping-timeout-sweep", ...result }));
  } catch {
    console.error("Shopping timeout sweep failed; pending sessions will be retried.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
