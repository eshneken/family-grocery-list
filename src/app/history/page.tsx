import { GrocerySection } from "@/components/grocery-section";
import { requireCapability } from "@/features/auth/authorization";
import { redirectForAuthError } from "@/features/auth/navigation";
import { getHistory, groupItemsByCategory } from "@/features/shopping/shopping.service";

export default async function HistoryPage() {
  let requester;
  try {
    requester = await requireCapability("request");
  } catch (error) {
    redirectForAuthError(error);
  }

  const trips = await getHistory(requester.householdId);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">History</p>
          <h2>Completed shopping runs</h2>
          <p>Purchased, substituted, rejected, and moved items stay visible after each run.</p>
        </div>
      </div>

      {trips.length === 0 ? (
        <section className="empty-state">
          <h2>No completed trips yet</h2>
          <p>Complete a shopping run to build history and household suggestions.</p>
        </section>
      ) : (
        trips.map((trip) => {
          const grouped = groupItemsByCategory(trip.shoppingList.items);
          const carried = trip.shoppingList.items.filter((item) => item.status === "carried_forward").length;
          return (
            <details key={trip.id} className="panel history-details">
              <summary>
                <span>
                  <strong>{trip.store?.name ?? "Store"}</strong>
                  <small>{trip.completedAt?.toLocaleDateString() ?? "Completed"} · {trip.activeShopper.user?.firstName ?? trip.activeShopper.approvedEmail}</small>
                </span>
                <span className="status-badge status-carried_forward">{carried} moved</span>
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
