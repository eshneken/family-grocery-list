import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return Response.json(
      { status: "ready" },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
