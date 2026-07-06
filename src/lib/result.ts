export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

/** Builds the success half of the shared server-action result contract. */
export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

/** Builds the failure half of the shared server-action result contract. */
export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}
