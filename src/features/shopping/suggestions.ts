import { prisma } from "@/lib/prisma";

export type GrocerySuggestion = {
  displayName: string;
  category: string;
  storeId: string | null;
  groceryItemId: string | null;
  score: number;
};

async function currentListKeys(currentListId?: string) {
  if (!currentListId) return new Set<string>();
  const currentItems = await prisma.listItem.findMany({
    where: { shoppingListId: currentListId },
    select: { groceryItemId: true, displayName: true }
  });
  return new Set(
    currentItems.flatMap((item) =>
      item.groceryItemId ? [item.groceryItemId, item.displayName.toLowerCase()] : [item.displayName.toLowerCase()]
    )
  );
}

export async function getCommonSuggestions(householdId: string, currentListId?: string): Promise<GrocerySuggestion[]> {
  const [recentTrips, alreadyOnList] = await Promise.all([
    prisma.shoppingTrip.findMany({
      where: { householdId, status: "completed" },
      include: {
        shoppingList: {
          include: {
            items: {
              where: { status: { in: ["purchased", "substituted", "carried_forward"] } },
              include: { groceryItem: true }
            }
          }
        }
      },
      orderBy: { completedAt: "desc" },
      take: 10
    }),
    currentListKeys(currentListId)
  ]);

  const scores = new Map<string, GrocerySuggestion>();
  recentTrips.forEach((trip, tripIndex) => {
    const weight = 10 - tripIndex;
    trip.shoppingList.items.forEach((item) => {
      const key = item.groceryItemId ?? item.displayName.toLowerCase();
      if (alreadyOnList.has(key) || alreadyOnList.has(item.displayName.toLowerCase())) return;
      const current = scores.get(key) ?? {
        displayName: item.displayName,
        category: item.category,
        storeId: item.storeId ?? item.groceryItem?.defaultStoreId ?? null,
        groceryItemId: item.groceryItemId,
        score: 0
      };
      current.score += weight;
      scores.set(key, current);
    });
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

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
    .filter((item) => !alreadyOnList.has(item.id) && !alreadyOnList.has(item.canonicalName.toLowerCase()))
    .map((item) => ({
      displayName: item.canonicalName,
      category: item.category,
      storeId: item.defaultStoreId,
      groceryItemId: item.id,
      score: item.recurringStaple ? 10 : 1
    }))
    .slice(0, 8);
}
