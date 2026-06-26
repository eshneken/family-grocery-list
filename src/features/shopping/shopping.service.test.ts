import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { addCatalogItem, addTestMember, cleanupTestHousehold, createTestHousehold } from "@/test/factories/db";
import { groupItemsByCategory, storeLabel } from "./shopping.service";
import {
  addRequest,
  completeShoppingTrip,
  getCurrentCollectingList,
  getShopperView,
  markItemOutcome,
  moveListItemCategory,
  seedRecurringStaples,
  startShoppingTrip
} from "./shopping.service";

describe("shopping service helpers", () => {
  it("groups shopper and requestor rows by category", () => {
    expect(
      groupItemsByCategory([
        { displayName: "Bananas", category: "Produce" },
        { displayName: "Milk", category: "Dairy" },
        { displayName: "Apples", category: "Produce" }
      ])
    ).toEqual({
      Produce: [
        { displayName: "Bananas", category: "Produce" },
        { displayName: "Apples", category: "Produce" }
      ],
      Dairy: [{ displayName: "Milk", category: "Dairy" }]
    });
  });

  it("labels null store sources as Any Store", () => {
    expect(storeLabel(null)).toBe("Any Store");
    expect(storeLabel({ name: "Giant" } as never)).toBe("Giant");
  });
});

