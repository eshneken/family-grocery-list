import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { BootstrapConflictError, bootstrapHousehold } from "./bootstrap.service";

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn() }
}));

function transactionFixture() {
  return {
    household: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "household-1", name: "Test Family" })
    },
    membership: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: "membership-1",
        status: "active",
        capabilities: ["request", "shop", "administer"],
        user: { email: "admin@gmail.com" }
      })
    },
    user: {
      upsert: vi.fn().mockResolvedValue({ id: "user-1", email: "admin@gmail.com" })
    },
    store: { create: vi.fn().mockResolvedValue({}) },
    shoppingList: { create: vi.fn().mockResolvedValue({}) }
  };
}

describe("production household bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the complete first household state", async () => {
    const tx = transactionFixture();
    tx.household.findFirst.mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(bootstrapHousehold({ householdName: " Test Family ", adminEmail: " Admin@Gmail.com " })).resolves.toMatchObject({
      created: true,
      household: { id: "household-1" }
    });
    expect(tx.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "admin@gmail.com" } }));
    expect(tx.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ capabilities: ["request", "shop", "administer"] }) })
    );
    expect(tx.store.create).toHaveBeenCalledTimes(3);
    expect(tx.shoppingList.create).toHaveBeenCalledOnce();
  });

  it("is a no-op when the same active administrator is already bootstrapped", async () => {
    const tx = transactionFixture();
    tx.household.findFirst.mockResolvedValue({ id: "household-1", name: "Test Family" });
    tx.membership.findUnique.mockResolvedValue({
      id: "membership-1",
      status: "active",
      capabilities: ["request", "shop", "administer"],
      user: { email: "admin@gmail.com" }
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(bootstrapHousehold({ householdName: "Test Family", adminEmail: "admin@gmail.com" })).resolves.toMatchObject({
      created: false
    });
    expect(tx.user.upsert).not.toHaveBeenCalled();
    expect(tx.household.create).not.toHaveBeenCalled();
  });

  it("rejects a conflicting administrator without mutating data", async () => {
    const tx = transactionFixture();
    tx.household.findFirst.mockResolvedValue({ id: "household-1", name: "Test Family" });
    tx.membership.findUnique.mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(bootstrapHousehold({ householdName: "Test Family", adminEmail: "other@gmail.com" })).rejects.toBeInstanceOf(
      BootstrapConflictError
    );
    expect(tx.user.upsert).not.toHaveBeenCalled();
    expect(tx.household.create).not.toHaveBeenCalled();
  });

  it("rejects missing household and malformed administrator inputs before opening a transaction", async () => {
    await expect(bootstrapHousehold({ householdName: " ", adminEmail: "admin@gmail.com" })).rejects.toThrow(
      "Household name is required"
    );
    await expect(bootstrapHousehold({ householdName: "Family", adminEmail: "not-an-email" })).rejects.toThrow(
      "valid administrator email"
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
