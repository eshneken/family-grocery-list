import { redirect } from "next/navigation";
import { addRequestAction } from "@/app/actions";
import { GrocerySection } from "@/components/grocery-section";
import { requireCapability } from "@/features/auth/authorization";
import { getCurrentCollectingList, groupItemsByCategory } from "@/features/shopping/shopping.service";
import { getCatalogSuggestions, getCommonSuggestions } from "@/features/shopping/suggestions";
import { prisma } from "@/lib/prisma";

export default async function ListPage() {
  let requester;
  try {
    requester = await requireCapability("request");
  } catch {
    redirect("/unauthorized");
  }

  const [list, stores, activeTrip] = await Promise.all([
    getCurrentCollectingList(requester.householdId),
    prisma.store.findMany({ where: { householdId: requester.householdId, enabled: true }, orderBy: { name: "asc" } }),
    prisma.shoppingTrip.findFirst({ where: { householdId: requester.householdId, status: "active" } })
  ]);
  const commonSuggestions = await getCommonSuggestions(requester.householdId, list.id);
  const catalogSuggestions = commonSuggestions.length > 0 ? commonSuggestions : await getCatalogSuggestions(requester.householdId, list.id);
  const grouped = groupItemsByCategory(list.items);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Requestor list</p>
          <h2>What should go on the next list?</h2>
          <p>{activeTrip ? "A shopping run is active, so new requests land on the next list." : "Add items for the household to request."}</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="quick-add-heading">
        <h2 id="quick-add-heading">Quick add</h2>
        <form action={addRequestAction} className="quick-add">
          <label className="field">
            Item
            <input name="rawText" required />
          </label>
          <label className="field">
            Store
            <select name="storeId" defaultValue="">
              <option value="">Any Store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button">Add item</button>
        </form>
      </section>

      {Object.keys(grouped).length === 0 ? (
        <section className="empty-state">
          <h2>Nothing on the next list yet</h2>
          <p>Add milk, bananas, snacks, or a store-specific favorite.</p>
        </section>
      ) : (
        Object.entries(grouped).map(([category, items]) => <GrocerySection key={category} title={category} items={items} />)
      )}

      <section className="panel">
        <h2>Common suggestions</h2>
        {catalogSuggestions.length === 0 ? (
          <p>Suggestions will appear after completed shopping runs. They use the last 10 runs, weighted toward recent trips.</p>
        ) : (
          <div className="store-filter">
            {catalogSuggestions.map((suggestion) => (
              <form key={`${suggestion.groceryItemId ?? suggestion.displayName}-${suggestion.storeId ?? "any"}`} action={addRequestAction}>
                <input type="hidden" name="rawText" value={suggestion.displayName} />
                <input type="hidden" name="storeId" value={suggestion.storeId ?? ""} />
                <button className="suggestion-button">
                  {suggestion.displayName}
                  <span>{stores.find((store) => store.id === suggestion.storeId)?.name ?? "Any Store"}</span>
                </button>
              </form>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
