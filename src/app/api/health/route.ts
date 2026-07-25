import { prisma } from "@/lib/db";

// Unauthenticated liveness probe for uptime monitors and container healthchecks.
// Reports DB reachability without exposing any schema or config detail.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
