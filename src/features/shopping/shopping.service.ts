import type { ListItemStatus, Prisma, Store } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeRequest } from "@/features/parser/parser";

const listItemInclude = {
  store: true,
  requestedBy: { include: { user: true } },
  groceryItem: true
} satisfies Prisma.ListItemInclude;

export type ListItemWithRelations = Prisma.ListItemGetPayload<{ include: typeof listItemInclude }>;

/** Returns the open list for a household, creating the first one when needed. */
export async function getCurrentCollectingList(householdId: string) {
  const list = await prisma.shoppingList.findFirst({
    where: { householdId, status: "collecting" },
    include: { items: { include: listItemInclude, orderBy: { createdAt: "asc" } } }
  });

  if (!list) {
    return prisma.shoppingList.create({
      data: { householdId, status: "collecting" },
      include: { items: { include: listItemInclude } }
    });
  }

  return list;
}

/**
 * Adds a normalized request to the current list unless an equivalent pending item already exists.
 * Store-specific duplicates are allowed because they represent different shopping destinations.
 */
export async function addRequest(input: {
  householdId: string;
  requestedById: string;
  rawText: string;
  storeId?: string | null;
  notes?: string;
}) {
  const [collectingList, catalog] = await Promise.all([
    getCurrentCollectingList(input.householdId),
    prisma.groceryItem.findMany({
      where: { householdId: input.householdId },
      include: { aliases: true, defaultStore: true }
    })
  ]);

  const parsed = normalizeRequest(input.rawText, catalog, input.storeId);
  const duplicate = collectingList.items.find((item) => {
    const sameName = item.displayName.toLowerCase() === parsed.displayName.toLowerCase();
    const sameStore = (item.storeId ?? null) === (parsed.storeId ?? null);
    return sameName && sameStore && item.status === "pending";
  });

  if (duplicate) {
    return duplicate;
  }

  return prisma.listItem.create({
    data: {
      shoppingListId: collectingList.id,
      groceryItemId: parsed.groceryItemId,
      rawText: parsed.rawText,
      displayName: parsed.displayName,
      quantityText: parsed.quantityText,
      category: parsed.category,
      storeId: parsed.storeId,
      requestedById: input.requestedById,
      notes: input.notes
    },
    include: listItemInclude
  });
}

/** Legacy category-only editor adapter that preserves the item's current name and store. */
export async function moveListItemCategory(input: {
  householdId: string;
  listItemId: string;
  category: string;
  recurringStaple: boolean;
}) {
  const item = await prisma.listItem.findFirstOrThrow({
    where: { id: input.listItemId, shoppingList: { householdId: input.householdId } },
    select: { displayName: true, storeId: true }
  });
  return updateListItem({ ...input, displayName: item.displayName, storeId: item.storeId });
}

/**
 * Edits an unshopped request and updates the associated learned catalog record.
 * The transaction protects the collecting list from duplicate pending names at the same store.
 */
export async function updateListItem(input: {
  householdId: string;
  listItemId: string;
  displayName: string;
  category: string;
  storeId?: string | null;
  recurringStaple: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.listItem.findFirstOrThrow({
      where: {
        id: input.listItemId,
        status: "pending",
        shoppingList: { householdId: input.householdId, status: "collecting" }
      }
    });

    // Normalize before the duplicate lookup so visually identical item names cannot diverge.
    const displayName = input.displayName.trim().replace(/\s+/g, " ");
    const storeId = input.storeId === undefined ? item.storeId : input.storeId;
    if (storeId) {
      const store = await tx.store.findFirst({ where: { id: storeId, householdId: input.householdId } });
      if (!store) throw new Error("Choose a store in your household.");
    }
    const duplicate = await tx.listItem.findFirst({
      where: {
        shoppingListId: item.shoppingListId,
        id: { not: item.id },
        status: "pending",
        storeId,
        displayName: { equals: displayName, mode: "insensitive" }
      },
      select: { id: true }
    });
    if (duplicate) throw new Error("That item is already on this list for the same store.");

    const groceryItem = item.groceryItemId
      ? await tx.groceryItem.update({
          where: { id: item.groceryItemId },
          data: {
            category: input.category,
            recurringStaple: input.recurringStaple
          }
        })
      : await tx.groceryItem.upsert({
          where: {
            householdId_canonicalName: {
              householdId: input.householdId,
              canonicalName: displayName
            }
          },
          update: {
            category: input.category,
            defaultStoreId: storeId,
            anyStore: storeId === null,
            recurringStaple: input.recurringStaple
          },
          create: {
            householdId: input.householdId,
            canonicalName: displayName,
            category: input.category,
            defaultStoreId: storeId,
            anyStore: storeId === null,
            recurringStaple: input.recurringStaple
          }
        });

    // Preserve the original request wording as an alias when a requestor corrects its display name.
    await tx.groceryAlias.upsert({
      where: {
        groceryItemId_alias: {
          groceryItemId: groceryItem.id,
          alias: item.rawText.toLowerCase()
        }
      },
      update: {},
      create: {
        groceryItemId: groceryItem.id,
        alias: item.rawText.toLowerCase()
      }
    });

    return tx.listItem.update({
      where: { id: item.id },
      data: {
        displayName,
        category: input.category,
        storeId,
        groceryItemId: groceryItem.id
      },
      include: listItemInclude
    });
  });
}

