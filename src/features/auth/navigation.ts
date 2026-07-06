import { redirect } from "next/navigation";
import { AuthenticationRequiredError, AuthorizationError } from "./errors";

/** Converts expected authentication failures into the appropriate Next.js redirect. */
export function redirectForAuthError(error: unknown): never {
  if (error instanceof AuthenticationRequiredError) redirect("/login");
  if (error instanceof AuthorizationError) redirect("/unauthorized");
  throw error;
}
