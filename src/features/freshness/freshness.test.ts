import { describe, expect, it } from "vitest";
import { REFRESH_AFTER_MS, shouldRefreshOnReturn } from "./freshness";

describe("shouldRefreshOnReturn", () => {
  const lastRefreshAt = 1_000;

  it("refreshes once the app has been stale for five minutes", () => {
    expect(
      shouldRefreshOnReturn({
        now: lastRefreshAt + REFRESH_AFTER_MS,
        lastRefreshAt,
        isOnline: true,
        hasOpenDialog: false,
        hasFocusedFormControl: false
      })
    ).toBe(true);
  });

  it.each([
    {
      label: "the data was refreshed recently",
      now: lastRefreshAt + REFRESH_AFTER_MS - 1,
      isOnline: true,
      hasOpenDialog: false,
      hasFocusedFormControl: false
    },
    {
      label: "the device is offline",
      now: lastRefreshAt + REFRESH_AFTER_MS,
      isOnline: false,
      hasOpenDialog: false,
      hasFocusedFormControl: false
    },
    {
      label: "a dialog is open",
      now: lastRefreshAt + REFRESH_AFTER_MS,
      isOnline: true,
      hasOpenDialog: true,
      hasFocusedFormControl: false
    },
    {
      label: "the user is editing a form field",
      now: lastRefreshAt + REFRESH_AFTER_MS,
      isOnline: true,
      hasOpenDialog: false,
      hasFocusedFormControl: true
    }
  ])("does not refresh when $label", ({ now, isOnline, hasOpenDialog, hasFocusedFormControl }) => {
    expect(shouldRefreshOnReturn({ now, lastRefreshAt, isOnline, hasOpenDialog, hasFocusedFormControl })).toBe(false);
  });
});
