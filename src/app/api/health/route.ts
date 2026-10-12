import { systemDb } from "@/lib/db";

// Unauthenticated liveness probe for uptime monitors and container healthchecks.
// Reports DB reachability without exposing any schema or config detail.
// systemDb, not a scoped client: the probe belongs to no workspace, and a raw
// query is exactly what scopeToWorkspace refuses (spec §5.1 allowlist).
export async function GET() {
  try {
    await systemDb.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
