import { PrismaClient } from "@/generated/prisma/client";
import { createDbAdapter } from "./db-adapter";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Singleton so hot reload in dev doesn't exhaust connections.
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createDbAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
