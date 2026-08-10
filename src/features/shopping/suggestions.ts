import { prisma } from "@/lib/prisma";

export const RECENT_TRIP_LIMIT = 10;
export const AUTOCOMPLETE_CANDIDATE_LIMIT = 40;
export const AUTOCOMPLETE_ALIAS_LIMIT = 8;
export const COMMON_SUGGESTION_LIMIT = 8;

export type GrocerySuggestion = {
  displayName: string;
  category: string;
  storeId: string | null;
  groceryItemId: string | null;
  score: number;
};

export type AutocompleteCandidate = GrocerySuggestion & {
  matchTerms: string[];
};

export type SuggestionListItem = {
  groceryItemId: string | null;
  displayName: string;
};

type CandidateAccumulator = AutocompleteCandidate & {
  latestTripIndex: number;
  defaultStoreId: string | null;
};

function normalizedKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function listKeys(items: SuggestionListItem[]) {
  return new Set(
    items.flatMap((item) =>
      item.groceryItemId ? [item.groceryItemId, normalizedKey(item.displayName)] : [normalizedKey(item.displayName)]
    )
  );
}

/** Builds canonical and display-name keys for items already present on the collecting list. */
async function currentListKeys(currentListId?: string) {
  if (!currentListId) return new Set<string>();
  const currentItems = await prisma.listItem.findMany({
    where: { shoppingListId: currentListId },
    select: { groceryItemId: true, displayName: true }
  });
  return listKeys(currentItems);
}

