import type { ListItemStatus } from "@prisma/client";
import { Check, Replace, X } from "lucide-react";
import { markItemOutcomeAction, moveItemCategoryAction } from "@/app/actions";
import { categories } from "@/features/catalog/categories";
import { CategoryIcon } from "./category-icon";
import { StatusBadge } from "./status-badge";

type ItemRowProps = {
  id: string;
  displayName: string;
  quantityText?: string | null;
  category: string;
  storeName?: string | null;
  requesterName?: string | null;
  requesterImage?: string | null;
  status: ListItemStatus;
  notes?: string | null;
  substituteText?: string | null;
  recurringStaple?: boolean;
  shopperActions?: boolean;
};

export function ItemRow(props: ItemRowProps) {
  return (
    <article className={`item-row item-row-${props.status}`}>
      <CategoryIcon category={props.category} />
      <div className="item-main">
        <div className="item-title-line">
          <strong>{props.displayName}</strong>
          {props.quantityText ? <span className="quantity">{props.quantityText}</span> : null}
        </div>
        <div className="item-meta">
          <span>{props.storeName ?? "Any Store"}</span>
          {props.requesterImage ? <img src={props.requesterImage} alt="" className="avatar" /> : <span className="avatar avatar-fallback">{props.requesterName ?? "Family"}</span>}
          <span>{props.requesterName ?? "Family"}</span>
        </div>
        {!props.shopperActions && props.status === "pending" ? (
          <form action={moveItemCategoryAction} className="inline-category-form">
            <input type="hidden" name="itemId" value={props.id} />
            <label>
              Category
              <select name="category" defaultValue={props.category} aria-label={`Move ${props.displayName} to category`}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input name="recurringStaple" type="checkbox" defaultChecked={props.recurringStaple} />
              Recurring
            </label>
            <button className="secondary-button">Save</button>
          </form>
        ) : null}
        {props.substituteText ? <p className="substitution">{props.displayName} substituted with {props.substituteText}</p> : null}
        {props.notes ? <p className="note">{props.notes}</p> : null}
      </div>
      <div className="item-actions">
        <StatusBadge status={props.status} />
        {props.shopperActions && props.status === "pending" ? (
          <>
            <form action={markItemOutcomeAction}>
              <input type="hidden" name="itemId" value={props.id} />
              <input type="hidden" name="outcome" value="purchased" />
              <button className="icon-action success" aria-label={`Mark ${props.displayName} purchased`}>
                <Check size={18} />
              </button>
            </form>
            <details className="substitute-details">
              <summary aria-label={`Substitute ${props.displayName}`}>
                <Replace size={18} />
              </summary>
              <form action={markItemOutcomeAction} className="substitute-form">
                <input type="hidden" name="itemId" value={props.id} />
                <input type="hidden" name="outcome" value="substituted" />
                <label>
                  Purchased instead
                  <input name="substituteText" required />
                </label>
                <label>
                  Note
                  <input name="note" placeholder="Requested item was out" />
                </label>
                <button>Save</button>
              </form>
            </details>
            <form action={markItemOutcomeAction}>
              <input type="hidden" name="itemId" value={props.id} />
              <input type="hidden" name="outcome" value="rejected" />
              <input type="hidden" name="note" value="Rejected by shopper" />
              <button className="icon-action danger" aria-label={`Reject ${props.displayName}`}>
                <X size={18} />
              </button>
            </form>
          </>
        ) : null}
      </div>
    </article>
  );
}
