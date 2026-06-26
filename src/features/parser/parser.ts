import type { GroceryAlias, GroceryItem, Store } from "@prisma/client";

export type CatalogMatch = GroceryItem & {
  aliases: GroceryAlias[];
  defaultStore: Store | null;
};

export type ParsedRequest = {
  rawText: string;
  displayName: string;
  quantityText: string | null;
  category: string;
  storeId: string | null;
  groceryItemId: string | null;
  reviewNeeded: boolean;
};

const categoryHints: Array<[string, string]> = [
  ["tomato", "Produce"],
  ["tomatoes", "Produce"],
  ["cherry tomato", "Produce"],
  ["lettuce", "Produce"],
  ["spinach", "Produce"],
  ["broccoli", "Produce"],
  ["carrot", "Produce"],
  ["onion", "Produce"],
  ["potato", "Produce"],
  ["avocado", "Produce"],
  ["berry", "Produce"],
  ["berries", "Produce"],
  ["grape", "Produce"],
  ["orange", "Produce"],
  ["lemon", "Produce"],
  ["lime", "Produce"],
  ["banana", "Produce"],
  ["apple", "Produce"],
  ["salad", "Produce"],
  ["egg", "Dairy"],
  ["butter", "Dairy"],
  ["cream", "Dairy"],
  ["milk", "Dairy"],
  ["yogurt", "Dairy"],
  ["cheese", "Dairy"],
  ["pastrami", "Meat/Deli"],
  ["ham", "Meat/Deli"],
  ["salami", "Meat/Deli"],
  ["roast beef", "Meat/Deli"],
  ["bacon", "Meat/Deli"],
  ["sausage", "Meat/Deli"],
  ["ground beef", "Meat/Deli"],
  ["beef", "Meat/Deli"],
  ["pork", "Meat/Deli"],
  ["fish", "Meat/Deli"],
  ["salmon", "Meat/Deli"],
  ["deli", "Meat/Deli"],
  ["turkey", "Meat/Deli"],
  ["chicken", "Meat/Deli"],
  ["peanut butter", "Pantry"],
  ["cereal", "Pantry"],
  ["dressing", "Pantry"],
  ["paper", "Household"],
  ["detergent", "Household"],
  ["bread", "Bakery"],
  ["bagel", "Bakery"],
  ["frozen", "Frozen"]
];

const quantityPattern =
  /^((?:\d+(?:\.\d+)?|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bhalf\b)\s*(?:x|ct|count|lb|lbs|oz|gallon|gallons|bag|bags|box|boxes|loaf|loaves|dozen)?\s+)/i;

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function parseQuantity(rawText: string) {
  const normalized = normalizeWhitespace(rawText);
  const match = normalized.match(quantityPattern);
  if (!match) {
    return { quantityText: null, itemText: normalized };
  }

  return {
    quantityText: normalizeWhitespace(match[1]),
    itemText: normalizeWhitespace(normalized.slice(match[1].length))
  };
}

export function inferCategory(itemText: string) {
  const lower = itemText.toLowerCase();
  return categoryHints.find(([hint]) => lower.includes(hint))?.[1] ?? "Other";
}

export function normalizeRequest(rawText: string, catalog: CatalogMatch[], explicitStoreId?: string | null): ParsedRequest {
  const raw = normalizeWhitespace(rawText);
  const { quantityText, itemText } = parseQuantity(raw);
  const lower = itemText.toLowerCase();
  const matched = catalog.find((item) => {
    if (item.canonicalName.toLowerCase() === lower) return true;
    return item.aliases.some((alias) => alias.alias.toLowerCase() === lower);
  });

  return {
    rawText: raw,
    displayName: matched?.canonicalName ?? itemText,
    quantityText,
    category: matched?.category ?? inferCategory(itemText),
    storeId: explicitStoreId === undefined ? matched?.defaultStoreId ?? null : explicitStoreId,
    groceryItemId: matched?.id ?? null,
    reviewNeeded: !matched
  };
}
