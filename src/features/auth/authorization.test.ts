import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupTestHousehold, createTestHousehold, type TestHousehold } from "@/test/factories/db";
import { CapabilityAuthorizationError, MembershipAuthorizationError } from "./errors";
import { getAuthenticatedIdentity } from "./identity";
import { requireCapability, requireMembership } from "./authorization";

vi.mock("./identity", () => ({ getAuthenticatedIdentity: vi.fn() }));

let testHousehold: TestHousehold | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (testHousehold) await cleanupTestHousehold(testHousehold);
  testHousehold = undefined;
});

async function setup() {
  testHousehold = await createTestHousehold("authorization");
  vi.mocked(getAuthenticatedIdentity).mockResolvedValue({
    email: testHousehold.admin.approvedEmail,
    displayName: "Authenticated Admin",
    imageUrl: null,
    provider: "google"
  });
  return testHousehold;
}

describe("authorization", () => {
  it("returns the stored active membership and its capabilities", async () => {
    const current = await setup();

    await expect(requireMembership(current.household.id)).resolves.toMatchObject({
      id: current.admin.id,
      capabilities: ["request", "shop", "administer"],
      user: { email: current.admin.approvedEmail, provider: "google" }
    });
  });

  it("falls back to authenticated profile fields when stored optional profile fields are empty", async () => {
    const current = await setup();
    await prisma.user.update({ where: { id: current.admin.userId! }, data: { displayName: null, imageUrl: null } });
    vi.mocked(getAuthenticatedIdentity).mockResolvedValue({
      email: current.admin.approvedEmail,
      displayName: "Google Profile",
      imageUrl: "https://example.com/google.png",
      provider: "google"
    });

    await expect(requireMembership(current.household.id)).resolves.toMatchObject({
      user: { displayName: "Google Profile", imageUrl: "https://example.com/google.png" }
    });
  });

  it("denies a disabled membership even when identity is still authenticated", async () => {
    const current = await setup();
    await prisma.membership.update({ where: { id: current.admin.id }, data: { status: "disabled" } });

    await expect(requireMembership(current.household.id)).rejects.toBeInstanceOf(MembershipAuthorizationError);
  });

  it("denies a capability missing from the stored membership", async () => {
    const current = await setup();
    await prisma.membership.update({ where: { id: current.admin.id }, data: { capabilities: ["request"] } });

    await expect(requireCapability("administer", current.household.id)).rejects.toBeInstanceOf(CapabilityAuthorizationError);
  });

  it("returns a membership when the stored capability is present", async () => {
    const current = await setup();

    await expect(requireCapability("administer", current.household.id)).resolves.toMatchObject({ id: current.admin.id });
  });

  it("denies when no primary household exists", async () => {
    await setup();
    vi.spyOn(prisma.household, "findFirst").mockResolvedValueOnce(null);

    await expect(requireMembership()).rejects.toBeInstanceOf(MembershipAuthorizationError);
  });

  it("denies an active membership whose user link is missing", async () => {
    const current = await setup();
    await prisma.membership.update({ where: { id: current.admin.id }, data: { userId: null } });

    await expect(requireMembership(current.household.id)).rejects.toBeInstanceOf(MembershipAuthorizationError);
  });

  it("rethrows database failures instead of misclassifying them as authorization", async () => {
    const current = await setup();
    vi.spyOn(prisma.membership, "findUnique").mockRejectedValueOnce(new Error("database unavailable"));

    await expect(requireMembership(current.household.id)).rejects.toThrow("database unavailable");
  });
});
