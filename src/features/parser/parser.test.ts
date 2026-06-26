import { describe, expect, it } from "vitest";
import { inferCategory, normalizeRequest, parseQuantity } from "./parser";

const catalog = [
  {
    id: "item-dressing",
    householdId: "household",
    canonicalName: "Makoto Ginger Salad Dressing",
    category: "Pantry",
    defaultStoreId: "giant",
    anyStore: false,
    recurringStaple: false,
    notes: null,
    aliases: [{ id: "alias", groceryItemId: "item-dressing", alias: "ginger dressing" }],
    defaultStore: {
      id: "giant",
      householdId: "household",
      name: "Giant",
      enabled: true,
      categoryOrderJson: null
    }
  }
];

describe("parser", () => {
  it("splits simple quantity text from the item name", () => {
    expect(parseQuantity("2 gallons milk")).toEqual({
      quantityText: "2 gallons",
      itemText: "milk"
    });
  });

  it("matches aliases and applies the default store", () => {
    expect(normalizeRequest("ginger dressing", catalog)).toMatchObject({
      displayName: "Makoto Ginger Salad Dressing",
      category: "Pantry",
      storeId: "giant",
      groceryItemId: "item-dressing",
      reviewNeeded: false
    });
  });

  it("keeps unknown items reviewable with a category guess", () => {
    expect(normalizeRequest("bananas", catalog)).toMatchObject({
      displayName: "bananas",
      category: "Produce",
      groceryItemId: null,
      reviewNeeded: true
    });
  });

  it("uses deterministic category hints", () => {
    expect(inferCategory("deli turkey")).toBe("Meat/Deli");
    expect(inferCategory("paper towels")).toBe("Household");
    expect(inferCategory("cherry tomatoes")).toBe("Produce");
    expect(inferCategory("pastrami")).toBe("Meat/Deli");
  });
});
