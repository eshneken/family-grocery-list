import type { ListItemStatus, Prisma, Store } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeRequest } from "@/features/parser/parser";

const listItemInclude = {
  store: true,
  requestedBy: { include: { user: true } },
  groceryItem: true
} satisfies Prisma.ListItemInclude;

export type ListItemWithRelations = Prisma.ListItemGetPayload<{ include: typeof listItemInclude }>;

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

export async function moveListItemCategory(input: {
  householdId: string;
  listItemId: string;
  category: string;
  recurringStaple: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.listItem.findFirstOrThrow({
      where: {
        id: input.listItemId,
        shoppingList: { householdId: input.householdId }
      }
    });

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
              canonicalName: item.displayName
            }
          },
          update: {
            category: input.category,
            defaultStoreId: item.storeId,
            recurringStaple: input.recurringStaple
          },
          create: {
            householdId: input.householdId,
            canonicalName: item.displayName,
            category: input.category,
            defaultStoreId: item.storeId,
            anyStore: item.storeId === null,
            recurringStaple: input.recurringStaple
          }
        });

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
        category: input.category,
        groceryItemId: groceryItem.id
      },
      include: listItemInclude
    });
  });
}

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

export async function getShopperView(householdId: string, storeId?: string | null) {
  const trip = await getActiveTrip(householdId);
  if (!trip) return null;

  const selectedStoreId = storeId === undefined ? trip.storeId : storeId;
  const items = trip.shoppingList.items.filter((item) => !item.storeId || item.storeId === selectedStoreId);

  return { trip, selectedStoreId, items };
}

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

export function groupItemsByCategory<T extends { category: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    groups[item.category] ??= [];
    groups[item.category].push(item);
    return groups;
  }, {});
}

export function storeLabel(store: Store | null | undefined) {
  return store?.name ?? "Any Store";
}
