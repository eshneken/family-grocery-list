import { z } from "zod";
import { AuthenticationRequiredError } from "./errors";
import { normalizeEmail } from "./email";
import { getGoogleSession } from "./google-auth";
import { isMockAuthEnabled } from "./mode";
import { getMockIdentity } from "./mock-auth";
import type { AuthenticatedIdentity } from "./types";

export async function getAuthenticatedIdentity(): Promise<AuthenticatedIdentity> {
  if (isMockAuthEnabled()) return getMockIdentity();

  const session = await getGoogleSession();
  const normalizedSessionEmail = typeof session?.user?.email === "string" ? normalizeEmail(session.user.email) : undefined;
  const parsedEmail = z.string().email().safeParse(normalizedSessionEmail);
  if (!parsedEmail.success) throw new AuthenticationRequiredError();

  const email = parsedEmail.data;
  return {
    email,
    displayName: session?.user?.name?.trim() || email.split("@")[0],
    imageUrl: session?.user?.image ?? null,
    provider: "google"
  };
}