describe("shopping service database behavior", () => {
  it("prevents case-insensitive duplicate pending requests for the same store", async () => {
    const testHousehold = await createTestHousehold("duplicates");
    try {
      const first = await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "Milk"
      });
      const second = await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "milk"
      });

      expect(second.id).toBe(first.id);
      const list = await getCurrentCollectingList(testHousehold.household.id);
      expect(list.items.filter((item) => item.displayName.toLowerCase() === "milk")).toHaveLength(1);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("moves an item category and marks its learned catalog item as recurring", async () => {
    const testHousehold = await createTestHousehold("category-learning");
    try {
      const item = await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "dragon fruit"
      });

      const updated = await moveListItemCategory({
        householdId: testHousehold.household.id,
        listItemId: item.id,
        category: "Produce",
        recurringStaple: true
      });
      expect(updated.category).toBe("Produce");

      const learned = await prisma.groceryItem.findUniqueOrThrow({
        where: {
          householdId_canonicalName: {
            householdId: testHousehold.household.id,
            canonicalName: "dragon fruit"
          }
        }
      });
      expect(learned.recurringStaple).toBe(true);
      await expect(
        prisma.groceryAlias.findUniqueOrThrow({
          where: { groceryItemId_alias: { groceryItemId: learned.id, alias: "dragon fruit" } }
        })
      ).resolves.toBeTruthy();
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("seeds recurring staples only once with case-insensitive duplicate control", async () => {
    const testHousehold = await createTestHousehold("recurring-dedup");
    try {
      const staple = await addCatalogItem({
        householdId: testHousehold.household.id,
        canonicalName: "Milk",
        category: "Dairy",
        recurringStaple: true
      });
      const list = await getCurrentCollectingList(testHousehold.household.id);
      await prisma.listItem.create({
        data: {
          shoppingListId: list.id,
          rawText: "milk",
          displayName: "milk",
          category: "Dairy",
          requestedById: testHousehold.admin.id
        }
      });

      await prisma.$transaction(async (tx) => {
        await seedRecurringStaples(tx, testHousehold.household.id, list.id);
      });

      const items = await prisma.listItem.findMany({ where: { shoppingListId: list.id } });
      expect(items.filter((item) => item.groceryItemId === staple.id || item.displayName.toLowerCase() === "milk")).toHaveLength(1);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("starts a trip, locks the current list, creates the next list, and blocks a second shopper", async () => {
    const testHousehold = await createTestHousehold("start-trip");
    try {
      const shopper = await addTestMember(testHousehold, "shopper", ["request", "shop"]);
      const giant = testHousehold.stores.find((store) => store.name === "Giant")!;
      await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "bananas"
      });

      const trip = await startShoppingTrip({
        householdId: testHousehold.household.id,
        shopperId: shopper.id,
        storeId: giant.id
      });
      expect(trip.status).toBe("active");

      const lists = await prisma.shoppingList.findMany({
        where: { householdId: testHousehold.household.id },
        orderBy: { createdAt: "asc" }
      });
      expect(lists.map((list) => list.status).sort()).toEqual(["collecting", "locked"]);

      await expect(
        startShoppingTrip({
          householdId: testHousehold.household.id,
          shopperId: shopper.id,
          storeId: giant.id
        })
      ).rejects.toThrow(/already shopping/);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("returns only selected-store and generic items in shopper view", async () => {
    const testHousehold = await createTestHousehold("store-filter");
    try {
      const shopper = await addTestMember(testHousehold, "shopper", ["request", "shop"]);
      const giant = testHousehold.stores.find((store) => store.name === "Giant")!;
      const wholeFoods = testHousehold.stores.find((store) => store.name === "Whole Foods")!;
      await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "bananas"
      });
      await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "giant dressing",
        storeId: giant.id
      });
      await addRequest({
        householdId: testHousehold.household.id,
        requestedById: testHousehold.admin.id,
        rawText: "whole foods peanut butter",
        storeId: wholeFoods.id
      });

      await startShoppingTrip({
        householdId: testHousehold.household.id,
        shopperId: shopper.id,
        storeId: giant.id
      });
      const view = await getShopperView(testHousehold.household.id);
      expect(view?.items.map((item) => item.displayName).sort()).toEqual(["bananas", "giant dressing"]);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("persists purchased, substituted, and rejected outcomes", async () => {
    const testHousehold = await createTestHousehold("outcomes");
    try {
      const shopper = await addTestMember(testHousehold, "shopper", ["request", "shop"]);
      const giant = testHousehold.stores.find((store) => store.name === "Giant")!;
      await addRequest({ householdId: testHousehold.household.id, requestedById: testHousehold.admin.id, rawText: "bananas" });
      await addRequest({ householdId: testHousehold.household.id, requestedById: testHousehold.admin.id, rawText: "apples" });
      await addRequest({ householdId: testHousehold.household.id, requestedById: testHousehold.admin.id, rawText: "cereal" });

      await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
      const view = await getShopperView(testHousehold.household.id);
      const [bananas, apples, cereal] = view!.items;

      await markItemOutcome({ householdId: testHousehold.household.id, actorId: shopper.id, itemId: bananas.id, outcome: "purchased" });
      await markItemOutcome({
        householdId: testHousehold.household.id,
        actorId: shopper.id,
        itemId: apples.id,
        outcome: "substituted",
        substituteText: "Gala apples",
        note: "Honeycrisp were out"
      });
      await markItemOutcome({ householdId: testHousehold.household.id, actorId: shopper.id, itemId: cereal.id, outcome: "rejected" });

      const statuses = await prisma.listItem.findMany({
        where: { id: { in: [bananas.id, apples.id, cereal.id] } },
        orderBy: { displayName: "asc" }
      });
      expect(statuses.map((item) => item.status).sort()).toEqual(["purchased", "rejected", "substituted"]);
      expect(statuses.find((item) => item.status === "substituted")?.substituteText).toBe("Gala apples");
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });

  it("completes a trip and carries only unresolved non-duplicate items forward", async () => {
    const testHousehold = await createTestHousehold("carry-forward");
    try {
      const shopper = await addTestMember(testHousehold, "shopper", ["request", "shop"]);
      const giant = testHousehold.stores.find((store) => store.name === "Giant")!;
      await addCatalogItem({
        householdId: testHousehold.household.id,
        canonicalName: "Milk",
        category: "Dairy",
        recurringStaple: true,
        aliases: ["milk"]
      });
      await addRequest({ householdId: testHousehold.household.id, requestedById: testHousehold.admin.id, rawText: "milk" });
      await addRequest({ householdId: testHousehold.household.id, requestedById: testHousehold.admin.id, rawText: "bananas" });

      await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
      const view = await getShopperView(testHousehold.household.id);
      const bananas = view!.items.find((item) => item.displayName === "bananas")!;
      await markItemOutcome({ householdId: testHousehold.household.id, actorId: shopper.id, itemId: bananas.id, outcome: "purchased" });
      const summary = await completeShoppingTrip(testHousehold.household.id, shopper.id);
      expect(summary.carriedForwardCount).toBe(1);

      const nextList = await getCurrentCollectingList(testHousehold.household.id);
      expect(nextList.items.map((item) => item.displayName.toLowerCase()).sort()).toEqual(["milk"]);
    } finally {
      await cleanupTestHousehold(testHousehold);
    }
  });
});
