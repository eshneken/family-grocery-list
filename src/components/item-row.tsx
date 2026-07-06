import type { ListItemStatus } from "@prisma/client";
import { Check, MoreHorizontal, X } from "lucide-react";
import { markItemOutcomeAction } from "@/app/actions";
import { CategoryIcon } from "./category-icon";
import { RequestItemEditor } from "./request-item-editor";
import { StatusBadge } from "./status-badge";
import { SubstituteItemEditor } from "./substitute-item-editor";

type ItemRowProps = {
  id: string;
  displayName: string;
  quantityText?: string | null;
  category: string;
  storeId?: string | null;
  stores?: Array<{ id: string; name: string }>;
  storeName?: string | null;
  requesterName?: string | null;
  requesterImage?: string | null;
  status: ListItemStatus;
  notes?: string | null;
  substituteText?: string | null;
  recurringStaple?: boolean;
  shopperActions?: boolean;
};

/**
 * Displays a grocery item in requestor or shopper mode.
 * Shopper mode keeps purchase direct and moves secondary actions behind the compact overflow control.
 */
export function ItemRow(props: ItemRowProps) {
  return (
    <article className={`item-row item-row-${props.status}${props.shopperActions ? " item-row-shopper" : ""}`}>
      <CategoryIcon category={props.category} />
      <div className="item-main">
        <div className="item-title-line">
          <strong>{props.displayName}</strong>
          {props.quantityText ? <span className="quantity">{props.quantityText}</span> : null}
          {props.recurringStaple ? <span className="recurring-indicator" aria-label="Recurring item">R</span> : null}
        </div>
        {!props.shopperActions ? (
          <div className="item-meta">
            <span>{props.storeName ?? "Any Store"}</span>
            {props.requesterImage ? (
              // Identity-provider avatars can use external hosts that are not known at build time.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={props.requesterImage} alt="" className="avatar" />
            ) : (
              <span className="avatar avatar-fallback" aria-hidden="true">{(props.requesterName ?? "Family").slice(0, 1)}</span>
            )}
            <span>{props.requesterName ?? "Family"}</span>
          </div>
        ) : null}
        {props.substituteText ? <p className="substitution">{props.displayName} substituted with {props.substituteText}</p> : null}
        {props.notes && props.notes !== "Recurring staple" ? <p className="note">{props.notes}</p> : null}
      </div>
      <div className="item-actions">
        <StatusBadge status={props.status} />
        {!props.shopperActions && props.status === "pending" ? (
          <RequestItemEditor
            id={props.id}
            displayName={props.displayName}
            category={props.category}
            storeId={props.storeId ?? null}
            stores={props.stores ?? []}
            recurringStaple={props.recurringStaple ?? false}
          />
        ) : null}
        {props.shopperActions && props.status === "pending" ? (
          <>
            <form action={markItemOutcomeAction}>
              <input type="hidden" name="itemId" value={props.id} />
              <input type="hidden" name="outcome" value="purchased" />
              <button className="icon-action success" aria-label={`Mark ${props.displayName} purchased`}>
                <Check size={18} />
              </button>
            </form>
            <details className="shop-actions-menu">
              <summary aria-label={`More actions for ${props.displayName}`}>
                <MoreHorizontal size={18} />
              </summary>
              <div className="shop-actions-popover">
                <SubstituteItemEditor id={props.id} displayName={props.displayName} />
                <form action={markItemOutcomeAction}>
                  <input type="hidden" name="itemId" value={props.id} />
                  <input type="hidden" name="outcome" value="rejected" />
                  <input type="hidden" name="note" value="Rejected by shopper" />
                  <button className="menu-action danger" aria-label={`Reject ${props.displayName}`}>
                    <X size={18} />
                    Can’t find
                  </button>
                </form>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </article>
  );
}
