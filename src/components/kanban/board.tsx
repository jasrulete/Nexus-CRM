"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { moveDeal } from "@/server/actions/deals";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { DealFormDialog } from "@/components/deal-form-dialog";
import { KanbanColumn } from "./column";
import { DealCard, type BoardDeal } from "./deal-card";

type Columns = Record<DealStage, BoardDeal[]>;

function groupDeals(deals: BoardDeal[]): Columns {
  const cols = Object.fromEntries(
    DEAL_STAGES.map((s) => [s, []]),
  ) as unknown as Columns;
  for (const deal of deals) {
    const stage = (DEAL_STAGES as readonly string[]).includes(deal.stage)
      ? (deal.stage as DealStage)
      : "LEAD";
    cols[stage].push(deal);
  }
  for (const s of DEAL_STAGES) cols[s].sort((a, b) => a.position - b.position);
  return cols;
}


/**
 * Left/right moves between stage columns; up/down reorders within one.
 *
 * dnd-kit's stock `sortableKeyboardCoordinates` filters candidate droppables by
 * raw geometry, which on this board resolves a right-arrow to the next card
 * *below* rather than the next column — so a keyboard user could reorder a
 * column but never change a deal's stage, which is the entire point of the
 * page. Columns are the droppables whose id is a stage, so they can be found by
 * name and stepped through in visual order.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const horizontal = event.code === "ArrowLeft" || event.code === "ArrowRight";
  if (!horizontal) return sortableKeyboardCoordinates(event, args);

  const { active, collisionRect, droppableContainers } = args.context;
  if (!active || !collisionRect) return;
  event.preventDefault();

  const columns = droppableContainers
    .getEnabled()
    .filter((c) => (DEAL_STAGES as readonly string[]).includes(String(c.id)))
    .map((c) => ({ id: String(c.id), rect: c.rect.current }))
    .filter((c): c is { id: string; rect: NonNullable<typeof c.rect> } => c.rect != null)
    .sort((a, b) => a.rect.left - b.rect.left);
  if (columns.length === 0) return;

  // The column the card is currently over: the nearest by horizontal centre,
  // which stays correct even mid-transition between two columns.
  const cardCentre = collisionRect.left + collisionRect.width / 2;
  let nearest = 0;
  for (let i = 1; i < columns.length; i++) {
    const centre = columns[i]!.rect.left + columns[i]!.rect.width / 2;
    const bestCentre = columns[nearest]!.rect.left + columns[nearest]!.rect.width / 2;
    if (Math.abs(centre - cardCentre) < Math.abs(bestCentre - cardCentre)) nearest = i;
  }

  const target = columns[nearest + (event.code === "ArrowRight" ? 1 : -1)];
  if (!target) return; // already at the first or last stage

  // Aim just inside the target column so collision detection resolves to it.
  return {
    x: target.rect.left + target.rect.width / 2 - collisionRect.width / 2,
    y: target.rect.top + 8,
  };
};

export function KanbanBoard({
  deals,
  contacts,
  companies,
}: {
  deals: BoardDeal[];
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<Columns>(() => groupDeals(deals));
  const [activeDeal, setActiveDeal] = useState<BoardDeal | null>(null);
  const [creating, setCreating] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Re-sync when the server revalidates ("adjust state during render" pattern
  // from the React docs — avoids an extra effect pass).
  const [lastDeals, setLastDeals] = useState(deals);
  if (lastDeals !== deals) {
    setLastDeals(deals);
    setColumns(groupDeals(deals));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Without this the board is mouse-only: cards already receive role="button"
    // and a tabIndex from dnd-kit's attributes, so they focus — but nothing
    // responds to a key, and moving a deal between stages is the whole point of
    // the page. Space picks a card up, arrows move it, Space drops, Escape
    // cancels. Enter is deliberately left out of the activator set so it stays
    // free to open the card (see DealCard).
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space"],
      },
    }),
  );

  const dealIndex = useMemo(() => {
    const map = new Map<string, DealStage>();
    for (const stage of DEAL_STAGES) {
      for (const d of columns[stage]) map.set(d.id, stage);
    }
    return map;
  }, [columns]);

  function findStage(id: string): DealStage | null {
    if ((DEAL_STAGES as readonly string[]).includes(id)) return id as DealStage;
    return dealIndex.get(id) ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    const stage = dealIndex.get(String(event.active.id));
    if (!stage) return;
    setActiveDeal(
      columns[stage].find((d) => d.id === event.active.id) ?? null,
    );
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const from = findStage(String(active.id));
    const to = findStage(String(over.id));
    if (!from || !to || from === to) return;

    // Move the card into the hovered column (visual preview).
    setColumns((prev) => {
      const moving = prev[from].find((d) => d.id === active.id);
      if (!moving) return prev;
      const overIndex = prev[to].findIndex((d) => d.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : prev[to].length;
      const next: Columns = { ...prev };
      next[from] = prev[from].filter((d) => d.id !== active.id);
      next[to] = [
        ...prev[to].slice(0, insertAt),
        { ...moving, stage: to },
        ...prev[to].slice(insertAt),
      ];
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;

    const stage = findStage(String(over.id)) ?? dealIndex.get(String(active.id));
    if (!stage) return;

    const column = columns[stage];
    const fromIndex = column.findIndex((d) => d.id === active.id);
    if (fromIndex < 0) return;

    let toIndex =
      String(over.id) === stage
        ? column.length - 1
        : column.findIndex((d) => d.id === over.id);
    if (toIndex < 0) toIndex = column.length - 1;

    const reordered = [...column];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved!);

    // Optimistic; if the server refuses, put the board back where it was.
    const snapshot = columns;
    setColumns({ ...columns, [stage]: reordered });
    setMoveError(null);

    void moveDeal({ dealId: String(active.id), stage, position: toIndex })
      .then((result) => {
        if (!result?.ok) throw new Error("move rejected");
      })
      .catch(() => {
        setColumns(snapshot);
        setMoveError("Couldn't move that deal — it's been put back.");
      });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        {moveError ? (
          <p className="text-[13px] text-danger" role="status">
            {moveError}
          </p>
        ) : (
          <span />
        )}
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New deal
        </Button>
      </div>

      <DndContext
        // Stable id, not decoration: dnd-kit derives the cards'
        // aria-describedby from this, and without it falls back to a
        // module-level counter that starts at 0 on the server and continues
        // climbing on the client — a hydration mismatch on every board render.
        id="nexus-kanban"
        sensors={sensors}
        // dnd-kit's stock instructions describe only the drag; a screen-reader
        // user would never learn that Enter opens the deal.
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "To pick up a deal, press Space. Use the arrow keys to move it to another stage, then press Space again to drop it, or Escape to cancel. Press Enter to open the deal.",
          },
        }}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {DEAL_STAGES.map((stage) => (
            <SortableContext
              key={stage}
              items={columns[stage].map((d) => d.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumn
                stage={stage}
                label={STAGE_LABELS[stage]}
                deals={columns[stage]}
                // Click and Enter open the deal's page, where editing lives.
                // A link nested inside the draggable card would have been the
                // alternative, but an interactive element inside a
                // role="button" is exactly what axe's nested-interactive rule
                // flags, and the accessibility suite runs on this page.
                onCardClick={(deal) => router.push(`/deals/${deal.id}`)}
              />
            </SortableContext>
          ))}
        </div>
        <DragOverlay>
          {activeDeal ? <DealCard deal={activeDeal} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <DealFormDialog
        open={creating}
        onOpenChange={setCreating}
        contacts={contacts}
        companies={companies}
      />
    </>
  );
}
