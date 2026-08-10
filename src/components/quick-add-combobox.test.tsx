// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { QuickAddCombobox } from "./quick-add-combobox";
import type { AutocompleteCandidate } from "@/features/shopping/suggestions";

const stores = [
  { id: "giant", name: "Giant" },
  { id: "whole-foods", name: "Whole Foods" }
];

const candidates: AutocompleteCandidate[] = [
  {
    displayName: "Makoto Ginger Salad Dressing",
    matchTerms: ["Makoto Ginger Salad Dressing", "ginger dressing"],
    score: 10,
    groceryItemId: "dressing",
    category: "Pantry",
    storeId: "giant"
  },
  {
    displayName: "Milk",
    matchTerms: ["Milk"],
    score: 8,
    groceryItemId: "milk",
    category: "Dairy",
    storeId: null
  }
];

function setup(overrides = candidates) {
  const action = vi.fn();
  render(createElement(QuickAddCombobox, { action, candidates: overrides, stores }));
  return { action, input: screen.getByRole("combobox", { name: "Item" }), store: screen.getByLabelText("Store") };
}

describe("QuickAddCombobox", () => {
  it("opens after one character and selecting a result fills canonical case and its store without submitting", () => {
    const { action, input, store } = setup();
    fireEvent.change(input, { target: { value: "DRESS" } });

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Grocery suggestions" })).toBeVisible();
    const option = screen.getByRole("option", { name: /Makoto Ginger Salad Dressing/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(input).toHaveValue("Makoto Ginger Salad Dressing");
    expect(store).toHaveValue("giant");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(action).not.toHaveBeenCalled();
  });

  it("supports Arrow keys, active-descendant state, Enter selection, and Escape", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant");
    expect(screen.getByRole("option", { name: /Makoto/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /Milk/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Milk");

    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps manual store choices and ignores a candidate whose store is unavailable", () => {
    const unavailable = [{ ...candidates[0], storeId: "disabled-store" }];
    const { input, store } = setup(unavailable);
    fireEvent.change(store, { target: { value: "whole-foods" } });
    fireEvent.change(input, { target: { value: "ging" } });
    fireEvent.click(screen.getByRole("option", { name: /Makoto Ginger Salad Dressing/ }));

    expect(store).toHaveValue("whole-foods");
    expect(input).toHaveValue("Makoto Ginger Salad Dressing");
  });

  it("allows unmatched free-form text and closes when focus leaves or input is cleared", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "mystery item" } });
    expect(input).toHaveValue("mystery item");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "milk" } });
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("wraps keyboard navigation and leaves Enter alone until an option is active", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("m");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: /Milk/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Makoto/ })).toHaveAttribute("aria-selected", "true");
  });

  it("clears the item and store after a successful submission", async () => {
    const { action, input, store } = setup();
    fireEvent.change(input, { target: { value: "Milk" } });
    fireEvent.change(store, { target: { value: "giant" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    await waitFor(() => expect(input).toHaveValue(""));
    expect(store).toHaveValue("");
  });
});