/** Seeds a new collecting list with recurring catalog staples that are not already represented. */
export async function seedRecurringStaples(tx: Prisma.TransactionClient, householdId: string, shoppingListId: string) {
  const staples = await tx.groceryItem.findMany({
    where: { householdId, recurringStaple: true }
  });

  const existing = await tx.listItem.findMany({
    where: { shoppingListId }
  });
  const existingKeys = new Set(
    existing.map((item) => item.groceryItemId ?? item.displayName.toLowerCase())
  );
  const requester = await tx.membership.findFirstOrThrow({
    where: { householdId, status: "active", capabilities: { has: "request" } },
    orderBy: { createdAt: "asc" }
  });

  await Promise.all(
    staples
      .filter((staple) => !existingKeys.has(staple.id) && !existingKeys.has(staple.canonicalName.toLowerCase()))
      .map((staple) =>
        tx.listItem.create({
          data: {
            shoppingListId,
            groceryItemId: staple.id,
            rawText: staple.canonicalName,
            displayName: staple.canonicalName,
            category: staple.category,
            storeId: staple.defaultStoreId,
            requestedById: requester.id,
            notes: "Recurring staple"
          }
        })
      )
  );
}

/** Loads the active trip with all relations needed by both the shopper UI and action guards. */
export async function getActiveTrip(householdId: string) {
  return prisma.shoppingTrip.findFirst({
    where: { householdId, status: "active" },
    include: {
      store: true,
      activeShopper: { include: { user: true } },
      shoppingList: { include: { items: { include: listItemInclude, orderBy: { createdAt: "asc" } } } }
    }
  });
}

/**
 * Locks the current list for one shopper, starts its trip, and opens the next collecting list.
 * The transaction prevents two household members from starting competing shopping runs.
 */
export async function startShoppingTrip(input: {
  householdId: string;
  shopperId: string;
  storeId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const activeTrip = await tx.shoppingTrip.findFirst({
      where: { householdId: input.householdId, status: "active" },
      include: { activeShopper: { include: { user: true } }, store: true }
    });

    if (activeTrip) {
      const shopper = activeTrip.activeShopper.user?.firstName ?? activeTrip.activeShopper.approvedEmail;
      const store = activeTrip.store?.name ?? "Any Store";
      throw new Error(`${shopper} is already shopping at ${store} now`);
    }

    const collectingList = await tx.shoppingList.findFirstOrThrow({
      where: { householdId: input.householdId, status: "collecting" },
      orderBy: { createdAt: "asc" }
    });

    await tx.shoppingList.update({
      where: { id: collectingList.id },
      data: { status: "locked", lockedAt: new Date() }
    });

    const trip = await tx.shoppingTrip.create({
      data: {
        householdId: input.householdId,
        shoppingListId: collectingList.id,
        activeShopperId: input.shopperId,
        storeId: input.storeId ?? null,
        status: "active"
      }
    });

    const nextList = await tx.shoppingList.create({
      data: { householdId: input.householdId, status: "collecting" }
    });
    await seedRecurringStaples(tx, input.householdId, nextList.id);

    return trip;
  });
}

/** Returns active-trip items visible at the selected store, including generic Any Store requests. */
export async function getShopperView(householdId: string, storeId?: string | null) {
  const trip = await getActiveTrip(householdId);
  if (!trip) return null;

  const selectedStoreId = storeId === undefined ? trip.storeId : storeId;
  const items = trip.shoppingList.items.filter((item) => !item.storeId || item.storeId === selectedStoreId);

  return { trip, selectedStoreId, items };
}

/** Records a shopper outcome and updates its list row after verifying the acting shopper owns the trip. */
export async function markItemOutcome(input: {
  householdId: string;
  itemId: string;
  actorId: string;
  outcome: Extract<ListItemStatus, "purchased" | "substituted" | "rejected">;
  note?: string;
  substituteText?: string;
}) {
  const trip = await getActiveTrip(input.householdId);
  if (!trip || trip.activeShopperId !== input.actorId) {
    throw new Error("Only the active shopper can update this trip.");
  }

  const item = trip.shoppingList.items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    throw new Error("This item is not part of the active shopping trip.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.itemOutcome.create({
      data: {
        listItemId: input.itemId,
        outcome: input.outcome,
        actorId: input.actorId,
        note: input.note
      }
    });

    return tx.listItem.update({
      where: { id: input.itemId },
      data: {
        status: input.outcome,
        notes: input.note,
        substituteText: input.substituteText,
        outcomeAt: new Date()
      },
      include: listItemInclude
    });
  });
}

