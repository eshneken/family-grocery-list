import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { isMockAuthEnabled } from "@/features/auth/mode";

export async function middleware(request: NextRequest) {
  if (isMockAuthEnabled()) return NextResponse.next();

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/list/:path*", "/shop/:path*", "/history/:path*", "/admin/:path*"]
};
