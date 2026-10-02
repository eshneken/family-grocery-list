import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupTestHousehold, createTestHousehold } from "@/test/factories/db";
import { addRequest, completeShoppingTrip, expireShoppingTrips, getCurrentCollectingList, markItemOutcome, SHOPPING_TIMEOUT_MS, startShoppingTrip } from "./shopping.service";

async function fixture(label: string) {
  const household = await createTestHousehold(label);
  const pending = await addRequest({ householdId: household.household.id, requestedById: household.admin.id, rawText: "Apples" });
  const purchased = await addRequest({ householdId: household.household.id, requestedById: household.admin.id, rawText: "Milk" });
  const trip = await startShoppingTrip({ householdId: household.household.id, shopperId: household.admin.id });
  return { household, pending, purchased, trip };
}

describe("shopping run timeout", () => {
  it("deduplicates a request added concurrently with scheduled carry-forward", async () => {
    const f = await fixture("timeout-request-race");
    try {
      const now = new Date(f.trip.startedAt.getTime() + SHOPPING_TIMEOUT_MS);
      await Promise.all([
        expireShoppingTrips(now),
        addRequest({ householdId: f.household.household.id, requestedById: f.household.admin.id, rawText: "Apples" })
      ]);
      const collecting = await getCurrentCollectingList(f.household.household.id);
      expect(collecting.items.filter((item) => item.displayName.toLowerCase() === "apples")).toHaveLength(1);
      expect(await prisma.itemOutcome.count({ where: { listItemId: f.pending.id } })).toBe(1);
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("keeps a run open just before four hours and closes it at the boundary without extending for activity", async () => {
    const f = await fixture("timeout-boundary");
    try {
      await markItemOutcome({ householdId: f.household.household.id, actorId: f.household.admin.id, itemId: f.purchased.id, outcome: "purchased" });
      const deadline = new Date(f.trip.startedAt.getTime() + SHOPPING_TIMEOUT_MS);
      expect((await expireShoppingTrips(new Date(deadline.getTime() - 1))).completed).toBe(0);
      expect((await expireShoppingTrips(deadline)).completed).toBe(1);
      const trip = await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: f.trip.id } });
      expect(trip).toMatchObject({ status: "completed", completionReason: "timeout", completedAt: deadline });
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: f.purchased.id } })).status).toBe("purchased");
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: f.pending.id } })).status).toBe("carried_forward");
      expect((await getCurrentCollectingList(f.household.household.id)).items.map(item => item.displayName)).toEqual(["Apples"]);
      expect(await prisma.itemOutcome.findFirst({ where: { listItemId: f.pending.id } })).toMatchObject({ actorId: f.household.admin.id, note: "Automatically moved to next list after 4 hours" });
      expect((await expireShoppingTrips(deadline)).completed).toBe(0);
      await expect(markItemOutcome({ householdId: f.household.household.id, actorId: f.household.admin.id, itemId: f.pending.id, outcome: "purchased" })).rejects.toThrow(/active shopper/);
      await expect(completeShoppingTrip(f.household.household.id, f.household.admin.id, f.trip.id)).rejects.toThrow(/already ended/);
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("catches up overdue sessions, preserves all resolved outcomes and deduplicates carry-forward by store", async () => {
    const f = await fixture("timeout-carry");
    try {
      const storeId = f.household.stores[0].id;
      const other = await prisma.listItem.create({ data: { shoppingListId: f.trip.shoppingListId, displayName: "Apples", rawText: "Apples", category: "Produce", storeId, requestedById: f.household.admin.id } });
      await markItemOutcome({ householdId: f.household.household.id, actorId: f.household.admin.id, itemId: f.purchased.id, outcome: "substituted", substituteText: "Oat milk" });
      const rejected = await prisma.listItem.create({ data: { shoppingListId: f.trip.shoppingListId, displayName: "Bread", rawText: "Bread", category: "Bakery", status: "rejected", requestedById: f.household.admin.id } });
      await addRequest({ householdId: f.household.household.id, requestedById: f.household.admin.id, rawText: "apples" });
      expect((await expireShoppingTrips(new Date(f.trip.startedAt.getTime() + 24 * 60 * 60 * 1000))).completed).toBe(1);
      const next = await getCurrentCollectingList(f.household.household.id);
      expect(next.items).toHaveLength(2);
      expect(next.items.some(item => item.storeId === storeId)).toBe(true);
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("carried_forward");
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("rejected");
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: f.purchased.id } }))).toMatchObject({ status: "substituted", substituteText: "Oat milk" });
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("finishes an overdue blocking run when starting another and rejects a stale completion form", async () => {
    const f = await fixture("timeout-fallback");
    try {
      await prisma.shoppingTrip.update({ where: { id: f.trip.id }, data: { startedAt: new Date(Date.now() - SHOPPING_TIMEOUT_MS - 1) } });
      const replacement = await startShoppingTrip({ householdId: f.household.household.id, shopperId: f.household.admin.id });
      expect(replacement.id).not.toBe(f.trip.id);
      expect((await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: f.trip.id } })).completionReason).toBe("timeout");
      await expect(completeShoppingTrip(f.household.household.id, f.household.admin.id, f.trip.id)).rejects.toThrow(/already ended/);
      await expect(markItemOutcome({ householdId: f.household.household.id, actorId: f.household.admin.id, itemId: f.pending.id, outcome: "purchased" })).rejects.toThrow(/not part/);
      expect((await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: replacement.id } })).status).toBe("active");
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("serializes simultaneous sweeps and manual completion without duplicate carry-forwards", async () => {
    const f = await fixture("timeout-race");
    try {
      const now = new Date(f.trip.startedAt.getTime() + SHOPPING_TIMEOUT_MS);
      await Promise.allSettled([expireShoppingTrips(now), expireShoppingTrips(now), completeShoppingTrip(f.household.household.id, f.household.admin.id, f.trip.id)]);
      expect((await getCurrentCollectingList(f.household.household.id)).items).toHaveLength(2);
      expect(await prisma.itemOutcome.count({ where: { listItemId: f.pending.id, outcome: "carried_forward" } })).toBe(1);
      expect((await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: f.trip.id } })).status).toBe("completed");
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("does not expire a different household's recent trip and bounds a sweep", async () => {
    const old = await fixture("timeout-old");
    const recent = await fixture("timeout-recent");
    try {
      await prisma.shoppingTrip.update({ where: { id: old.trip.id }, data: { startedAt: new Date(Date.now() - SHOPPING_TIMEOUT_MS - 1000) } });
      expect(await expireShoppingTrips(new Date(), 1)).toEqual({ scanned: 1, completed: 1 });
      expect((await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: recent.trip.id } })).status).toBe("active");
    } finally { await cleanupTestHousehold(old.household); await cleanupTestHousehold(recent.household); }
  });

  it("serializes a purchase racing with expiration so an item cannot be both purchased and carried", async () => {
    const f = await fixture("timeout-purchase-race");
    try {
      const now = new Date(f.trip.startedAt.getTime() + SHOPPING_TIMEOUT_MS);
      const [purchase, sweep] = await Promise.allSettled([
        markItemOutcome({ householdId: f.household.household.id, actorId: f.household.admin.id, itemId: f.purchased.id, outcome: "purchased" }),
        expireShoppingTrips(now)
      ]);
      expect(sweep.status).toBe("fulfilled");
      const row = await prisma.listItem.findUniqueOrThrow({ where: { id: f.purchased.id } });
      expect(row.status).toBe(purchase.status === "fulfilled" ? "purchased" : "carried_forward");
      expect(await prisma.itemOutcome.count({ where: { listItemId: row.id } })).toBe(1);
    } finally { await cleanupTestHousehold(f.household); }
  });

  it("rolls back all changes on failure so a later sweep can retry safely", async () => {
    const f = await fixture("timeout-retry");
    try {
      const next = await getCurrentCollectingList(f.household.household.id);
      await prisma.shoppingList.update({ where: { id: next.id }, data: { status: "completed" } });
      const now = new Date(f.trip.startedAt.getTime() + SHOPPING_TIMEOUT_MS);
      await expect(expireShoppingTrips(now)).rejects.toThrow();
      expect((await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: f.trip.id } })).status).toBe("active");
      expect(await prisma.itemOutcome.count({ where: { listItemId: f.pending.id } })).toBe(0);
      await prisma.shoppingList.update({ where: { id: next.id }, data: { status: "collecting" } });
      expect((await expireShoppingTrips(now)).completed).toBe(1);
    } finally { await cleanupTestHousehold(f.household); }
  });
});
