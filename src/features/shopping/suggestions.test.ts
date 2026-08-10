import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { addCatalogItem, addTestMember, cleanupTestHousehold, createTestHousehold, type TestHousehold } from "@/test/factories/db";
import { addRequest, completeShoppingTrip, markItemOutcome, startShoppingTrip } from "./shopping.service";
import {
  AUTOCOMPLETE_ALIAS_LIMIT,
  AUTOCOMPLETE_CANDIDATE_LIMIT,
  getAutocompleteCandidates,
  getCatalogSuggestions,
  getCommonSuggestions
} from "./suggestions";

const households: TestHousehold[] = [];

/** Creates an isolated household and store references used by suggestion-ranking test scenarios. */
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
  it("builds a bounded alias-aware catalog pool while preserving canonical case", async () => {
    const { testHousehold, giant } = await setupSuggestionHousehold("autocomplete-catalog");
    const aliases = Array.from({ length: AUTOCOMPLETE_ALIAS_LIMIT + 2 }, (_, index) => `dressing alias ${index}`);
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Makoto Ginger Salad Dressing",
      category: "Pantry",
      storeId: giant.id,
      recurringStaple: true,
      aliases
    });
    await prisma.groceryItem.createMany({
      data: Array.from({ length: AUTOCOMPLETE_CANDIDATE_LIMIT + 5 }, (_, index) => ({
        householdId: testHousehold.household.id,
        canonicalName: `Catalog Item ${String(index).padStart(2, "0")}`,
        category: "Other"
      }))
    });

    const candidates = await getAutocompleteCandidates(testHousehold.household.id, {
      currentItems: [],
      enabledStoreIds: [giant.id]
    });
    const dressing = candidates.find((candidate) => candidate.displayName === "Makoto Ginger Salad Dressing")!;

    expect(candidates).toHaveLength(AUTOCOMPLETE_CANDIDATE_LIMIT);
    expect(dressing.matchTerms).toHaveLength(AUTOCOMPLETE_ALIAS_LIMIT + 1);
    expect(dressing.storeId).toBe(giant.id);
  });

  it("uses successful outcomes only and chooses the newest still-enabled historical store", async () => {
    const { testHousehold, shopper, giant } = await setupSuggestionHousehold("autocomplete-outcomes");
    const wholeFoods = testHousehold.stores.find((store) => store.name === "Whole Foods")!;
    await prisma.store.update({ where: { id: wholeFoods.id }, data: { enabled: false } });

    async function completedTrip(label: string, completedAt: Date, storeId: string, statuses: Array<"purchased" | "substituted" | "rejected" | "carried_forward">) {
      const list = await prisma.shoppingList.create({
        data: { householdId: testHousehold.household.id, status: "completed", completedAt }
      });
      await prisma.listItem.createMany({
        data: statuses.map((status, index) => ({
          shoppingListId: list.id,
          rawText: index === 0 ? label : `${status} item`,
          displayName: index === 0 ? label : `${status} item`,
          category: "Other",
          storeId: null,
          requestedById: testHousehold.admin.id,
          status
        }))
      });
      await prisma.shoppingTrip.create({
        data: {
          householdId: testHousehold.household.id,
          shoppingListId: list.id,
          activeShopperId: shopper.id,
          storeId,
          status: "completed",
          completedAt
        }
      });
    }

    await completedTrip("Favorite Tea", new Date("2026-01-01T12:00:00Z"), giant.id, ["purchased"]);
    await completedTrip(
      "Favorite Tea",
      new Date("2026-01-02T12:00:00Z"),
      wholeFoods.id,
      ["substituted", "rejected", "carried_forward"]
    );

    const candidates = await getAutocompleteCandidates(testHousehold.household.id, {
      currentItems: [],
      enabledStoreIds: [giant.id]
    });

    expect(candidates.find((candidate) => candidate.displayName === "Favorite Tea")).toMatchObject({
      score: 19,
      storeId: giant.id
    });
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("rejected item");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("carried_forward item");
  });

  it("uses supplied current-list identities to exclude canonical and free-form duplicates", async () => {
    const { testHousehold } = await setupSuggestionHousehold("autocomplete-current-items");
    const milk = await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Milk",
      category: "Dairy"
    });

    const candidates = await getAutocompleteCandidates(testHousehold.household.id, {
      currentItems: [{ groceryItemId: milk.id, displayName: "MILK" }]
    });

    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("Milk");
  });

  it("collapses catalog names that differ only by case", async () => {
    const { testHousehold } = await setupSuggestionHousehold("autocomplete-case-dedup");
    await addCatalogItem({ householdId: testHousehold.household.id, canonicalName: "Coconut Water", category: "Pantry" });
    await addCatalogItem({ householdId: testHousehold.household.id, canonicalName: "coconut water", category: "Pantry" });

    const candidates = await getAutocompleteCandidates(testHousehold.household.id, { currentItems: [] });

    const matching = candidates.filter((candidate) => candidate.displayName.toLowerCase() === "coconut water");
    expect(matching).toHaveLength(1);
    expect(matching[0].displayName).toBe("Coconut Water");
  });

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

  it("can build catalog suggestions without a current list and scores recurring staples higher", async () => {
    const { testHousehold } = await setupSuggestionHousehold("catalog-no-current-list");
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Milk",
      category: "Dairy",
      recurringStaple: true
    });
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Crackers",
      category: "Pantry"
    });

    const suggestions = await getCatalogSuggestions(testHousehold.household.id);

    expect(suggestions.map((suggestion) => suggestion.displayName)).toEqual(["Milk", "Crackers"]);
    expect(suggestions.map((suggestion) => suggestion.score)).toEqual([10, 1]);
  });

  it("excludes catalog suggestions that match current free-form item names", async () => {
    const { testHousehold } = await setupSuggestionHousehold("catalog-free-form-dedup");
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Milk",
      category: "Dairy"
    });
    const list = await prisma.shoppingList.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "collecting" }
    });
    await prisma.listItem.create({
      data: {
        shoppingListId: list.id,
        rawText: "milk",
        displayName: "milk",
        category: "Dairy",
        requestedById: testHousehold.admin.id
      }
    });

    const suggestions = await getCatalogSuggestions(testHousehold.household.id, list.id);

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

  it("suggests a completed free-form request that has no learned catalog item", async () => {
    const { testHousehold, shopper, giant } = await setupSuggestionHousehold("common-free-form");
    await addRequest({
      householdId: testHousehold.household.id,
      requestedById: testHousehold.admin.id,
      rawText: "special crackers"
    });
    await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
    const trip = await prisma.shoppingTrip.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "active" },
      include: { shoppingList: { include: { items: true } } }
    });
    await markItemOutcome({
      householdId: testHousehold.household.id,
      actorId: shopper.id,
      itemId: trip.shoppingList.items[0].id,
      outcome: "purchased"
    });
    await completeShoppingTrip(testHousehold.household.id, shopper.id);

    const currentList = await prisma.shoppingList.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "collecting" }
    });
    await expect(getCommonSuggestions(testHousehold.household.id, currentList.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ displayName: "special crackers", groceryItemId: null })])
    );
  });

  it("excludes common suggestions already on the current list", async () => {
    const { testHousehold, shopper, giant } = await setupSuggestionHousehold("common-current-list-dedup");
    await addCatalogItem({
      householdId: testHousehold.household.id,
      canonicalName: "Bananas",
      category: "Produce",
      aliases: ["bananas"]
    });
    await addRequest({
      householdId: testHousehold.household.id,
      requestedById: testHousehold.admin.id,
      rawText: "bananas"
    });
    await startShoppingTrip({ householdId: testHousehold.household.id, shopperId: shopper.id, storeId: giant.id });
    const trip = await prisma.shoppingTrip.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "active" },
      include: { shoppingList: { include: { items: true } } }
    });
    await markItemOutcome({
      householdId: testHousehold.household.id,
      actorId: shopper.id,
      itemId: trip.shoppingList.items[0].id,
      outcome: "purchased"
    });
    await completeShoppingTrip(testHousehold.household.id, shopper.id);

    const currentList = await prisma.shoppingList.findFirstOrThrow({
      where: { householdId: testHousehold.household.id, status: "collecting" }
    });
    await prisma.listItem.create({
      data: {
        shoppingListId: currentList.id,
        rawText: "bananas",
        displayName: "Bananas",
        category: "Produce",
        requestedById: testHousehold.admin.id
      }
    });

    const suggestions = await getCommonSuggestions(testHousehold.household.id, currentList.id);

    expect(suggestions.map((suggestion) => suggestion.displayName)).not.toContain("Bananas");
  });
});
