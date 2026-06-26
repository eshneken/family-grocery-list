import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { addCatalogItem, addTestMember, cleanupTestHousehold, createTestHousehold, type TestHousehold } from "@/test/factories/db";
import { addRequest, completeShoppingTrip, markItemOutcome, startShoppingTrip } from "./shopping.service";
import { getCatalogSuggestions, getCommonSuggestions } from "./suggestions";

const households: TestHousehold[] = [];

async function setupSuggestionHousehold(label: string) {
  const testHousehold = await createTestHousehold(label);
  households.push(testHousehold);
  const shopper = await addTestMember(testHousehold, `${label}-shopper`, ["request", "shop"]);
  const giant = testHousehold.stores.find((store) => store.name === "Giant")!;
  return { testHousehold, shopper, giant };
}

afterAll(async () => {
  await Promise.all(households.map(cleanupTestHousehold));
  await prisma.$disconnect();
});

describe("shopping suggestions", () => {
  it("excludes catalog suggestions already on the current list", async () => {
    const { testHousehold } = await setupSuggestionHousehold("catalog-suggestions");
    const milk = await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Milk",
      category: "Dairy",
      recurringStaple: true
    });
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Bananas",
      category: "Produce"
    });
    const list = await prisma.shoppingList.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "collecting" }
    });
    await prisma.listItem.create({
      data: {
        shoppingListId: list.id,
        groceryItemId: milk.id,
        rawText: "milk",
        displayName: "Milk",
        category: "Dairy",
        requestedById: testHousehold.admin.id
      }
    });

    const suggestions = await getCatalogSuggestions(testHousehold.household.id, list.id);
    expect(suggestions.map((suggestion) => suggestion.displayName)).toContain("Bananas");
    expect(suggestions.map((suggestion) => suggestion.displayName)).not.toContain("Milk");
  });

  it("uses only recent completed runs and weights newer trips more strongly", async () => {
    const { testHousehold, shopper, giant } = await setupSuggestionHousehold("common-suggestions");
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Recent Favorite",
      category: "Pantry",
      aliases: ["recent favorite"]
    });
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Older Favorite",
      category: "Pantry",
      aliases: ["older favorite"]
    });

    await addRequest({
      householdId: testHousehold.household.id,
      requestedById: testHousehold.admin.id,
      rawText: "older favorite"
    });
    await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
    let view = await prisma.shoppingTrip.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "active" },
      include: { shoppingList: { include: { items: true } } }
    });
    await markItemOutcome({
      householdId: testHousehold.household.id,
      actorId: shopper.id,
      itemId: view.shoppingList.items[0].id,
      outcome: "purchased"
    });
    await completeShoppingTrip(testHousehold.household.id, shopper.id);

    await addRequest({
      householdId: testHousehold.household.id,
      requestedById: testHousehold.admin.id,
      rawText: "recent favorite"
    });
    await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
    view = await prisma.shoppingTrip.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "active" },
      include: { shoppingList: { include: { items: true } } }
    });
    const recent = view.shoppingList.items.find((item) => item.displayName === "Recent Favorite")!;
    await markItemOutcome({
      householdId: testHousehold.household.id,
      actorId: shopper.id,
      itemId: recent.id,
      outcome: "purchased"
    });
    await completeShoppingTrip(testHousehold.household.id, shopper.id);

    const currentList = await prisma.shoppingList.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "collecting" }
    });
    const suggestions = await getCommonSuggestions(testHousehold.household.id, currentList.id);
    expect(suggestions[0].displayName).toBe("Recent Favorite");
  });
});
