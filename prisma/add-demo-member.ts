/**
 * Adds (or resets) a non-admin demo account so reviewers can see the
 * member-level view alongside the admin "Try the demo" login:
 *
 *   member@nexuscrm.dev / member-password-123   (role: MEMBER)
 *
 * Idempotent — upserts only this one account, touching nothing else. Run with:
 *   npm run db:add-member          (local dev.db, or Turso if its env is set)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";

const prisma = new PrismaClient({ adapter: createDbAdapter() });

async function main() {
  const passwordHash = await bcrypt.hash("member-password-123", 12);
  await prisma.user.upsert({
    where: { email: "member@nexuscrm.dev" },
    update: { passwordHash, role: "MEMBER" },
    create: {
      email: "member@nexuscrm.dev",
      name: "Member Demo",
      passwordHash,
      role: "MEMBER",
    },
  });
  console.log("Demo member ready: member@nexuscrm.dev / member-password-123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
