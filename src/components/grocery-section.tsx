import type { ListItemStatus } from "@prisma/client";
import { ItemRow } from "./item-row";

type GrocerySectionProps = {
  title: string;
  items: Array<{
    id: string;
    displayName: string;
    quantityText?: string | null;
    category: string;
    status: ListItemStatus;
    notes?: string | null;
    substituteText?: string | null;
    store?: { name: string } | null;
    groceryItem?: { recurringStaple: boolean } | null;
    requestedBy?: { user?: { firstName: string; imageUrl: string | null } | null; approvedEmail: string };
  }>;
  shopperActions?: boolean;
};

export function GrocerySection({ title, items, shopperActions }: GrocerySectionProps) {
  if (items.length === 0) return null;
  return (
    <section className="grocery-section" aria-labelledby={`section-${title}`}>
      <h2 id={`section-${title}`}>{title}</h2>
      <div className="item-list">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            id={item.id}
            displayName={item.displayName}
            quantityText={item.quantityText}
            category={item.category}
            status={item.status}
            notes={item.notes}
            substituteText={item.substituteText}
            storeName={item.store?.name}
            recurringStaple={item.groceryItem?.recurringStaple ?? false}
            requesterName={item.requestedBy?.user?.firstName ?? item.requestedBy?.approvedEmail}
            requesterImage={item.requestedBy?.user?.imageUrl}
            shopperActions={shopperActions}
          />
        ))}
      </div>
    </section>
  );
}
