"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit, auditTx } from "@/lib/audit";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate } from "@/lib/authz";
import { findMissingRelation, missingRelationMessage } from "@/lib/relations";
import { fieldErrors, idSchema, taskSchema } from "@/lib/validation";
import { actorOf, requireWorkspace } from "@/lib/workspace-context";

function revalidateFor(task: { contactId: string | null; dealId: string | null }) {
  if (task.contactId) revalidatePath(`/contacts/${task.contactId}`);
  if (task.dealId) {
    revalidatePath("/deals");
    revalidatePath(`/deals/${task.dealId}`);
  }
  revalidatePath("/dashboard");
}

export async function createTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireWorkspace();
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { dueDate, contactId, dealId, ...data } = parsed.data;

  // Same guard as createActivity: an id from a stale form, or from another
  // workspace, must not reach the create as a link.
  const missing = await findMissingRelation(ctx.db, { contactId, dealId });
  if (missing) return { message: missingRelationMessage(missing) };

  const task = await ctx.db.task.create({
    data: {
      ...data,
      dueDate: dueDate ? new Date(dueDate) : null,
      contactId: contactId || null,
      dealId: dealId || null,
      assigneeId: ctx.user.id,
      workspaceId: ctx.workspaceId,
    },
  });

  await audit(ctx.db, {
    action: "task.create",
    entityType: "task",
    entityId: task.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    metadata: { title: task.title },
  });
  revalidateFor(task);
  return { success: true };
}

export async function toggleTask(taskId: string): Promise<void> {
  const ctx = await requireWorkspace();
  const id = idSchema.parse(taskId);

  const task = await ctx.db.task.findUnique({ where: { id } });
  if (!task) return;
  if (!canMutate(task.assigneeId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the assignee or an admin can update");
  }

  await ctx.db.task.update({ where: { id }, data: { done: !task.done } });
  await audit(ctx.db, {
    action: task.done ? "task.reopen" : "task.complete",
    entityType: "task",
    entityId: id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
  });
  revalidateFor(task);
}

export async function deleteTask(taskId: string): Promise<void> {
  const ctx = await requireWorkspace();
  assertNotLockedDemoAccount(ctx.user);
  const id = idSchema.parse(taskId);

  const task = await ctx.db.task.findUnique({ where: { id } });
  if (!task) return;
  if (!canMutate(task.assigneeId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the assignee or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await ctx.db.$transaction(async (tx) => {
    await tx.task.delete({ where: { id } });
    await auditTx(tx, {
      action: "task.delete",
      entityType: "task",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
    });
  });
  revalidateFor(task);
}
