import { completeShoppingTripAction, startShoppingTripAction } from "@/app/actions";
import { GrocerySection } from "@/components/grocery-section";
import { requireCapability } from "@/features/auth/authorization";
import { redirectForAuthError } from "@/features/auth/navigation";
import { getCurrentCollectingList, getShopperView, groupItemsByCategory } from "@/features/shopping/shopping.service";
import { prisma } from "@/lib/prisma";

/** Renders store selection or the active shopper's compact, store-filtered shopping run. */
export default async function ShopPage() {
  let shopper;
  try {
    shopper = await requireCapability("shop");
  } catch (error) {
    redirectForAuthError(error);
  }

  const [stores, activeTrip, collectingList] = await Promise.all([
    prisma.store.findMany({ where: { householdId: shopper.householdId, enabled: true }, orderBy: { name: "asc" } }),
    getShopperView(shopper.householdId),
    getCurrentCollectingList(shopper.householdId)
  ]);

  const conflict = activeTrip?.trip.activeShopperId && activeTrip.trip.activeShopperId !== shopper.id;
  const grouped = activeTrip ? groupItemsByCategory(activeTrip.items) : {};
  // Counts stay scoped to visible store items, matching the rows the shopper can act on.
  const counts = activeTrip
    ? activeTrip.items.reduce(
        (summary, item) => {
          summary[item.status] += 1;
          return summary;
        },
        { pending: 0, purchased: 0, substituted: 0, rejected: 0, carried_forward: 0 }
      )
    : null;

  return (
    <main className="page">
      <header className="page-title">
        <h1 className="eyebrow">Shopper Mode</h1>
      </header>

      {!activeTrip ? (
        <section className="panel">
          <h2>Choose a store</h2>
          {collectingList.items.length === 0 ? <p>No items are ready to shop yet. Add requests from the List tab first.</p> : null}
          {stores.length === 0 ? <p>No stores are enabled. Add or enable a store from Admin first.</p> : null}
          <form action={startShoppingTripAction} className="store-filter start-shopping-form">
            {stores.map((store, index) => (
              <label key={store.id}>
                <input type="radio" name="storeId" value={store.id} defaultChecked={index === 0} />
                {store.name}
              </label>
            ))}
            <div className="start-shopping-action">
              <button className="primary-button" disabled={collectingList.items.length === 0 || stores.length === 0}>
                Start shopping
              </button>
            </div>
          </form>
        </section>
      ) : conflict ? (
        <section className="empty-state" aria-live="polite">
          <h2>
            {activeTrip.trip.activeShopper.user?.firstName ?? activeTrip.trip.activeShopper.approvedEmail} is already shopping at{" "}
            {activeTrip.trip.store?.name ?? "a store"} now
          </h2>
          <p>Only one active shopper can run the locked list at a time.</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>{activeTrip.trip.store?.name ?? "Store"} run</h2>
            <div className="summary-grid">
              <div className="summary-card">
                <strong>{counts?.purchased ?? 0}</strong>
                Purchased
              </div>
              <div className="summary-card">
                <strong>{counts?.substituted ?? 0}</strong>
                Substituted
              </div>
              <div className="summary-card">
                <strong>{counts?.rejected ?? 0}</strong>
                Rejected
              </div>
              <div className="summary-card">
                <strong>{counts?.pending ?? 0}</strong>
                Moved
              </div>
            </div>
            <form action={completeShoppingTripAction} className="complete-shopping-form">
              <button className="primary-button">Complete shopping run</button>
            </form>
          </section>

          {Object.keys(grouped).length === 0 ? (
            <section className="empty-state">
              <h2>No items match this store</h2>
              <p>Items tagged for other stores are hidden from this run.</p>
            </section>
          ) : (
            Object.entries(grouped).map(([category, items]) => <GrocerySection key={category} title={category} items={items} shopperActions />)
          )}
        </>
      )}
    </main>
  );
}
