import { describe, expect, it } from "vitest";
import { groupItemsByCategory, storeLabel } from "./shopping.service";

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