/**
 * Completes the active trip and carries unresolved unique requests into the already-open next list.
 * Carried-forward outcomes preserve the audit trail rather than silently copying pending items.
 */
export async function completeShoppingTrip(householdId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.shoppingTrip.findFirstOrThrow({
      where: { householdId, status: "active" },
      include: {
        shoppingList: { include: { items: true } }
      }
    });

    if (trip.activeShopperId !== actorId) {
      throw new Error("Only the active shopper can complete this trip.");
    }

    const nextList = await tx.shoppingList.findFirstOrThrow({
      where: { householdId, status: "collecting" },
      orderBy: { createdAt: "desc" }
    });
    const pendingItems = trip.shoppingList.items.filter((item) => item.status === "pending");
    const nextListExisting = await tx.listItem.findMany({
      where: { shoppingListId: nextList.id },
      select: { groceryItemId: true, displayName: true, storeId: true }
    });
    // The grocery-item-or-name plus store key prevents duplicate carry-forwards across list rotations.
    const nextListKeys = new Set(
      nextListExisting.map((item) => `${item.groceryItemId ?? item.displayName.toLowerCase()}::${item.storeId ?? "any"}`)
    );

    await Promise.all(
      pendingItems.map(async (item) => {
        const key = `${item.groceryItemId ?? item.displayName.toLowerCase()}::${item.storeId ?? "any"}`;
        await tx.itemOutcome.create({
          data: {
            listItemId: item.id,
            outcome: "carried_forward",
            actorId,
            note: "Moved to next list"
          }
        });
        await tx.listItem.update({
          where: { id: item.id },
          data: { status: "carried_forward", outcomeAt: new Date() }
        });
        if (nextListKeys.has(key)) return;
        nextListKeys.add(key);
        await tx.listItem.create({
          data: {
            shoppingListId: nextList.id,
            groceryItemId: item.groceryItemId,
            rawText: item.rawText,
            displayName: item.displayName,
            quantityText: item.quantityText,
            category: item.category,
            storeId: item.storeId,
            requestedById: item.requestedById,
            notes: item.notes
          }
        });
      })
    );

    await tx.shoppingTrip.update({
      where: { id: trip.id },
      data: { status: "completed", completedAt: new Date() }
    });
    await tx.shoppingList.update({
      where: { id: trip.shoppingListId },
      data: { status: "completed", completedAt: new Date() }
    });

    return {
      tripId: trip.id,
      carriedForwardCount: pendingItems.length,
      completedCount: trip.shoppingList.items.length - pendingItems.length
    };
  });
}

/** Returns the most recent completed trips with item outcomes for the history screen. */
export async function getHistory(householdId: string) {
  return prisma.shoppingTrip.findMany({
    where: { householdId, status: "completed" },
    include: {
      store: true,
      activeShopper: { include: { user: true } },
      shoppingList: { include: { items: { include: listItemInclude, orderBy: { createdAt: "asc" } } } }
    },
    orderBy: { completedAt: "desc" },
    take: 20
  });
}

/** Returns the most recently completed trip for the compact request-page visit summary. */
export async function getLastCompletedTrip(householdId: string) {
  return prisma.shoppingTrip.findFirst({
    where: { householdId, status: "completed" },
    include: { store: true, activeShopper: { include: { user: true } } },
    orderBy: { completedAt: "desc" }
  });
}

/** Formats a completed-trip timestamp by local calendar date, not elapsed 24-hour periods. */
export function formatDaysSince(completedAt: Date, now = new Date()) {
  const calendarDate = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.max(0, Math.round((calendarDate(now) - calendarDate(completedAt)) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Counts and ranks store visits so the history dashboard can show the household's recent habits. */
export function summarizeStoreVisits(trips: Array<{ store: { name: string } | null }>) {
  const visits = new Map<string, number>();
  for (const trip of trips) {
    const name = trip.store?.name ?? "Any Store";
    visits.set(name, (visits.get(name) ?? 0) + 1);
  }
  return Array.from(visits, ([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 3);
}

/**
 * Loads the top stores from a rolling 30-day window without loading every list item.
 */
export async function getHistoryDashboard(householdId: string, now = new Date()) {
  const pastMonth = new Date(now);
  pastMonth.setDate(pastMonth.getDate() - 30);
  const recentTrips = await prisma.shoppingTrip.findMany({
    where: { householdId, status: "completed", completedAt: { gte: pastMonth } },
    include: { store: true }
  });

  return { topStores: summarizeStoreVisits(recentTrips) };
}

/** Groups any category-bearing rows while preserving their source order within each category. */
export function groupItemsByCategory<T extends { category: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    groups[item.category] ??= [];
    groups[item.category].push(item);
    return groups;
  }, {});
}

/** Formats an optional store relation using the user-facing generic-store label. */
export function storeLabel(store: Store | null | undefined) {
  return store?.name ?? "Any Store";
}
