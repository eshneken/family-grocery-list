import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Readiness probe that tests the database and intentionally returns no internal error details. */
export async function GET() {
  try {
    // This fixed query contains no interpolation; it is used only as a minimal connection probe.
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
