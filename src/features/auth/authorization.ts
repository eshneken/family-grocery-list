import type { Capability } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "./mock-auth";
import type { AuthorizedMembership } from "./types";

export class AuthorizationError extends Error {
  constructor(message = "You are not authorized for this household.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function getPrimaryHouseholdId() {
  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
  return household?.id ?? null;
}

export async function requireMembership(householdId?: string): Promise<AuthorizedMembership> {
  const user = await getCurrentUser();
  const resolvedHouseholdId = householdId ?? (await getPrimaryHouseholdId());

  if (!resolvedHouseholdId) {
    throw new AuthorizationError("No household has been created yet.");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      householdId_approvedEmail: {
        householdId: resolvedHouseholdId,
        approvedEmail: user.email.toLowerCase()
      }
    }
  });

  if (!membership || membership.status !== "active") {
    throw new AuthorizationError("This Google account is not approved for this household.");
  }

  if (!membership.userId) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { userId: user.id }
    });
  }

  return {
    id: membership.id,
    householdId: membership.householdId,
    approvedEmail: membership.approvedEmail,
    status: "active",
    capabilities: membership.capabilities,
    user
  };
}

export async function requireCapability(capability: Capability, householdId?: string) {
  const membership = await requireMembership(householdId);

  if (!membership.capabilities.includes(capability)) {
    throw new AuthorizationError(`You need ${capability} access to do that.`);
  }

  return membership;
}
