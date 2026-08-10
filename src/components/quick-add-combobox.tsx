"use client";

import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  getAutocompleteMatches,
  indexAutocompleteCandidates,
  normalizeAutocompleteWords
} from "@/features/shopping/autocomplete";
import type { AutocompleteCandidate } from "@/features/shopping/suggestions";

type StoreOption = { id: string; name: string };

export function QuickAddCombobox({
  action,
  candidates,
  stores
}: {
  action: (formData: FormData) => void | Promise<void>;
  candidates: AutocompleteCandidate[];
  stores: StoreOption[];
}) {
  const listboxId = useId();
  const [itemValue, setItemValue] = useState("");
  const [storeId, setStoreId] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const indexedCandidates = useMemo(() => indexAutocompleteCandidates(candidates), [candidates]);
  const matches = useMemo(() => getAutocompleteMatches(indexedCandidates, itemValue), [indexedCandidates, itemValue]);
  const visible = open && matches.length > 0 && normalizeAutocompleteWords(itemValue).length > 0;

  async function handleSubmit(formData: FormData) {
    await action(formData);
    setItemValue("");
    setStoreId("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function selectCandidate(candidate: AutocompleteCandidate) {
    setItemValue(candidate.displayName);
    if (candidate.storeId && stores.some((store) => store.id === candidate.storeId)) setStoreId(candidate.storeId);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") return current >= matches.length - 1 ? 0 : current + 1;
        return current <= 0 ? matches.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter" && visible && activeIndex >= 0) {
      event.preventDefault();
      selectCandidate(matches[activeIndex]);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <form action={handleSubmit} className="quick-add">
      <div className="field autocomplete-field" onBlur={handleBlur}>
        <label htmlFor={`${listboxId}-input`}>Item</label>
        <div className="autocomplete-control">
          <input
            id={`${listboxId}-input`}
            name="rawText"
            required
            value={itemValue}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={listboxId}
            aria-activedescendant={visible && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setItemValue(value);
              setOpen(normalizeAutocompleteWords(value).length > 0);
              setActiveIndex(-1);
            }}
            onFocus={() => setOpen(normalizeAutocompleteWords(itemValue).length > 0)}
            onKeyDown={handleKeyDown}
          />
          {visible ? (
            <div id={listboxId} className="autocomplete-listbox" role="listbox" aria-label="Grocery suggestions">
              {matches.map((candidate, index) => (
                <button
                  key={`${candidate.groceryItemId ?? candidate.displayName}-${candidate.storeId ?? "any"}`}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className="autocomplete-option"
                  tabIndex={-1}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectCandidate(candidate)}
                >
                  <span>{candidate.displayName}</span>
                  <small>{stores.find((store) => store.id === candidate.storeId)?.name ?? "Any Store"}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <label className="field">
        Store
        <select name="storeId" value={storeId} onChange={(event) => setStoreId(event.currentTarget.value)}>
          <option value="">Any Store</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button">Add item</button>
    </form>
  );
}
