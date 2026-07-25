// Shared skeleton for every authed route: a page heading plus a card grid,
// which is the shape all of them settle into.
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Bar className="h-6 w-48" />
      <Bar className="mt-2 h-4 w-72" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-edge bg-surface p-5">
            <Bar className="h-3 w-24" />
            <Bar className="mt-3 h-7 w-20" />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-edge bg-surface">
        <div className="border-b border-edge/60 px-5 py-4">
          <Bar className="h-4 w-32" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3">
            <Bar className="h-8 w-8 rounded-full" />
            <Bar className="h-4 flex-1 max-w-xs" />
            <Bar className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
