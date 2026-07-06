export const dynamic = "force-dynamic";

/** Liveness probe that confirms the web process can answer without depending on PostgreSQL. */
export function GET() {
  return Response.json(
    { status: "live" },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
