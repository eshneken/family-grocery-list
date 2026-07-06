import NextAuth from "next-auth";
import { authOptions } from "@/features/auth/google-auth";

// One configured handler serves both route methods so session behavior cannot drift by verb.
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
