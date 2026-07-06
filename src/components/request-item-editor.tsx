"use client";

import { Pencil } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { updateListItemAction } from "@/app/actions";
import { categories } from "@/features/catalog/categories";

type RequestItemEditorProps = {
  id: string;
  displayName: string;
  category: string;
  storeId: string | null;
  stores: Array<{ id: string; name: string }>;
  recurringStaple: boolean;
};

/** Compact modal for correcting a pending request's name, category, store, and recurring setting. */
export function RequestItemEditor({ id, displayName, category, storeId, stores, recurringStaple }: RequestItemEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Closes the native dialog and resets errors left by an unsuccessful server action. */
  const closeDialog = () => {
    dialogRef.current?.close();
    setError(null);
  };

  return (
    <>
      <button className="icon-action" type="button" aria-label={`Edit ${displayName}`} onClick={() => dialogRef.current?.showModal()}>
        <Pencil size={18} aria-hidden="true" />
      </button>
      <dialog ref={dialogRef} className="request-editor-dialog" aria-labelledby={`edit-item-${id}`} onClick={(event) => event.currentTarget === event.target && closeDialog()}>
        <form
          className="request-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              try {
                await updateListItemAction(formData);
                closeDialog();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not update this item. Try again.");
              }
            });
          }}
        >
          <input type="hidden" name="itemId" value={id} />
          <div className="dialog-heading">
            <h2 id={`edit-item-${id}`}>Edit request</h2>
            <button className="text-button" type="button" onClick={closeDialog}>
              Cancel
            </button>
          </div>
          <label className="field">
            Item name
            <input name="displayName" defaultValue={displayName} required maxLength={120} autoFocus />
          </label>
          <label className="field">
            Category
            <select name="category" defaultValue={category}>
              {categories.map((itemCategory) => (
                <option key={itemCategory} value={itemCategory}>
                  {itemCategory}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Store
            <select name="storeId" defaultValue={storeId ?? ""}>
              <option value="">Any Store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input name="recurringStaple" type="checkbox" defaultChecked={recurringStaple} />
            Recurring item
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </dialog>
    </>
  );
}