function uniqueTerms(terms: string[]) {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = normalizedKey(term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eligibleStore(storeId: string | null | undefined, enabledStoreIds?: Set<string>) {
  if (!storeId) return null;
  return enabledStoreIds && !enabledStoreIds.has(storeId) ? null : storeId;
}

/**
 * Builds the bounded, server-ranked candidate pool used by Quick Add autocomplete.
 * Passing the page's current items avoids querying the collecting list a second time.
 */
export async function getAutocompleteCandidates(
  householdId: string,
  options: {
    currentItems?: SuggestionListItem[];
    currentListId?: string;
    enabledStoreIds?: string[];
  } = {}
): Promise<AutocompleteCandidate[]> {
  const enabledStoreIds = options.enabledStoreIds ? new Set(options.enabledStoreIds) : undefined;
  const [recentTrips, catalogItems, alreadyOnList] = await Promise.all([
    prisma.shoppingTrip.findMany({
      where: { householdId, status: "completed" },
      include: {
        shoppingList: {
          include: {
            items: {
              where: { status: { in: ["purchased", "substituted"] } },
              include: {
                groceryItem: {
                  include: {
                    aliases: { orderBy: { alias: "asc" }, take: AUTOCOMPLETE_ALIAS_LIMIT }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { completedAt: "desc" },
      take: RECENT_TRIP_LIMIT
    }),
    prisma.groceryItem.findMany({
      where: { householdId },
      include: { aliases: { orderBy: { alias: "asc" }, take: AUTOCOMPLETE_ALIAS_LIMIT } },
      orderBy: [{ recurringStaple: "desc" }, { canonicalName: "asc" }],
      take: AUTOCOMPLETE_CANDIDATE_LIMIT
    }),
    options.currentItems ? Promise.resolve(listKeys(options.currentItems)) : currentListKeys(options.currentListId)
  ]);

  const candidates = new Map<string, CandidateAccumulator>();
  const candidateKeysByName = new Map<string, string>();

  recentTrips.forEach((trip, tripIndex) => {
    const weight = RECENT_TRIP_LIMIT - tripIndex;
    trip.shoppingList.items.forEach((item) => {
      const canonical = item.groceryItem;
      const displayName = canonical?.canonicalName ?? item.displayName;
      const nameKey = normalizedKey(displayName);
      const identityKey = item.groceryItemId ?? nameKey;
      const key = candidates.has(identityKey) ? identityKey : candidateKeysByName.get(nameKey) ?? identityKey;
      if (alreadyOnList.has(key) || alreadyOnList.has(normalizedKey(displayName))) return;

      const existing = candidates.get(key);
      const historicalStore = eligibleStore(item.storeId ?? trip.storeId, enabledStoreIds);
      if (existing) {
        existing.score += weight;
        if (!existing.storeId && historicalStore) existing.storeId = historicalStore;
        return;
      }

      candidates.set(key, {
        displayName,
        category: item.category,
        storeId: historicalStore,
        defaultStoreId: eligibleStore(canonical?.defaultStoreId, enabledStoreIds),
        groceryItemId: item.groceryItemId,
        score: weight,
        latestTripIndex: tripIndex,
        matchTerms: uniqueTerms([displayName, ...(canonical?.aliases.map((alias) => alias.alias) ?? [])])
      });
      candidateKeysByName.set(nameKey, key);
    });
  });

  catalogItems.forEach((item) => {
    const nameKey = normalizedKey(item.canonicalName);
    const key = candidates.has(item.id) ? item.id : candidateKeysByName.get(nameKey) ?? item.id;
    if (alreadyOnList.has(item.id) || alreadyOnList.has(nameKey)) return;
    const matchTerms = uniqueTerms([item.canonicalName, ...item.aliases.map((alias) => alias.alias)]);
    const existing = candidates.get(key);
    if (existing) {
      if (!existing.groceryItemId) {
        existing.displayName = item.canonicalName;
        existing.category = item.category;
        existing.groceryItemId = item.id;
      }
      existing.defaultStoreId ??= eligibleStore(item.defaultStoreId, enabledStoreIds);
      existing.matchTerms = uniqueTerms([...existing.matchTerms, ...matchTerms]);
      return;
    }

    candidates.set(key, {
      displayName: item.canonicalName,
      category: item.category,
      storeId: null,
      defaultStoreId: eligibleStore(item.defaultStoreId, enabledStoreIds),
      groceryItemId: item.id,
      score: item.recurringStaple ? 0 : -1,
      latestTripIndex: Number.POSITIVE_INFINITY,
      matchTerms
    });
    candidateKeysByName.set(nameKey, key);
  });

  return Array.from(candidates.values())
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.latestTripIndex - b.latestTripIndex ||
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
    )
    .map((candidate) => ({
      displayName: candidate.displayName,
      category: candidate.category,
      storeId: candidate.storeId ?? candidate.defaultStoreId,
      groceryItemId: candidate.groceryItemId,
      score: candidate.score,
      matchTerms: candidate.matchTerms
    }))
    .slice(0, AUTOCOMPLETE_CANDIDATE_LIMIT);
}

/** Ranks recently completed purchases, weighting newer trips more heavily and omitting existing requests. */
export async function getCommonSuggestions(householdId: string, currentListId?: string): Promise<GrocerySuggestion[]> {
  return (await getAutocompleteCandidates(householdId, { currentListId })).slice(0, COMMON_SUGGESTION_LIMIT);
}

/** Returns learned catalog items, prioritizing recurring staples and omitting existing requests. */
export async function getCatalogSuggestions(householdId: string, currentListId?: string): Promise<GrocerySuggestion[]> {
  const [items, alreadyOnList] = await Promise.all([
    prisma.groceryItem.findMany({
      where: { householdId },
      orderBy: [{ recurringStaple: "desc" }, { canonicalName: "asc" }],
      take: 16
    }),
    currentListKeys(currentListId)
  ]);

  return items
    .filter((item) => !alreadyOnList.has(item.id) && !alreadyOnList.has(normalizedKey(item.canonicalName)))
    .map((item) => ({
      displayName: item.canonicalName,
      category: item.category,
      storeId: item.defaultStoreId,
      groceryItemId: item.id,
      score: item.recurringStaple ? 10 : 1
    }))
    .slice(0, COMMON_SUGGESTION_LIMIT);
}
