import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupTestHousehold, createTestHousehold } from "@/test/factories/db";
import { addStore, approveMember, setMemberStatus, updateMember } from "./household.service";
import { normalizeEmail } from "./household.service";

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
});
