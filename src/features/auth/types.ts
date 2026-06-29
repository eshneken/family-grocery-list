import type { Capability } from "@prisma/client";

export type AuthenticatedIdentity = {
  email: string;
  displayName: string;
  imageUrl: string | null;
  provider: "mock" | "google";
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  imageUrl: string | null;
  provider: "mock" | "google";
};

export type AuthorizedMembership = {
  id: string;
  householdId: string;
  approvedEmail: string;
  status: "active";
  capabilities: Capability[];
  user: CurrentUser;
};
