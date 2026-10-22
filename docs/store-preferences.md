# Store preferences for grocery requests

Purchase history helps rank suggestions; it does not determine where future requests must be purchased. An Any Store request bought at Costco remains an Any Store suggestion unless the household has explicitly saved a catalog preference.

## Save or clear a preference

1. Add an item and open its pencil **Edit request** dialog.
2. Choose the destination for this request in **Store**, including Any Store for an unrestricted default.
3. After choosing the destination, check **Remember this store for future requests** to also save it for future autocomplete and Common Suggestions.
4. Uncheck a checked preference to clear it. If this request uses a different store from the saved preference, the dialog shows the saved future store and a **Clear saved preference** button instead. Future suggestions then use Any Store; the current request keeps the destination chosen in step 2.
5. Save changes. Cancel discards unsaved checkbox and store changes.

The checkbox starts checked when the request destination matches its saved store. Changing a store in Quick Add or the editor affects that request only unless you explicitly change the preference control. Unrelated edits preserve the saved default, even for Any Store or other-store overrides. A manual Quick Add choice, including Any Store, wins over an autocomplete suggestion until submission; successful submission resets both the item and store choice. Switching suggestions updates the store automatically only if no manual choice was made. Unavailable/disabled saved stores fall back to Any Store without erasing the saved preference.

## Compatibility and performance

The feature reuses `GroceryItem.defaultStoreId` and `anyStore`; no schema migration or history rewrite is needed. Existing catalog bindings remain intact until explicitly changed, and existing list rows are not reassigned. Historical item/trip store IDs no longer supply a future store. Older editor submissions without the new preference marker preserve existing catalog defaults; new catalog records default to Any Store unless explicitly remembered. Request/category edits, aliases and recurring-item handling remain transactional with the household lock.

The pool remains bounded to 40 candidates using 10 recent completed trips and the catalog; matching stays case-insensitive in browser memory, without per-keystroke requests. Saved store enabled-state is loaded alongside the catalog, not searched through additional shopping history.

## Verification

Database tests cover generic purchase history, explicit remember/clear behavior, request-only overrides, new and previously unlinked catalog records, older callers, Any Store defaults, disabled stores and Common Suggestions. Component tests cover manual selection precedence (including Any Store), switching suggestions, saved checkbox state, submission, cancel/reopen and failed saves. Desktop Chrome and Mobile Safari E2E tests exercise generic purchases and the remember/clear editor flow. Production testing can repeat the oranges example and separately save a store-specific item with the checkbox.
