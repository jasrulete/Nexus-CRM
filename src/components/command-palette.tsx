"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Building2, KanbanSquare, Loader2, NotebookPen, Search, User } from "lucide-react";
import { searchRecords } from "@/server/actions/search";
import {
  SEARCH_MIN_CHARS,
  SEARCH_PER_KIND,
  type SearchHit,
  type SearchKind,
  type SearchResult,
} from "@/lib/search";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Global search: ⌘K / Ctrl+K (or the header button) opens a dialog holding a
 * WAI-ARIA editable combobox over a grouped listbox. Results come from one
 * server action per settled keystroke — server-filtered and capped, never a
 * table load filtered on the client.
 *
 * Composes Radix's Dialog primitives directly rather than the shared
 * DialogContent, which hard-codes a visible title row, padding and a Close
 * button. Focus stays in the input throughout; the highlighted option is
 * virtual (aria-activedescendant), so screen readers hear the option without
 * focus ever leaving the text box.
 */

const DEBOUNCE_MS = 150;

const GROUPS: {
  kind: SearchKind;
  label: string;
  one: string;
  many: string;
  icon: typeof User;
}[] = [
  { kind: "contact", label: "Contacts", one: "contact", many: "contacts", icon: User },
  { kind: "company", label: "Companies", one: "company", many: "companies", icon: Building2 },
  { kind: "deal", label: "Deals", one: "deal", many: "deals", icon: KanbanSquare },
  { kind: "activity", label: "Notes", one: "note", many: "notes", icon: NotebookPen },
];

