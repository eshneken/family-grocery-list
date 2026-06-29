import { z } from "zod";
import { normalizeEmail } from "@/features/auth/email";
import { prisma } from "@/lib/prisma";
import { defaultStores } from "./household.service";

export class BootstrapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapConflictError";
  }
}

export async function bootstrapHousehold(input: { householdName: string; adminEmail: string }) {
  const householdName = input.householdName.trim();
  const adminEmail = normalizeEmail(input.adminEmail);
  if (!householdName) throw new Error("Household name is required.");
  if (!z.string().email().safeParse(adminEmail).success) throw new Error("A valid administrator email is required.");

  return prisma.$transaction(async (tx) => {
    const existingHousehold = await tx.household.findFirst({ orderBy: { createdAt: "asc" } });
    if (existingHousehold) {
      const existingAdmin = await tx.membership.findUnique({
        where: {
          householdId_approvedEmail: {
            householdId: existingHousehold.id,
            approvedEmail: adminEmail
          }
        },
        include: { user: true }
      });
      const matches =
        existingHousehold.name === householdName &&
        existingAdmin?.status === "active" &&
        existingAdmin.capabilities.includes("administer") &&
        existingAdmin.user?.email === adminEmail;
      if (!matches) {
        throw new BootstrapConflictError(
          "A household already exists and does not match this active administrator. Use the Admin page to change membership."
        );
      }
      return { household: existingHousehold, membership: existingAdmin, created: false as const };
    }

    const firstName = adminEmail.split("@")[0];
    const user = await tx.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        firstName,
        lastName: "",
        displayName: firstName,
        authProvider: "google"
      }
    });
    const household = await tx.household.create({ data: { name: householdName } });
    const membership = await tx.membership.create({
      data: {
        householdId: household.id,
        userId: user.id,
        approvedEmail: adminEmail,
        status: "active",
        capabilities: ["request", "shop", "administer"]
      },
      include: { user: true }
    });

    await Promise.all([
      ...defaultStores.map((name) =>
        tx.store.create({
          data: {
            householdId: household.id,
            name,
            enabled: true,
            categoryOrderJson: ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"]
          }
        })
      ),
      tx.shoppingList.create({ data: { householdId: household.id, status: "collecting" } })
    ]);

    return { household, membership, created: true as const };
  });
}
