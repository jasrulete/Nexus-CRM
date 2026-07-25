"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fieldErrors, idSchema, taskSchema } from "@/lib/validation";

function revalidateFor(task: { contactId: string | null; dealId: string | null }) {
  if (task.contactId) revalidatePath(`/contacts/${task.contactId}`);
  if (task.dealId) revalidatePath("/deals");
  revalidatePath("/dashboard");
}

export async function createTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { dueDate, contactId, dealId, ...data } = parsed.data;
  const task = await prisma.task.create({
    data: {
      ...data,
      dueDate: dueDate ? new Date(dueDate) : null,
      contactId: contactId || null,
      dealId: dealId || null,
      assigneeId: user.id,
    },
  });

  await audit({
    action: "task.create",
    entityType: "task",
    entityId: task.id,
    userId: user.id,
    metadata: { title: task.title },
  });
  revalidateFor(task);
  return { success: true };
}

export async function toggleTask(taskId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(taskId);

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return;
  if (task.assigneeId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the assignee or an admin can update");
  }

  await prisma.task.update({ where: { id }, data: { done: !task.done } });
  await audit({
    action: task.done ? "task.reopen" : "task.complete",
    entityType: "task",
    entityId: id,
    userId: user.id,
  });
  revalidateFor(task);
}

export async function deleteTask(taskId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(taskId);

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return;
  if (task.assigneeId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the assignee or an admin can delete");
  }

  await prisma.task.delete({ where: { id } });
  await audit({
    action: "task.delete",
    entityType: "task",
    entityId: id,
    userId: user.id,
  });
  revalidateFor(task);
}
