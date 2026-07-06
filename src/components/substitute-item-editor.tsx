"use client";

import { Replace } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { markItemOutcomeAction } from "@/app/actions";

/** Wide mobile-friendly modal for recording what the shopper purchased instead of the request. */
export function SubstituteItemEditor({ id, displayName }: { id: string; displayName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Closes the native dialog and clears a prior submission error for the next attempt. */
  const closeDialog = () => {
    dialogRef.current?.close();
    setError(null);
  };

  return (
    <>
      <button className="menu-action substitute-action" type="button" onClick={() => dialogRef.current?.showModal()}>
        <Replace size={18} aria-hidden="true" />
        Substitute
      </button>
      <dialog ref={dialogRef} className="request-editor-dialog substitute-editor-dialog" aria-labelledby={`substitute-item-${id}`} onClick={(event) => event.currentTarget === event.target && closeDialog()}>
        <form
          className="request-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              try {
                await markItemOutcomeAction(formData);
                closeDialog();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not save this substitute. Try again.");
              }
            });
          }}
        >
          <input type="hidden" name="itemId" value={id} />
          <input type="hidden" name="outcome" value="substituted" />
          <div className="dialog-heading">
            <h2 id={`substitute-item-${id}`}>Substitute {displayName}</h2>
            <button className="text-button" type="button" onClick={closeDialog}>
              Cancel
            </button>
          </div>
          <label className="field">
            Purchased instead
            <input name="substituteText" required autoFocus />
          </label>
          <label className="field">
            Note
            <input name="note" placeholder="Requested item was out" />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={isPending}>
            {isPending ? "Saving…" : "Save substitute"}
          </button>
        </form>
      </dialog>
    </>
  );
}
