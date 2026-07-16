"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Check, Trash2 } from "lucide-react";
import { deleteTask, toggleTask } from "@/server/actions/tasks";
import { cn, formatDateOnly } from "@/lib/utils";

export type TaskItem = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  contact: { id: string; firstName: string; lastName: string } | null;
};

export function TaskList({ tasks }: { tasks: TaskItem[] }) {
  const [, startTransition] = useTransition();

  if (tasks.length === 0) return null;

  return (
    <ul className="divide-y divide-edge/60">
      {tasks.map((task) => {
        const overdue =
          !task.done && task.dueDate && new Date(task.dueDate) < new Date();
        return (
          <li key={task.id} className="group flex items-center gap-3 px-5 py-2.5">
            <button
              aria-label={task.done ? "Mark as open" : "Mark as done"}
              onClick={() => startTransition(() => void toggleTask(task.id))}
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors cursor-pointer",
                task.done
                  ? "border-accent bg-accent text-on-accent"
                  : "border-edge-strong hover:border-accent",
              )}
            >
              {task.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-sm",
                  task.done ? "text-ink-faint line-through" : "text-ink",
                )}
              >
                {task.title}
              </p>
              {task.contact ? (
                <Link
                  href={`/contacts/${task.contact.id}`}
                  className="text-[12px] text-ink-faint hover:text-accent"
                >
                  {task.contact.firstName} {task.contact.lastName}
                </Link>
              ) : null}
            </div>
            {task.dueDate ? (
              <span
                className={cn(
                  "shrink-0 text-[12px] tabular-nums",
                  overdue ? "font-medium text-danger" : "text-ink-faint",
                )}
              >
                {formatDateOnly(task.dueDate)}
              </span>
            ) : null}
            <button
              aria-label="Delete task"
              onClick={() => startTransition(() => void deleteTask(task.id))}
              className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
