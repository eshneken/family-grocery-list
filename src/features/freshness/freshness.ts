export const REFRESH_AFTER_MS = 5 * 60 * 1000;

/**
 * Decides whether a returning mobile app may refresh without interrupting an edit.
 * Five minutes avoids unnecessary requests while allowing family changes to surface promptly.
 */
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
