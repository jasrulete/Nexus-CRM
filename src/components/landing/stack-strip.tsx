// The highest-signal section for an engineering reader: what it is actually
// built on, without making them open the repo first.
const stack = [
  "Next.js 16",
  "React 19",
  "TypeScript",
  "Prisma 7",
  "SQLite / Turso",
  "Tailwind v4",
  "Vitest",
  "Playwright",
];

export function StackStrip() {
  return (
    <section className="border-y border-edge/70 bg-surface-2/50">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-center text-[13px] font-medium tracking-wide text-ink-faint uppercase">
          Built with
        </h2>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
          {stack.map((item) => (
            <li
              key={item}
              className="rounded-lg border border-edge bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-muted"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
