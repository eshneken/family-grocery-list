import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { approveMember, ensureSeedHousehold } from "@/features/household/household.service";
import { authOptions, authorizeGoogleProfile } from "./google-auth";

const cleanupEmails = new Set<string>();
const cleanupMemberships = new Set<string>();

function googleProfile(email: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `google-${email}`,
    sub: `google-${email}`,
    email,
    email_verified: true,
    given_name: "Google",
    family_name: "Tester",
    name: "Google Tester",
    picture: "https://example.com/avatar.png",
    ...overrides
  };
}

async function addPrimaryMember(status: "active" | "disabled" = "active") {
  await ensureSeedHousehold();
  const household = await prisma.household.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const email = `google-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@gmail.com`;
  const membership = await approveMember({
    householdId: household.id,
    email,
    firstName: "Stored",
    lastName: "Name",
    capabilities: ["request"]
  });
  if (status === "disabled") {
    await prisma.membership.update({ where: { id: membership.id }, data: { status } });
  }
  cleanupEmails.add(email);
  cleanupMemberships.add(membership.id);
  return { email, membership };
}

afterEach(async () => {
  await prisma.membership.deleteMany({ where: { id: { in: [...cleanupMemberships] } } });
  await prisma.user.deleteMany({ where: { email: { in: [...cleanupEmails] } } });
  cleanupMemberships.clear();
  cleanupEmails.clear();
});

describe.sequential("Google sign-in policy", () => {
  it("accepts only the configured Google provider at the callback boundary", async () => {
    const signIn = authOptions.callbacks?.signIn;
    expect(signIn).toBeTypeOf("function");

    await expect(
      signIn?.({ account: { provider: "github" }, profile: googleProfile("person@gmail.com") } as never)
    ).resolves.toBe(false);
  });

  it("allows a verified active stored email and updates only provider profile fields", async () => {
    const { email } = await addPrimaryMember();

    await expect(authorizeGoogleProfile(googleProfile(email))).resolves.toBe(true);
    await expect(prisma.user.findUniqueOrThrow({ where: { email } })).resolves.toMatchObject({
      firstName: "Stored",
      lastName: "Name",
      displayName: "Google Tester",
      imageUrl: "https://example.com/avatar.png",
      authProvider: "google"
    });
    const signIn = authOptions.callbacks?.signIn;
    await expect(signIn?.({ account: { provider: "google" }, profile: googleProfile(email) } as never)).resolves.toBe(true);
  });

  it("rejects unverified and malformed profiles without creating users", async () => {
    const email = `unverified-${Date.now()}@gmail.com`;
    cleanupEmails.add(email);

    await expect(authorizeGoogleProfile(googleProfile(email, { email_verified: false }))).resolves.toBe(false);
    await expect(authorizeGoogleProfile(googleProfile("not-an-email"))).resolves.toBe(false);
    await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull();
  });

  it("rejects a verified email that is not stored without creating a user", async () => {
    const email = `unknown-${Date.now()}@gmail.com`;
    cleanupEmails.add(email);

    await expect(authorizeGoogleProfile(googleProfile(email))).resolves.toBe(false);
    await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull();

    const signIn = authOptions.callbacks?.signIn;
    await expect(signIn?.({ account: { provider: "google" }, profile: googleProfile(email) } as never)).resolves.toBe(
      "/unauthorized"
    );
  });

  it("rejects a disabled membership and does not change its user provider", async () => {
    const { email } = await addPrimaryMember("disabled");

    await expect(authorizeGoogleProfile(googleProfile(email))).resolves.toBe(false);
    await expect(prisma.user.findUniqueOrThrow({ where: { email } })).resolves.toMatchObject({ authProvider: "mock" });
  });

  it("creates and links a user only after finding an approved legacy membership", async () => {
    const { email, membership } = await addPrimaryMember();
    await prisma.membership.update({ where: { id: membership.id }, data: { userId: null } });
    await prisma.user.delete({ where: { email } });

    await expect(authorizeGoogleProfile(googleProfile(email))).resolves.toBe(true);
    const linked = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id }, include: { user: true } });
    expect(linked.user).toMatchObject({ email, authProvider: "google" });
  });

  it("derives required user names when an approved legacy profile omits optional claims", async () => {
    const { email, membership } = await addPrimaryMember();
    await prisma.membership.update({ where: { id: membership.id }, data: { userId: null } });
    await prisma.user.delete({ where: { email } });

    await expect(
      authorizeGoogleProfile({ sub: `google-${email}`, email, email_verified: true })
    ).resolves.toBe(true);
    await expect(prisma.user.findUniqueOrThrow({ where: { email } })).resolves.toMatchObject({
      firstName: email.split("@")[0],
      lastName: "",
      displayName: email.split("@")[0],
      imageUrl: null
    });
  });
});
