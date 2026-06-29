import type { Capability, Prisma } from "@prisma/client";
import { normalizeEmail } from "@/features/auth/email";
import { prisma } from "@/lib/prisma";

export const defaultStores = ["Giant", "Whole Foods", "Trader Joe's"];

export async function createHousehold(name: string, adminEmail: string) {
  const normalizedEmail = normalizeEmail(adminEmail);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: normalizedEmail },
      update: {},
      create: {
        email: normalizedEmail,
        firstName: "Rachel",
        lastName: "Shneken",
        displayName: "Rachel",
        imageUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Rachel",
        authProvider: "mock"
      }
    });

    const household = await tx.household.create({ data: { name } });

    await tx.membership.create({
      data: {
        householdId: household.id,
        userId: user.id,
        approvedEmail: normalizedEmail,
        status: "active",
        capabilities: ["request", "shop", "administer"]
      }
    });

    await Promise.all(
      defaultStores.map((store) =>
        tx.store.create({
          data: {
            householdId: household.id,
            name: store,
            enabled: true,
            categoryOrderJson: ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"]
          }
        })
      )
    );

    await tx.shoppingList.create({
      data: { householdId: household.id, status: "collecting" }
    });

    return household;
  });
}

export async function ensureSeedHousehold() {
  const household = await prisma.household.findFirst();
  if (household) return household;
  return createHousehold("Shneken Family", "rachel@example.com");
}

export async function approveMember(input: {
  householdId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  capabilities: Capability[];
}) {
  const approvedEmail = normalizeEmail(input.email);
  const firstName = input.firstName?.trim() || approvedEmail.split("@")[0];
  const lastName = input.lastName?.trim() || "Family";

  const user = await prisma.user.upsert({
    where: { email: approvedEmail },
    update: { firstName, lastName, imageUrl: input.imageUrl },
    create: {
      email: approvedEmail,
      firstName,
      lastName,
      displayName: firstName,
      imageUrl: input.imageUrl ?? `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(firstName)}`,
      authProvider: "mock"
    }
  });

  return prisma.membership.upsert({
    where: {
      householdId_approvedEmail: {
        householdId: input.householdId,
        approvedEmail
      }
    },
    update: {
      userId: user.id,
      status: "active",
      capabilities: input.capabilities
    },
    create: {
      householdId: input.householdId,
      userId: user.id,
      approvedEmail,
      status: "active",
      capabilities: input.capabilities
    },
    include: { user: true }
  });
}

export async function disableMember(membershipId: string) {
  return prisma.membership.update({
    where: { id: membershipId },
    data: { status: "disabled" }
  });
}

export async function setMemberStatus(membershipId: string, status: "active" | "disabled") {
  return prisma.membership.update({
    where: { id: membershipId },
    data: { status }
  });
}

export async function updateMember(input: {
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  capabilities: Capability[];
}) {
  const approvedEmail = normalizeEmail(input.email);
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { id: input.membershipId },
    include: { user: true }
  });

  const user = await prisma.user.upsert({
    where: { email: approvedEmail },
    update: {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      displayName: input.firstName.trim()
    },
    create: {
      email: approvedEmail,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      displayName: input.firstName.trim(),
      imageUrl: membership.user?.imageUrl ?? `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(input.firstName.trim())}`,
      authProvider: "mock"
    }
  });

  return prisma.membership.update({
    where: { id: input.membershipId },
    data: {
      userId: user.id,
      approvedEmail,
      capabilities: input.capabilities
    },
    include: { user: true }
  });
}

export async function addStore(householdId: string, name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Store name is required.");
  return prisma.store.upsert({
    where: { householdId_name: { householdId, name: trimmedName } },
    update: { enabled: true },
    create: {
      householdId,
      name: trimmedName,
      enabled: true,
      categoryOrderJson: ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"]
    }
  });
}

export async function configureStores(
  householdId: string,
  stores: Array<{ id?: string; name: string; enabled: boolean }>
) {
  return prisma.$transaction(
    stores.map((store) => {
      const data: Prisma.StoreUncheckedCreateInput = {
        householdId,
        name: store.name.trim(),
        enabled: store.enabled,
        categoryOrderJson: ["Produce", "Dairy", "Meat/Deli", "Pantry", "Frozen", "Household", "Bakery", "Other"]
      };

      if (store.id) {
        return prisma.store.update({
          where: { id: store.id },
          data: { name: data.name, enabled: data.enabled }
        });
      }

      return prisma.store.upsert({
        where: { householdId_name: { householdId, name: data.name } },
        update: { enabled: data.enabled },
        create: data
      });
    })
  );
}
