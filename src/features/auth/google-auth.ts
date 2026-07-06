import { getServerSession, type NextAuthOptions, type Profile } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "./email";

type GoogleProfile = Profile & {
  email?: string;
  email_verified?: boolean;
  family_name?: string;
  given_name?: string;
  name?: string;
  picture?: string;
};

const profileSchema = z.object({
  email: z.string().email(),
  email_verified: z.literal(true),
  family_name: z.string().optional(),
  given_name: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional()
});

/**
 * Validates a Google profile and synchronizes it with an approved household membership.
 * Returning false denies sign-in without exposing whether a particular email is approved.
 */
export async function authorizeGoogleProfile(profile: GoogleProfile | undefined) {
  const parsed = profileSchema.safeParse(profile);
  if (!parsed.success) return false;

  const email = normalizeEmail(parsed.data.email);
  return prisma.$transaction(async (tx) => {
    // Keep membership lookup and user-link repair atomic so a valid Google login cannot
    // observe a half-synchronized profile.
    const household = await tx.household.findFirst({ orderBy: { createdAt: "asc" } });
    if (!household) return false;

    const membership = await tx.membership.findUnique({
      where: {
        householdId_approvedEmail: {
          householdId: household.id,
          approvedEmail: email
        }
      },
      include: { user: true }
    });
    if (!membership || membership.status !== "active") return false;

    const firstName = membership.user?.firstName ?? parsed.data.given_name?.trim() ?? email.split("@")[0];
    const lastName = membership.user?.lastName ?? parsed.data.family_name?.trim() ?? "";
    const user = await tx.user.upsert({
      where: { email },
      update: {
        displayName: parsed.data.name?.trim() || membership.user?.displayName || firstName,
        imageUrl: parsed.data.picture ?? membership.user?.imageUrl,
        authProvider: "google"
      },
      create: {
        email,
        firstName,
        lastName,
        displayName: parsed.data.name?.trim() || firstName,
        imageUrl: parsed.data.picture,
        authProvider: "google"
      }
    });

    if (membership.userId !== user.id) {
      await tx.membership.update({ where: { id: membership.id }, data: { userId: user.id } });
    }
    return true;
  });
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "missing-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "missing-google-client-secret"
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60
  },
  pages: {
    signIn: "/login",
    error: "/unauthorized"
  },
  callbacks: {
    async signIn({ account, profile }) {
      // Only Google is configured; keep the explicit guard if providers are added later.
      if (account?.provider !== "google") return false;
      const approved = await authorizeGoogleProfile(profile as GoogleProfile | undefined);
      return approved || "/unauthorized";
    }
  }
};

/** Reads the server-side NextAuth session using the application's Google configuration. */
export function getGoogleSession() {
  return getServerSession(authOptions);
}
