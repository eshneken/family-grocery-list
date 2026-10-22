// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RequestItemEditor } from "./request-item-editor";
import { updateListItemAction } from "@/app/actions";

vi.mock("@/app/actions", () => ({ updateListItemAction: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

function setup(rememberStore = false, requestStore: string | null = "giant") {
  vi.mocked(updateListItemAction).mockReset().mockResolvedValue(undefined);
  render(<RequestItemEditor id="item" displayName="Oranges" category="Produce" storeId={requestStore} stores={[{ id: "giant", name: "Giant" }, { id: "costco", name: "Costco" }]} recurringStaple={false} savedStoreId={rememberStore ? "giant" : null} />);
  fireEvent.click(screen.getByLabelText("Edit Oranges"));
  return screen.getByRole("checkbox", { name: "Remember this store for future requests" });
}

describe("request editor future store preference", () => {
  it.each(["costco", null])("preserves the saved store on an unrelated edit of a %s request override", async (requestStore) => {
    const checkbox = setup(true, requestStore);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/Saved future store: Giant/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Fresh oranges" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateListItemAction).toHaveBeenCalledOnce());
    expect(vi.mocked(updateListItemAction).mock.calls[0][0].has("storePreferencePresent")).toBe(false);
  });

  it("explicitly clears a saved preference that differs from this request", async () => {
    setup(true, "costco");
    fireEvent.click(screen.getByRole("button", { name: "Clear saved preference" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateListItemAction).toHaveBeenCalledOnce());
    const form = vi.mocked(updateListItemAction).mock.calls[0][0];
    expect(form.get("storePreferencePresent")).toBe("true");
    expect(form.has("rememberStore")).toBe(false);
    expect(form.get("storeId")).toBe("costco");
  });

  it("keeps an editor store change request-only until the checkbox is explicitly checked", async () => {
    const checkbox = setup(true);
    fireEvent.change(screen.getByLabelText("Store", { exact: true }), { target: { value: "costco" } });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateListItemAction).toHaveBeenCalledOnce());
    const form = vi.mocked(updateListItemAction).mock.calls[0][0];
    expect(form.get("storePreferencePresent")).toBe("true");
    expect(form.get("rememberStore")).toBe("on");
    expect(form.get("storeId")).toBe("costco");
  });

  it.each([false, true])("shows the saved preference (%s) and submits an explicit choice", async (saved) => {
    const checkbox = setup(saved);
    expect(checkbox).toHaveProperty("checked", saved);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateListItemAction).toHaveBeenCalledOnce());
    const form = vi.mocked(updateListItemAction).mock.calls[0][0];
    expect(form.get("storePreferencePresent")).toBe("true");
    expect(form.get("rememberStore")).toBe(saved ? null : "on");
    expect(form.get("storeId")).toBe("giant");
  });

  it("resets unsaved preference changes when reopening the dialog", () => {
    const checkbox = setup();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByLabelText("Edit Oranges"));
    expect(checkbox).not.toBeChecked();
  });

  it("keeps the dialog and preference available when saving fails", async () => {
    setup();
    vi.mocked(updateListItemAction).mockRejectedValueOnce(new Error("Try again"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("shows a safe fallback for a non-Error failure and permits dismissing the backdrop", async () => {
    setup();
    vi.mocked(updateListItemAction).mockRejectedValueOnce("network failure");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update this item. Try again.");
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
