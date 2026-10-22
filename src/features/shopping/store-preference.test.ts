import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { addCatalogItem, cleanupTestHousehold, createTestHousehold } from "@/test/factories/db";
import { addRequest, completeShoppingTrip, markItemOutcome, startShoppingTrip, updateListItem } from "./shopping.service";
import { getAutocompleteCandidates, getCatalogSuggestions, getCommonSuggestions } from "./suggestions";

describe("explicit future store preferences", () => {
  it("keeps generic purchases generic, remembers only on opt-in, and clears without changing today's request", async () => {
    const f = await createTestHousehold("store-preference");
    try {
      const store = f.stores[0];
      const item = await addRequest({ householdId: f.household.id, requestedById: f.admin.id, rawText: "Oranges", storeId: null });
      const edit = { householdId: f.household.id, listItemId: item.id, displayName: "Oranges", category: "Produce", recurringStaple: false };
      const updated = await updateListItem({ ...edit, storeId: store.id, rememberStore: false });
      expect(updated.groceryItem).toMatchObject({ defaultStoreId: null, anyStore: true });
      expect(updated.storeId).toBe(store.id);

      await updateListItem({ ...edit, storeId: store.id, rememberStore: true });
      expect((await getAutocompleteCandidates(f.household.id, { currentItems: [] }))[0].storeId).toBe(store.id);
      expect((await getCommonSuggestions(f.household.id))[0].storeId).toBe(store.id);

      // Older callers and a one-off Quick Add store selection preserve saved preferences.
      await updateListItem({ ...edit, storeId: f.stores[1].id });
      expect((await getCatalogSuggestions(f.household.id))[0].storeId).toBe(store.id);
      const override = await addRequest({ householdId: f.household.id, requestedById: f.admin.id, rawText: "Oranges", storeId: null });
      expect(override.storeId).toBeNull();
      expect((await getAutocompleteCandidates(f.household.id, { currentItems: [] }))[0].storeId).toBe(store.id);

      await updateListItem({ ...edit, storeId: f.stores[1].id, rememberStore: false });
      const catalog = await prisma.groceryItem.findUniqueOrThrow({ where: { id: updated.groceryItemId! } });
      expect(catalog).toMatchObject({ defaultStoreId: null, anyStore: true });
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: item.id } })).storeId).toBe(f.stores[1].id);

      const trip = await startShoppingTrip({ householdId: f.household.id, shopperId: f.admin.id, storeId: store.id });
      await markItemOutcome({ householdId: f.household.id, actorId: f.admin.id, itemId: override.id, outcome: "purchased" });
      await completeShoppingTrip(f.household.id, f.admin.id, trip.id);
      expect((await getAutocompleteCandidates(f.household.id, { currentItems: [] }))[0]).toMatchObject({ displayName: "Oranges", storeId: null });
      expect((await getCommonSuggestions(f.household.id))[0].storeId).toBeNull();
    } finally { await cleanupTestHousehold(f); }
  });

  it.each([undefined, false, true])("handles a new catalog record with rememberStore=%s", async (rememberStore) => {
    const f = await createTestHousehold("new-store-preference");
    try {
      const item = await addRequest({ householdId: f.household.id, requestedById: f.admin.id, rawText: "Special crackers", storeId: f.stores[0].id });
      const result = await updateListItem({ householdId: f.household.id, listItemId: item.id, displayName: item.displayName, category: "Pantry", recurringStaple: false, rememberStore });
      expect(result.groceryItem).toMatchObject({ defaultStoreId: rememberStore ? f.stores[0].id : null, anyStore: !rememberStore });
    } finally { await cleanupTestHousehold(f); }
  });

  it("preserves an existing catalog binding when a previously unlinked request is edited by an older caller", async () => {
    const f = await createTestHousehold("unlinked-store-preference");
    try {
      const item = await addRequest({ householdId: f.household.id, requestedById: f.admin.id, rawText: "Special tea" });
      await addCatalogItem({ householdId: f.household.id, canonicalName: "Special tea", category: "Pantry", storeId: f.stores[0].id });
      const edit = { householdId: f.household.id, listItemId: item.id, displayName: "Special tea", category: "Pantry", recurringStaple: false, storeId: f.stores[1].id };
      const updated = await updateListItem(edit);
      expect(updated.groceryItem).toMatchObject({ defaultStoreId: f.stores[0].id, anyStore: false });
      await updateListItem({ ...edit, storeId: null, rememberStore: true });
      expect((await getCatalogSuggestions(f.household.id))[0].storeId).toBeNull();
    } finally { await cleanupTestHousehold(f); }
  });

  it("honors Any Store and disabled stores even if a legacy default-store ID exists", async () => {
    const f = await createTestHousehold("disabled-store-preference");
    try {
      const item = await addCatalogItem({ householdId: f.household.id, canonicalName: "Oranges", category: "Produce", storeId: f.stores[0].id });
      await prisma.groceryItem.update({ where: { id: item.id }, data: { anyStore: true } });
      expect((await getAutocompleteCandidates(f.household.id))[0].storeId).toBeNull();
      await prisma.groceryItem.update({ where: { id: item.id }, data: { anyStore: false } });
      expect((await getAutocompleteCandidates(f.household.id, { enabledStoreIds: [] }))[0].storeId).toBeNull();
      await prisma.store.update({ where: { id: f.stores[0].id }, data: { enabled: false } });
      expect((await getAutocompleteCandidates(f.household.id))[0].storeId).toBeNull();
      expect((await getCommonSuggestions(f.household.id))[0].storeId).toBeNull();
      expect((await getCatalogSuggestions(f.household.id))[0].storeId).toBeNull();
    } finally { await cleanupTestHousehold(f); }
  });
});
