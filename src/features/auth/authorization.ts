import type { Capability } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CapabilityAuthorizationError, MembershipAuthorizationError } from "./errors";
import { getAuthenticatedIdentity } from "./identity";
import type { AuthorizedMembership } from "./types";

export async function getPrimaryHouseholdId() {
  const household = await prisma.household.findFirst({ orderBy: { createdAt: "asc" } });
  return household?.id ?? null;
}

export async function requireMembership(householdId?: string): Promise<AuthorizedMembership> {
  const identity = await getAuthenticatedIdentity();
  const resolvedHouseholdId = householdId ?? (await getPrimaryHouseholdId());

  if (!resolvedHouseholdId) {
    throw new MembershipAuthorizationError("No household has been created yet.");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      householdId_approvedEmail: {
        householdId: resolvedHouseholdId,
        approvedEmail: identity.email
      }
    },
    include: { user: true }
  });

  if (!membership || membership.status !== "active" || !membership.user) {
    throw new MembershipAuthorizationError();
  }

  return {
    id: membership.id,
    householdId: membership.householdId,
    approvedEmail: membership.approvedEmail,
    status: "active",
    capabilities: membership.capabilities,
    user: {
      id: membership.user.id,
      email: identity.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      displayName: membership.user.displayName ?? identity.displayName,
      imageUrl: membership.user.imageUrl ?? identity.imageUrl,
      provider: identity.provider
    }
  };
}

export async function requireCapability(capability: Capability, householdId?: string) {
  const membership = await requireMembership(householdId);

  if (!membership.capabilities.includes(capability)) {
    throw new CapabilityAuthorizationError(capability);
  }

  return membership;
}
