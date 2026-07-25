"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { moveDeal } from "@/server/actions/deals";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { DealFormDialog, type DealFormValues } from "@/components/deal-form-dialog";
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

export function KanbanBoard({
  deals,
  contacts,
  companies,
}: {
  deals: BoardDeal[];
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}) {
  const [columns, setColumns] = useState<Columns>(() => groupDeals(deals));
  const [activeDeal, setActiveDeal] = useState<BoardDeal | null>(null);
  const [editing, setEditing] = useState<DealFormValues | null>(null);
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
        sensors={sensors}
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
                onCardClick={(deal) =>
                  setEditing({
                    id: deal.id,
                    title: deal.title,
                    value: deal.value,
                    stage: deal.stage,
                    expectedCloseDate: deal.expectedCloseDate?.slice(0, 10) ?? null,
                    contactId: deal.contactId,
                    companyId: deal.companyId,
                  })
                }
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
      <DealFormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        deal={editing}
        contacts={contacts}
        companies={companies}
      />
    </>
  );
}
