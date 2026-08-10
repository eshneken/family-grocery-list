# Quick Add Autocomplete Design Plan

## Goal

Add fast, mobile-friendly autocomplete to the Current List Quick Add field using prior successful shopping behavior and the household catalog. The feature must preserve free-form entry, work without per-keystroke network requests, and keep unit and E2E coverage above 95%.

## Product decisions

- Build a bounded candidate set on the server when the Current List page renders, then filter it locally while the user types.
- Match case-insensitively at the beginning of any word. Preserve the stored capitalization in displayed and submitted results.
- Rank by recency-weighted frequency.
- Load at most 40 candidates and display at most 6 matches.
- Selecting a result fills its canonical item name and most recently used enabled store, but does not submit the form.
- Use only `purchased` and `substituted` outcomes as historical evidence. Moved, cancelled, removed, and pending items do not affect ranking.
- Open autocomplete after one typed character. Keep Common Suggestions as the empty-input discovery experience.
- Search canonical names and saved aliases. Display and submit the canonical name, and collapse exact case-insensitive duplicates.

## Existing behavior to preserve

- `addRequestAction` remains the only mutation path and continues to authorize the request, reject blank input, parse the item, and refresh app data.
- Users can type and submit any free-form value even when there is no suggestion.
- An explicitly selected store continues to override a catalog default.
- Items already on the collecting list remain excluded from suggestions.
- The Common Suggestions buttons continue to add items directly.
- The plain HTML form remains usable if client-side JavaScript fails or has not hydrated.

## Architecture

No aggregate table, migration, fuzzy-search extension, or autocomplete API is needed for the first version. The current data model already has a household catalog (`GroceryItem` and `GroceryAlias`) and an index on `ShoppingTrip(householdId, status)`. The history query is bounded before its list items are loaded.

```text
Current List server render
        |
        +-- current collecting-list keys
        |
        +-- 10 newest completed trips
        |      `-- purchased/substituted items only
        |
        +-- up to 40 catalog items + aliases
        |
        `-- merge, deduplicate, score, cap at 40
                         |
                         v
             QuickAddCombobox client component
                         |
          normalized local word-prefix matching
                         |
                  show at most 6
                         |
             select name + eligible store
                         |
                  user taps Add item
                         |
                  existing server action
```

### Server candidate builder

Refactor `src/features/shopping/suggestions.ts` around one reusable candidate builder while retaining the existing Common Suggestions behavior.

Candidate data transferred to the browser:

```ts
type AutocompleteCandidate = {
  groceryItemId: string | null;
  displayName: string;
  matchTerms: string[];
  storeId: string | null;
  score: number;
};
```

Data rules:

1. Fetch the 10 newest completed household trips and include only list items with `purchased` or `substituted` status.
2. Fetch a maximum of 40 household catalog items with aliases, prioritizing recurring staples and then canonical name.
3. Fetch current-list identities once and exclude candidates by `groceryItemId` or normalized display name.
4. Deduplicate catalog-backed entries by `groceryItemId`; deduplicate free-form entries by normalized display name.
5. For a catalog-backed result, use its canonical name as `displayName` and include the canonical name plus all aliases in `matchTerms`.
6. For a free-form historical result, use its preserved display name as both `displayName` and its sole match term.
7. Since trips are processed newest first, retain the store from the newest qualifying occurrence. A catalog default is the fallback when there is no qualifying historical store.
8. Pass the enabled store IDs into candidate construction, or validate them before updating the form. A deleted or disabled historical store must not replace the user's current selection.

### Ranking

- A qualifying occurrence in recent trip position 0 through 9 contributes `10 - tripIndex` points.
- A recurring catalog item with no historical score receives a small deterministic baseline above an ordinary catalog item; this only orders catalog fallbacks after behaviorally ranked items.
- Sort by score descending, then latest qualifying occurrence descending, then canonical/display name with a stable case-insensitive comparison.
- Cap the merged server result at 40.
- While typing, rank a full display-name prefix ahead of a later-word prefix, then retain server score order. An alias match resolves to the canonical result and ranks after an equivalent canonical-name match.

The scoring constants should be named exports or a single configuration object so tests document the policy and later tuning does not require rewriting the algorithm.

### Client matching and interaction

Create a focused `QuickAddCombobox` client component instead of adding state to the server page.

- Normalize only comparison keys: trim/collapse whitespace and use case-insensitive Unicode-aware tokens. Never lowercase the candidate's `displayName`.
- Treat each query token as a prefix of candidate words in order. This supports `dress` → `Ginger Salad Dressing` and useful multiword narrowing without substring or fuzzy matching.
- Open after the first non-whitespace character and show no more than six results.
- Selection updates the item input and, when valid, the controlled store select. It does not submit.
- Manual edits after selection are allowed. A later manual store choice always wins.
- Close on Escape, outside pointer interaction, successful selection, or an empty normalized query.
- Support Arrow Up/Down, Enter to select, and Tab without trapping focus.

