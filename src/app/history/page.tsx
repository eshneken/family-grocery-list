import { GrocerySection } from "@/components/grocery-section";
import { requireCapability } from "@/features/auth/authorization";
import { redirectForAuthError } from "@/features/auth/navigation";
import { getHistory, getHistoryDashboard, groupItemsByCategory } from "@/features/shopping/shopping.service";

/** Displays completed shopping runs and their resolved or carried-forward item outcomes. */
export default async function HistoryPage() {
  let requester;
  try {
    requester = await requireCapability("request");
  } catch (error) {
    redirectForAuthError(error);
  }

  const [trips, dashboard] = await Promise.all([
    getHistory(requester.householdId),
    getHistoryDashboard(requester.householdId)
  ]);

  return (
    <main className="page">
      <header className="page-title">
        <h1 className="eyebrow">Shopping History</h1>
      </header>

      <section className="history-dashboard" aria-label="Shopping history dashboard">
        <div className="history-store-metrics">
          <p>Completed Runs - Past 30 Days</p>
          {dashboard.topStores.length > 0 ? (
            <div className="history-store-tiles">
              {dashboard.topStores.map((store) => (
                <div key={store.name} className="history-metric">
                  <strong>{store.count}</strong>
                  <span>{store.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="history-empty-metric">No store visits yet</span>
          )}
        </div>
      </section>

      {trips.length === 0 ? (
        <section className="empty-state">
          <h2>No completed trips yet</h2>
          <p>Complete a shopping run to build history and household suggestions.</p>
        </section>
      ) : (
        trips.map((trip) => {
          const grouped = groupItemsByCategory(trip.shoppingList.items);
          // The collapsed summary emphasizes completed shopping progress; moved items remain in the expanded audit trail.
          const purchased = trip.shoppingList.items.filter((item) => item.status === "purchased").length;
          return (
            <details key={trip.id} className="panel history-details">
              <summary aria-label={`Show details for ${trip.store?.name ?? "store"} shopping run`}>
                <span>
                  <strong>{trip.store?.name ?? "Store"}</strong>
                  <small>{trip.completedAt?.toLocaleDateString() ?? "Completed"} · {trip.activeShopper.user?.firstName ?? trip.activeShopper.approvedEmail}</small>
                  {trip.completionReason === "timeout" ? <small>Automatically completed after 4 hours</small> : null}
                </span>
                <span className="history-summary-actions">
                  <span className="status-badge status-purchased">{purchased} purchased</span>
                  <span className="disclosure-indicator" aria-hidden="true">
                    <span className="disclosure-closed">+</span>
                    <span className="disclosure-open">−</span>
                  </span>
                </span>
              </summary>
              {Object.entries(grouped).map(([category, items]) => (
                <GrocerySection key={category} title={category} items={items} />
              ))}
            </details>
          );
        })
      )}
    </main>
  );
}
