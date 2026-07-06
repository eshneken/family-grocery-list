/** Normalizes email identity without applying provider-specific alias rules. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
