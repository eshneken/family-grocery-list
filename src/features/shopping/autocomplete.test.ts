import { describe, expect, it } from "vitest";
import {
  getAutocompleteMatches,
  indexAutocompleteCandidates,
  normalizeAutocompleteWords
} from "./autocomplete";
import type { AutocompleteCandidate } from "./suggestions";

function candidate(
  displayName: string,
  matchTerms: string[] = [displayName],
  score = 1
): AutocompleteCandidate {
  return {
    displayName,
    matchTerms,
    score,
    groceryItemId: displayName,
    category: "Pantry",
    storeId: null
  };
}

describe("Quick Add autocomplete matching", () => {
  it("normalizes case, punctuation, whitespace, and Unicode words without changing candidates", () => {
    expect(normalizeAutocompleteWords("  CRÈME—Fraîche  ")).toEqual(["crème", "fraîche"]);
    expect(normalizeAutocompleteWords("***")).toEqual([]);
  });

  it("matches the beginning of any word case-insensitively and preserves display case", () => {
    const indexed = indexAutocompleteCandidates([
      candidate("Makoto Ginger Salad Dressing"),
      candidate("Milk")
    ]);

    expect(getAutocompleteMatches(indexed, "DRESS").map((item) => item.displayName)).toEqual([
      "Makoto Ginger Salad Dressing"
    ]);
    expect(getAutocompleteMatches(indexed, "mil")[0].displayName).toBe("Milk");
    expect(getAutocompleteMatches(indexed, "alad")).toEqual([]);
  });

  it("supports ordered multiword prefixes", () => {
    const indexed = indexAutocompleteCandidates([candidate("Makoto Ginger Salad Dressing")]);
    expect(getAutocompleteMatches(indexed, "gin dre")).toHaveLength(1);
    expect(getAutocompleteMatches(indexed, "dre gin")).toEqual([]);
  });

  it("finds aliases but ranks canonical full and word prefixes ahead of alias matches", () => {
    const indexed = indexAutocompleteCandidates([
      candidate("Cola Syrup", ["Cola Syrup"]),
      candidate("Coca-Cola", ["Coca-Cola", "Coke", "Cola"]),
      candidate("Vanilla Cola", ["Vanilla Cola"])
    ]);

    expect(getAutocompleteMatches(indexed, "cola").map((item) => item.displayName)).toEqual([
      "Cola Syrup",
      "Coca-Cola",
      "Vanilla Cola"
    ]);
    expect(getAutocompleteMatches(indexed, "coke")[0].displayName).toBe("Coca-Cola");
  });

  it("retains server order for equal matches, respects limits, and handles an empty query", () => {
    const source = Array.from({ length: 8 }, (_, index) => candidate(`Milk ${index}`, undefined, 8 - index));
    const indexed = indexAutocompleteCandidates(source);

    expect(getAutocompleteMatches(indexed, "milk").map((item) => item.displayName)).toEqual(
      source.slice(0, 6).map((item) => item.displayName)
    );
    expect(getAutocompleteMatches(indexed, "milk", 2)).toHaveLength(2);
    expect(getAutocompleteMatches(indexed, "   ")).toEqual([]);
    expect(source).toHaveLength(8);
  });
});
