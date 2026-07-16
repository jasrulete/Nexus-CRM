import type { Metadata } from "next";
import {
  BrainCircuit,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { aiProviderName } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import { timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

const securityFeatures = [
  "Passwords hashed with bcrypt (cost 12) — never stored in plain text",
  "Sessions stored server-side as SHA-256 hashes in httpOnly, SameSite cookies",
  "Every mutation validated with zod and authorized on the server",
  "Login and AI endpoints rate-limited",
  "Full audit trail of logins, changes and AI usage",
];

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  const provider = aiProviderName();
  const isAdmin = user.role === "ADMIN";

  const [members, auditEntries] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    isAdmin
      ? prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 25,
          include: { user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" subtitle="Workspace, AI and security" />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Profile" />
          <div className="flex items-center gap-4 px-5 pb-5">
            <Avatar name={user.name} size="lg" />
            <div>
              <p className="text-sm font-medium text-ink">{user.name}</p>
              <p className="text-[13px] text-ink-faint">{user.email}</p>
            </div>
            <Badge className="ml-auto border-accent/25 bg-accent-soft text-accent">
              {user.role.toLowerCase()}
            </Badge>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="AI provider"
            subtitle="Powers lead scoring, summaries and email drafts"
          />
          <div className="px-5 pb-5">
            <div className="flex items-start gap-3 rounded-lg border border-edge bg-surface-2/50 px-4 py-3.5">
              <BrainCircuit className="mt-0.5 h-4.5 w-4.5 shrink-0 text-accent" />
              {provider ? (
                <div>
                  <p className="text-sm font-medium text-ink">
                    Connected: <span className="capitalize">{provider}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-ink-faint">
                    AI features are using the {provider} API. Change providers by
                    editing <code className="font-mono text-[12px]">.env</code>.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-ink">
                    Rule-based mode (no API key configured)
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-ink-faint">
                    AI features work with deterministic heuristics. For LLM-powered
                    results, add a free API key to{" "}
                    <code className="font-mono text-[12px]">.env</code>:{" "}
                    <code className="font-mono text-[12px]">GEMINI_API_KEY</code>{" "}
                    (Google AI Studio) or{" "}
                    <code className="font-mono text-[12px]">GROQ_API_KEY</code>{" "}
                    (Groq), then restart the server.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Team" subtitle="Everyone in this workspace" />
          <ul className="divide-y divide-edge/60">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={m.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                  <p className="truncate text-[12px] text-ink-faint">{m.email}</p>
                </div>
                {m.role === "ADMIN" ? (
                  <Badge className="border-accent/25 bg-accent-soft text-accent">
                    <ShieldCheck className="h-3 w-3" /> admin
                  </Badge>
                ) : (
                  <Badge className="border-edge-strong/60 bg-surface-2 text-ink-faint">
                    <Users className="h-3 w-3" /> member
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Security" subtitle="What this workspace does to protect your data" />
          <ul className="space-y-2.5 px-5 pb-5">
            {securityFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[13px] text-ink-muted">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader
              title="Audit log"
              subtitle="Latest 25 events (admins only)"
            />
            {auditEntries.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-faint">
                No events recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-edge/60">
                {auditEntries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                    <ScrollText className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                      {e.action}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-faint">
                      {e.user?.name ?? "system"}
                      {e.metadata ? ` · ${e.metadata.slice(0, 80)}` : ""}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-faint">
                      {timeAgo(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
