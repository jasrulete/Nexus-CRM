/**
 * Demo data seed. Run with: npm run db:seed
 * Creates a demo login: demo@nexuscrm.dev / demo-password-123
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { createDbAdapter } from "../src/lib/db-adapter";

// createDbAdapter() prefers TURSO_DATABASE_URL, and .env is loaded above — so
// a plain `npm run db:seed` on a dev machine would write demo data (including a
// publicly-documented ADMIN login) straight into production. Seeding a remote
// database has to be asked for explicitly.
if (process.env.SEED_REMOTE === "true") {
  console.log("SEED_REMOTE=true — seeding the remote database.");
  // createDbAdapter() ignores Turso outside Vercel unless told otherwise.
  process.env.ALLOW_REMOTE_DB = "true";
} else if (process.env.TURSO_DATABASE_URL) {
  console.log(
    "Seeding the local database (TURSO_DATABASE_URL ignored — use SEED_REMOTE=true to target the remote one).",
  );
  delete process.env.TURSO_DATABASE_URL;
}

const prisma = new PrismaClient({ adapter: createDbAdapter() });

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000);
}

// Date-only fields (due dates, expected close) are stored at UTC midnight,
// matching what the app's <input type="date"> forms produce.
function dateOnly(d: Date) {
  return new Date(d.toISOString().slice(0, 10));
}

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: "demo@nexuscrm.dev" },
  });
  if (existing) {
    console.log("Seed data already present — skipping. (Delete dev.db to reseed.)");
    return;
  }

  const demo = await prisma.user.create({
    data: {
      email: "demo@nexuscrm.dev",
      name: "Demo User",
      passwordHash: await bcrypt.hash("demo-password-123", 12),
      role: (await prisma.user.count()) === 0 ? "ADMIN" : "MEMBER",
    },
  });

  const companyData = [
    { name: "Northwind Analytics", domain: "northwind.io", industry: "Data & BI", size: "51-200", website: "https://northwind.io" },
    { name: "Brightline Health", domain: "brightline.health", industry: "Healthcare", size: "201-1000", website: "https://brightline.health" },
    { name: "Forge & Field", domain: "forgefield.com", industry: "Manufacturing", size: "1000+", website: "https://forgefield.com" },
    { name: "Lumen Studio", domain: "lumen.studio", industry: "Design agency", size: "11-50", website: "https://lumen.studio" },
    { name: "Harbor Logistics", domain: "harborlog.com", industry: "Logistics", size: "201-1000", website: "https://harborlog.com" },
    { name: "Petal & Stem", domain: "petalstem.com", industry: "E-commerce", size: "1-10", website: "https://petalstem.com" },
  ];
  const companies = [];
  for (const c of companyData) {
    companies.push(
      await prisma.company.create({ data: { ...c, ownerId: demo.id } }),
    );
  }
  const [northwind, brightline, forge, lumen, harbor, petal] = companies;

  const contactData = [
    { firstName: "Maya", lastName: "Okafor", email: "maya.okafor@northwind.io", phone: "+1 415 555 0132", title: "VP of Data", status: "QUALIFIED", source: "referral", companyId: northwind!.id, notes: "Evaluating replacements for their homegrown dashboard stack. Budget approved for Q3. Prefers annual billing." },
    { firstName: "Daniel", lastName: "Reyes", email: "d.reyes@brightline.health", phone: "+1 312 555 0178", title: "Director of Ops", status: "CUSTOMER", source: "website", companyId: brightline!.id, notes: "Signed the pilot in March. Very responsive. Interested in expanding to the claims team." },
    { firstName: "Ingrid", lastName: "Svensson", email: "ingrid.s@forgefield.com", phone: "+46 8 555 0110", title: "Chief Procurement Officer", status: "LEAD", source: "event", companyId: forge!.id, notes: "Met at the Stockholm supply-chain expo. Long sales cycles — procurement reviews take 90+ days." },
    { firstName: "Tomas", lastName: "Werner", email: "tomas@lumen.studio", phone: "+49 30 555 0155", title: "Founder", status: "QUALIFIED", source: "referral", companyId: lumen!.id, notes: "Referred by Daniel Reyes. Small team but growing fast; price sensitive, values white-glove onboarding." },
    { firstName: "Aisha", lastName: "Karim", email: "a.karim@harborlog.com", phone: "+1 206 555 0190", title: "Head of Customer Success", status: "LEAD", source: "outbound", companyId: harbor!.id, notes: "Cold outreach — opened three emails, no reply yet. Try a call next." },
    { firstName: "Sofia", lastName: "Marchetti", email: "sofia@petalstem.com", phone: "+39 02 555 0142", title: "Owner", status: "CUSTOMER", source: "website", companyId: petal!.id, notes: "Loves the product. Wrote a testimonial. Good case-study candidate for the SMB segment." },
    { firstName: "James", lastName: "Whitfield", email: "j.whitfield@northwind.io", phone: "+1 415 555 0167", title: "Data Engineer", status: "LEAD", source: "website", companyId: northwind!.id, notes: "Technical champion on Maya's team. Cares about API quality and webhooks." },
    { firstName: "Priya", lastName: "Nair", email: "priya.nair@brightline.health", phone: "+1 312 555 0121", title: "VP Claims", status: "QUALIFIED", source: "referral", companyId: brightline!.id, notes: "Expansion opportunity from Daniel's pilot. Needs SOC 2 documentation before signing." },
    { firstName: "Henrik", lastName: "Dahl", email: "henrik.dahl@forgefield.com", phone: "+46 8 555 0119", title: "Plant Manager", status: "CHURNED", source: "event", companyId: forge!.id, notes: "Trialed last year, went with a competitor on price. Contract renews in November — worth revisiting." },
    { firstName: "Luna", lastName: "Park", email: "luna@lumen.studio", phone: "+49 30 555 0148", title: "Studio Manager", status: "LEAD", source: "referral", companyId: lumen!.id, notes: "Handles vendor decisions with Tomas." },
    { firstName: "Marcus", lastName: "Bell", email: "marcus.bell@harborlog.com", phone: "+1 206 555 0173", title: "COO", status: "LEAD", source: "outbound", companyId: harbor!.id, notes: "Decision maker above Aisha. Only reachable through exec assistant." },
    { firstName: "Elena", lastName: "Vasquez", email: "elena.v@gmail.com", phone: "+34 91 555 0136", title: "Independent Consultant", status: "QUALIFIED", source: "other", companyId: null, notes: "Advises three mid-market retailers — potential channel partner rather than direct customer." },
  ];
  const contacts = [];
  for (const c of contactData) {
    contacts.push(
      await prisma.contact.create({ data: { ...c, ownerId: demo.id } }),
    );
  }
  const [maya, daniel, ingrid, tomas, aisha, sofia, , priya, henrik, , marcus, elena] = contacts;

  const dealData: {
    title: string; value: number; stage: string; position: number;
    contactId?: string; companyId?: string;
    expectedCloseDate?: Date; closedAt?: Date; createdDaysAgo: number;
  }[] = [
    { title: "Northwind — Analytics platform (annual)", value: 48000, stage: "PROPOSAL", position: 0, contactId: maya!.id, companyId: northwind!.id, expectedCloseDate: dateOnly(daysAgo(-21)), createdDaysAgo: 34 },
    { title: "Brightline — Claims team expansion", value: 62000, stage: "NEGOTIATION", position: 0, contactId: priya!.id, companyId: brightline!.id, expectedCloseDate: dateOnly(daysAgo(-10)), createdDaysAgo: 41 },
    { title: "Forge & Field — Plant ops pilot", value: 25000, stage: "LEAD", position: 0, contactId: ingrid!.id, companyId: forge!.id, expectedCloseDate: dateOnly(daysAgo(-75)), createdDaysAgo: 12 },
    { title: "Lumen Studio — Team plan", value: 9600, stage: "QUALIFIED", position: 0, contactId: tomas!.id, companyId: lumen!.id, expectedCloseDate: dateOnly(daysAgo(-14)), createdDaysAgo: 19 },
    { title: "Harbor Logistics — CS tooling", value: 36000, stage: "LEAD", position: 1, contactId: aisha!.id, companyId: harbor!.id, expectedCloseDate: dateOnly(daysAgo(-45)), createdDaysAgo: 8 },
    { title: "Elena Vasquez — Partner program", value: 15000, stage: "QUALIFIED", position: 1, contactId: elena!.id, expectedCloseDate: dateOnly(daysAgo(-30)), createdDaysAgo: 16 },
    { title: "Harbor — Exec briefing package", value: 5000, stage: "PROPOSAL", position: 1, contactId: marcus!.id, companyId: harbor!.id, expectedCloseDate: dateOnly(daysAgo(3)), createdDaysAgo: 27 },
    // Closed-won history for the revenue chart (spread over ~5 months)
    { title: "Brightline — Pilot program", value: 18000, stage: "WON", position: 0, contactId: daniel!.id, companyId: brightline!.id, closedAt: daysAgo(112), createdDaysAgo: 150 },
    { title: "Petal & Stem — Starter plan", value: 3600, stage: "WON", position: 1, contactId: sofia!.id, companyId: petal!.id, closedAt: daysAgo(96), createdDaysAgo: 120 },
    { title: "Northwind — Data audit", value: 12000, stage: "WON", position: 2, contactId: maya!.id, companyId: northwind!.id, closedAt: daysAgo(64), createdDaysAgo: 92 },
    { title: "Lumen — Brand site retainer", value: 7500, stage: "WON", position: 3, contactId: tomas!.id, companyId: lumen!.id, closedAt: daysAgo(38), createdDaysAgo: 66 },
    { title: "Brightline — Training add-on", value: 9000, stage: "WON", position: 4, contactId: daniel!.id, companyId: brightline!.id, closedAt: daysAgo(11), createdDaysAgo: 30 },
    { title: "Forge & Field — Legacy renewal", value: 22000, stage: "LOST", position: 0, contactId: henrik!.id, companyId: forge!.id, closedAt: daysAgo(80), createdDaysAgo: 130 },
  ];
  const deals = [];
  for (const d of dealData) {
    const { createdDaysAgo, ...rest } = d;
    deals.push(
      await prisma.deal.create({
        data: { ...rest, ownerId: demo.id, createdAt: daysAgo(createdDaysAgo) },
      }),
    );
  }

  const activityData: {
    type: string; content: string; contactId?: string; dealId?: string;
    companyId?: string; daysAgo: number;
  }[] = [
    { type: "MEETING", content: "Demo with Maya and the data team. Strong interest in the reporting API; asked for a security questionnaire and SSO details.", contactId: maya!.id, dealId: deals[0]!.id, daysAgo: 6 },
    { type: "EMAIL", content: "Sent proposal v2 with annual pricing and the SSO addendum. Waiting on their infosec review.", contactId: maya!.id, dealId: deals[0]!.id, daysAgo: 3 },
    { type: "CALL", content: "Priya confirmed budget for the claims expansion. Blocker: SOC 2 report needs to go through their vendor-risk process — ETA two weeks.", contactId: priya!.id, dealId: deals[1]!.id, daysAgo: 5 },
    { type: "NOTE", content: "Ingrid's procurement window opens next quarter. Set a reminder to re-engage mid-August with the manufacturing case study.", contactId: ingrid!.id, daysAgo: 9 },
    { type: "MEETING", content: "Kickoff-style call with Tomas and Luna. They want onboarding help for 12 seats; sent the team-plan quote after the call.", contactId: tomas!.id, dealId: deals[3]!.id, daysAgo: 4 },
    { type: "EMAIL", content: "Third outbound touch — shared the logistics benchmark report. Still no reply; switching to phone next week.", contactId: aisha!.id, daysAgo: 7 },
    { type: "CALL", content: "Quarterly check-in with Daniel. Pilot NPS is 9/10 internally; he offered to intro us to the claims org (done — see Priya).", contactId: daniel!.id, daysAgo: 14 },
    { type: "NOTE", content: "Sofia agreed to a written testimonial and a logo on the site. Marketing has the draft.", contactId: sofia!.id, daysAgo: 20 },
    { type: "MEETING", content: "Partner-program scoping with Elena — she'd bundle us into her retail advisory package. Needs co-marketing materials.", contactId: elena!.id, dealId: deals[5]!.id, daysAgo: 2 },
    { type: "EMAIL", content: "Exec briefing deck sent to Marcus's assistant for the COO review slot on the 24th.", contactId: marcus!.id, dealId: deals[6]!.id, daysAgo: 1 },
  ];
  for (const a of activityData) {
    const { daysAgo: d, ...rest } = a;
    await prisma.activity.create({
      data: { ...rest, userId: demo.id, createdAt: daysAgo(d) },
    });
  }

  const taskData: {
    title: string; dueDaysFromNow: number; contactId?: string; dealId?: string; done?: boolean;
  }[] = [
    { title: "Chase Northwind infosec review", dueDaysFromNow: 2, contactId: maya!.id, dealId: deals[0]!.id },
    { title: "Send SOC 2 report to Priya", dueDaysFromNow: 1, contactId: priya!.id, dealId: deals[1]!.id },
    { title: "Call Aisha (mornings PT work best)", dueDaysFromNow: 3, contactId: aisha!.id },
    { title: "Prep COO briefing for Harbor", dueDaysFromNow: 6, contactId: marcus!.id, dealId: deals[6]!.id },
    { title: "Draft co-marketing one-pager for Elena", dueDaysFromNow: 8, contactId: elena!.id },
    { title: "Re-engage Forge & Field before renewal window", dueDaysFromNow: 30, contactId: henrik!.id },
    { title: "Collect Lumen onboarding requirements", dueDaysFromNow: -1, contactId: tomas!.id, dealId: deals[3]!.id },
  ];
  for (const t of taskData) {
    const { dueDaysFromNow, ...rest } = t;
    await prisma.task.create({
      data: {
        ...rest,
        dueDate: dateOnly(daysAgo(-dueDaysFromNow)),
        assigneeId: demo.id,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "system.seed",
      entityType: "workspace",
      entityId: "seed",
      userId: demo.id,
      metadata: JSON.stringify({
        companies: companies.length,
        contacts: contacts.length,
        deals: deals.length,
      }),
    },
  });

  console.log("Seeded demo workspace:");
  console.log(`  ${companies.length} companies, ${contacts.length} contacts, ${deals.length} deals`);
  console.log("  Login: demo@nexuscrm.dev / demo-password-123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