function key(hit: SearchHit) {
  return `${hit.kind}:${hit.id}`;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ query: string; data: SearchResult } | null>(null);
  // Only the latest request may land: actions dispatch one at a time, but a
  // slow one can still resolve after a newer query has been typed.
  const seqRef = useRef(0);
  // What had focus when the shortcut opened the palette, to hand it back.
  const openerRef = useRef<Element | null>(null);
  const inputId = useId();
  const listboxId = useId();

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.repeat || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      // Beats Chrome's own Ctrl+K (focus the address bar).
      event.preventDefault();
      openerRef.current = document.activeElement;
      setOpen((wasOpen) => !wasOpen);
    }
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      searchRecords(q)
        // Production masks server-action error text, so no message sniffing.
        .catch((): SearchResult => ({ ok: false, message: "Couldn't search just now — try again." }))
        .then((data) => {
          if (seq === seqRef.current) setResult({ query: q, data });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Everything below is derived at render, never set in an effect.
  const q = query.trim();
  const tooShort = q.length < SEARCH_MIN_CHARS;
  const settled = !tooShort && result !== null && result.query === q;
  const pending = !tooShort && !settled;
  // Stale-while-loading: the previous list stays up while the next query runs.
  const hits: SearchHit[] = tooShort || !result?.data.ok ? [] : result.data.hits;
  const expanded = hits.length > 0;
  // Derived from the same `hits` array as the listbox, so the id in
  // aria-activedescendant can never point at an option that is not rendered.
  const active = hits.find((h) => key(h) === activeKey) ?? hits[0] ?? null;
  const optionId = (hit: SearchHit) => `${listboxId}-${hit.kind}-${hit.id}`;
  const groupId = (kind: SearchKind) => `${listboxId}-${kind}`;
  const activeId = active ? optionId(active) : null;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  let statusText = "";
  if (settled && result) {
    const data = result.data;
    if (!data.ok) {
      statusText = data.message;
    } else if (data.hits.length === 0) {
      statusText = `No matches for “${q}”.`;
    } else {
      const counts = GROUPS.map((g) => ({
        g,
        n: data.hits.filter((h) => h.kind === g.kind).length,
      })).filter((c) => c.n > 0);
      const total = data.hits.length;
      statusText =
        `${total} result${total === 1 ? "" : "s"} — ` +
        `${counts.map(({ g, n }) => `${n} ${n === 1 ? g.one : g.many}`).join(", ")}.` +
        (data.truncated
          ? ` Showing the first ${SEARCH_PER_KIND} of each type — keep typing to narrow.`
          : "");
    }
  }

  const groups = GROUPS.map((g) => ({ ...g, hits: hits.filter((h) => h.kind === g.kind) })).filter(
    (g) => g.hits.length > 0,
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResult(null);
      setActiveKey(null);
      seqRef.current++; // drops any in-flight response
    }
  }

  function select(hit: SearchHit) {
    handleOpenChange(false);
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); // the caret stays where it is
      if (hits.length === 0) return;
      const index = active ? hits.findIndex((h) => key(h) === key(active)) : -1;
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % hits.length
          : (index - 1 + hits.length) % hits.length;
      setActiveKey(key(hits[next]!));
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      select(active);
    }
  }

  /**
   * Radix's modal Dialog always hands focus back to the Trigger on close. That
   * is right when the header button opened the palette, and wrong after the
   * shortcut did — focus belongs back where it was (WCAG 2.4.3). If that element
   * is gone (Enter navigated away), fall through to Radix and the button.
   */
  function restoreFocus(event: Event) {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener instanceof HTMLElement && opener.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-keyshortcuts="Control+K Meta+K"
          title="Search (⌘K / Ctrl+K)"
          className="text-ink-faint md:w-56 md:justify-start md:border-edge-strong/70 md:bg-surface md:shadow-sm"
        >
          <Search aria-hidden className="h-4 w-4" />
          <span className="max-md:sr-only">Search</span>
          <kbd
            aria-hidden
            className="ml-auto hidden rounded-md border border-edge bg-surface-2 px-1.5 font-mono text-[11px] md:inline"
          >
            ⌘K
          </kbd>
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={restoreFocus}
          className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to search contacts, companies, deals and notes. Use the up and down arrow keys
            to move through results, Enter to open one, Escape to close.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2 border-b border-edge px-4">
            {pending ? (
              <Loader2
                aria-hidden
                className="h-4 w-4 shrink-0 animate-spin text-ink-faint motion-reduce:animate-none"
              />
            ) : (
              <Search aria-hidden className="h-4 w-4 shrink-0 text-ink-faint" />
            )}
            <label htmlFor={inputId} className="sr-only">
              Search contacts, companies, deals and notes
            </label>
            <input
              id={inputId}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded ? listboxId : undefined}
              aria-activedescendant={expanded && activeId ? activeId : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Search contacts, companies, deals, notes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              // text-base below md: iOS zooms into any input smaller than 16px.
              className="h-12 w-full bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none md:text-sm"
            />
            <kbd
              aria-hidden
              className="hidden rounded-md border border-edge bg-surface-2 px-1.5 font-mono text-[11px] text-ink-faint md:inline"
            >
              Esc
            </kbd>
          </div>

          {/* Visible and live: sighted and screen-reader users read the same
              count, and it only changes when a result settles, so typing is
              never narrated. */}
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="min-h-8 px-4 py-2 text-[12px] text-ink-faint"
          >
            {statusText}
          </p>

          <div aria-busy={pending} className="max-h-[60dvh] overflow-y-auto p-2">
            {tooShort ? (
              <p className="px-2.5 py-6 text-center text-[13px] text-ink-faint">
                Search by name, email, domain, deal title, or a word from a note.
              </p>
            ) : null}
            {expanded ? (
              <div role="listbox" id={listboxId} aria-label="Search results">
                {groups.map((group) => (
                  <div role="group" aria-labelledby={groupId(group.kind)} key={group.kind}>
                    <div
                      id={groupId(group.kind)}
                      className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint"
                    >
                      {group.label}
                    </div>
                    {group.hits.map((hit) => {
                      const isActive = active !== null && key(hit) === key(active);
                      return (
                        <div
                          key={key(hit)}
                          id={optionId(hit)}
                          role="option"
                          aria-selected={isActive}
                          onPointerMove={() => setActiveKey(key(hit))}
                          // Keep focus in the input for mouse users too.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => select(hit)}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-ink",
                            isActive && "bg-surface-2",
                          )}
                        >
                          <group.icon aria-hidden className="h-4 w-4 shrink-0 text-ink-faint" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{hit.title}</span>
                            {hit.subtitle ? (
                              <span className="block truncate text-[12px] text-ink-faint">
                                {hit.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div
            aria-hidden
            className="hidden gap-4 border-t border-edge px-4 py-2 text-[11px] text-ink-faint md:flex"
          >
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
