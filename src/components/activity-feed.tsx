import Link from "next/link";
import { Mail, NotebookPen, Phone, Users } from "lucide-react";
import { timeAgo } from "@/lib/utils";

const typeIcon = {
  NOTE: NotebookPen,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
} as const;

export type FeedItem = {
  id: string;
  type: string;
  content: string;
  createdAt: Date;
  user: { name: string };
  contact: { id: string; firstName: string; lastName: string } | null;
  deal: { id: string; title: string } | null;
};

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <ul className="space-y-0.5 px-3 pb-3">
      {items.map((a) => {
        const Icon = typeIcon[a.type as keyof typeof typeIcon] ?? NotebookPen;
        return (
          <li key={a.id} className="flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2/60">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-faint">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                <span className="font-medium">{a.user.name}</span>
                <span className="text-ink-faint"> logged a {a.type.toLowerCase()}</span>
                {a.contact ? (
                  <>
                    <span className="text-ink-faint"> with </span>
                    <Link
                      href={`/contacts/${a.contact.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {a.contact.firstName} {a.contact.lastName}
                    </Link>
                  </>
                ) : a.deal ? (
                  <>
                    <span className="text-ink-faint"> on </span>
                    <span className="font-medium">{a.deal.title}</span>
                  </>
                ) : null}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-ink-muted">
                {a.content}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-faint">{timeAgo(a.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