Follow the WAI-ARIA editable combobox/listbox pattern: the input owns `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, and `aria-controls`; options use a listbox; DOM focus remains in the input and the active option is exposed with `aria-activedescendant`.

## File-level implementation plan

1. `src/features/shopping/suggestions.ts`
   - Add the bounded merged candidate builder.
   - Change historical eligibility to purchased/substituted only.
   - Include aliases and most-recent-store metadata.
   - Keep Common Suggestions capped at its current visible size while sharing the candidate logic where practical.
2. `src/features/shopping/autocomplete.ts`
   - Add pure normalization, word-prefix matching, deduplication, and client-result ranking helpers. Keeping these functions independent of React and Prisma makes edge cases inexpensive to unit test.
3. `src/components/quick-add-combobox.tsx`
   - Add the progressively enhanced controlled inputs, accessible popup, keyboard/touch behavior, and selection handling.
4. `src/app/list/page.tsx`
   - Load the merged candidates alongside the existing bounded page data and pass them plus enabled stores to the component.
   - Continue rendering Common Suggestions separately.
5. `src/app/globals.css`
   - Add an iPhone-width popup anchored below the item field, touch targets of at least 44px, selected/active states, truncation for long names, and layering that does not move the page layout.
6. Tests and documentation
   - Expand suggestion service tests, add pure matching tests and component tests, add iPhone-size Playwright coverage, and update the README feature/test notes.

No Prisma schema change is planned. If production measurements later show that locating a household's latest completed trips is material, consider a composite index on `(householdId, status, completedAt)` independently; the first version does not justify a migration because it reads only ten trip relations and household-scale filtering is already indexed.

## Test plan

```text
Pure unit tests
  normalization | word-prefix | case preservation | ranking | deduplication
            |
Component tests
  popup state | keyboard | touch selection | store fill | free-form fallback | ARIA
            |
Database/service tests
  bounded history | eligible outcomes | aliases | recent store | exclusions
            |
Playwright at iPhone viewport
  type -> choose -> verify fields -> submit -> verify list
```

### Pure unit tests

- Match the start of the complete name and the start of later words.
- Match every casing combination while returning the original `displayName`.
- Match aliases while displaying the canonical name.
- Handle collapsed whitespace, punctuation, Unicode letters/numbers, and multiword queries.
- Reject mid-word substring matches and unrelated terms.
- Put canonical/full-name prefixes before alias/later-word prefixes and apply stable score tie-breakers.
- Cap results at six and avoid mutating the candidate array.

### Service tests

- Query only the ten newest completed trips and cap the merged pool at 40.
- Weight newer qualifying use above older use and combine repeated occurrences.
- Include purchased and substituted items; exclude carried-forward, pending, removed, and cancelled items.
- Preserve canonical capitalization and include aliases as match terms.
- Include successful free-form historical items.
- Deduplicate by catalog ID and normalized free-form name.
- Exclude items already on the current list using both identity paths.
- Choose the newest qualifying store, fall back to the catalog default, and return no selectable store when it is disabled or deleted.
- Isolate all data by household.
- Return catalog fallbacks when there is no completed history and return an empty array safely when neither source has data.

### Component and E2E tests

- Plain free-form entry and the existing Add item flow still work.
- One character opens the popup; clearing or Escape closes it.
- Keyboard and touch selection fill the preserved-case name and expected store without submitting.
- Enter selects an active result; Enter with no active result retains normal form submission behavior.
- Manual store changes override the suggested value.
- Missing/disabled stores leave the current store unchanged.
- Combobox/listbox roles, expanded state, active descendant, labels, and focus behavior are correct.
- At an iPhone viewport, the popup stays within the screen, rows remain readable, and Safari's 16px input font prevents focus zoom.
- Common Suggestions still render and add an item.

Run `npm run lint`, `npm run typecheck`, `npm run test:coverage`, and `npm run e2e`. The repository enforces 95% for statements, branches, functions, and lines; new branches should be directly covered rather than relying only on the global aggregate.

## Performance acceptance criteria

- No database or HTTP request occurs in response to typing.
- Historical item loading is limited to the ten newest completed trips.
- Catalog loading and the browser payload are capped at 40 candidates.
- At most six DOM options render at once.
- Filtering is `O(K * T)` over at most 40 candidates and their small term lists; it should complete synchronously well below a frame budget on an iPhone.
- Add lightweight development assertions/tests for caps. Avoid timing-based unit tests; use browser benchmarking only if interaction latency later regresses.

## Failure modes and fallbacks

| Failure | Expected behavior |
|---|---|
| Candidate query fails | The page follows its current server-render error path; no partially trusted client data is used. |
| JavaScript fails or hydration is delayed | The standard item/store form remains usable and submits through the existing server action. |
| Candidate becomes stale while page stays open | Submission is authoritative; the next action refresh/page render rebuilds candidates. |
| Another household member adds the same item | Existing server-side list behavior remains authoritative; autocomplete does not bypass it. |
| Historical store is disabled/deleted | Do not change the current store selection. |
| Alias or catalog changes after render | The current snapshot is safe; the next render reflects the change. |
| No match exists | Keep the user's text and allow normal free-form submission. |
| Long result text | Truncate visually while retaining the accessible full name. |

## Deferred scope and upgrade path

- Typo-tolerant/fuzzy matching, arbitrary substring search, and PostgreSQL `pg_trgm` indexes.
- A persistent popularity/materialized aggregate table.
- A per-keystroke search API or cross-device real-time candidate updates.
- Analytics-driven tuning of weights.

If household catalogs or history eventually exceed the bounded approach, preserve the `AutocompleteCandidate` contract and replace only the server candidate provider. A database-backed aggregate can then be maintained on completed item outcomes and indexed by household plus normalized terms without changing the UI.

## References

- [WAI-ARIA Authoring Practices: Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [Prisma filtering and case-insensitive query behavior](https://www.prisma.io/docs/orm/v6/prisma-client/queries/filtering-and-sorting)
- [PostgreSQL trigram indexes](https://www.postgresql.org/docs/17/pgtrgm.html) (deferred; short queries can still degrade to broad index scans)

## Definition of done

- All decisions above are implemented without a schema migration or new API endpoint.
- Existing free-form Quick Add and Common Suggestions behavior remains intact.
- Autocomplete is keyboard-, touch-, and screen-reader-operable at iPhone dimensions.
- Data access and payload caps are covered by tests.
- Lint, type checking, unit coverage, and Playwright pass with every coverage dimension above 95%.
- The change remains local for user validation until explicit approval to create a PR.
