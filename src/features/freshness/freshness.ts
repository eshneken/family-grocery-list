export const REFRESH_AFTER_MS = 5 * 60 * 1000;

export function shouldRefreshOnReturn({
  now,
  lastRefreshAt,
  isOnline,
  hasOpenDialog,
  hasFocusedFormControl
}: {
  now: number;
  lastRefreshAt: number;
  isOnline: boolean;
  hasOpenDialog: boolean;
  hasFocusedFormControl: boolean;
}) {
  return (
    isOnline &&
    !hasOpenDialog &&
    !hasFocusedFormControl &&
    now - lastRefreshAt >= REFRESH_AFTER_MS
  );
}
