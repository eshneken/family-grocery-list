import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupTestHousehold, createTestHousehold } from "@/test/factories/db";
import { addStore, approveMember, configureStores, disableMember, ensureSeedHousehold, setMemberStatus, updateMember } from "./household.service";
import { normalizeEmail } from "@/features/auth/email";

describe("household service helpers", () => {
  it("normalizes approved emails before membership lookup", () => {
    expect(normalizeEmail("  Ed@Example.COM ")).toBe("ed@example.com");
  });
});

describe("household service database behavior", () => {
  it("adds, edits, disables, and re-enables members", async () => {
    const testHousehold = await createTestHousehold("members");
    try {
      const member = await approveMember({
        householdId: testHousehold.household.id,
        email: " Edit-Me@Example.COM ",
        firstName: "Edit",
        lastName: "Me",
        capabilities: ["request"]
      });

      expect(member.approvedEmail).toBe("edit-me@example.com");
      expect(member.capabilities).toEqual(["request"]);

      const updated = await updateMember({
        membershipId: member.id,
        email: "edited@example.com",
        firstName: "Edited",
        lastName: "Member",
        capabilities: ["request", "shop"]
      });
      expect(updated.user?.firstName).toBe("Edited");
      expect(updated.capabilities).toEqual(["request", "shop"]);

      await setMemberStatus(member.id, "disabled");
      await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({
        status: "disabled"
      });

      await setMemberStatus(member.id, "active");
      await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({
        status: "active"
      });

      await disableMember(member.id);
      await expect(prisma.membership.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({
        status: "disabled"
      });
    } finally {
      await cleanupTestHousehold(testHousehold);
      await prisma.user.deleteMany({ where: { email: { in: ["edit-me@example.com", "edited@example.com"] } } });
    }
  });

  it("adds a store or re-enables an existing store by name", async () => {
    const testHousehold = await createTestHousehold("stores");
    try {
      const store = await addStore(testHousehold.household.id, "Costco");
      expect(store.enabled).toBe(true);

      await prisma.store.update({ where: { id: store.id }, data: { enabled: false } });
      const reenabled = await addStore(testHousehold.household.id, "Costco");
      expect(reenabled.id).toBe(store.id);
      expect(reenabled.enabled).toBe(true);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("returns an existing household from seed ensure without creating another", async () => {
    const testHousehold = await createTestHousehold("ensure-seed");
    try {
      const countBefore = await prisma.household.count();
      const ensured = await ensureSeedHousehold();
      const countAfter = await prisma.household.count();

      expect(ensured.id).toBeTruthy();
      expect(countAfter).toBe(countBefore);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("configures existing and new stores in one call", async () => {
    const testHousehold = await createTestHousehold("configure-stores");
    try {
      const giant = testHousehold.stores.find((store) => store.name === "Giant")!;

      const stores = await configureStores(testHousehold.household.id, [
        { id: giant.id, name: "Giant", enabled: false },
        { name: "Aldi", enabled: true }
      ]);

      expect(stores).toHaveLength(2);
      await expect(prisma.store.findUniqueOrThrow({ where: { id: giant.id } })).resolves.toMatchObject({
        enabled: false
      });
      await expect(
        prisma.store.findUniqueOrThrow({
          where: { householdId_name: { householdId: testHousehold.household.id, name: "Aldi" } }
        })
      ).resolves.toMatchObject({ enabled: true });
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });
});
