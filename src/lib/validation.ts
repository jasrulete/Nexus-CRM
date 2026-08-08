import { z } from "zod";
import {
  ACTIVITY_TYPES,
  COMPANY_SIZES,
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  DEAL_STAGES,
} from "./constants";

// ---------- auth ----------

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.email("Enter a valid email address").max(254).toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").max(254).toLowerCase(),
  password: z.string().min(1, "Password is required").max(128),
});

// ---------- shared ----------

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.iso.date("Enter a valid date").nullable())
  .nullable()
  .optional();

export const idSchema = z.string().min(1).max(64);

// Optional background the user types before generating a draft. Capped so a
// paste cannot blow past the model's context or the free-tier token budget.
export const aiContextSchema = z.string().trim().max(2000).optional();

// ---------- contacts ----------

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Enter a valid email address").nullable())
    .nullable()
    .optional(),
  phone: optionalTrimmed(40),
  title: optionalTrimmed(120),
  status: z.enum(CONTACT_STATUSES),
  source: z
    .enum(CONTACT_SOURCES)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  notes: optionalTrimmed(5000),
  companyId: optionalTrimmed(64),
});

// ---------- companies ----------

export const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(160),
  domain: optionalTrimmed(160),
  industry: optionalTrimmed(120),
  size: z
    .enum(COMPANY_SIZES)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  website: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : v))
    .pipe(
      z
        .url("Enter a valid URL (include https://)")
        .startsWith("http", "Enter a valid URL (include https://)")
        .nullable(),
    )
    .nullable()
    .optional(),
  notes: optionalTrimmed(5000),
});

// ---------- deals ----------

export const dealSchema = z.object({
  title: z.string().trim().min(1, "Deal title is required").max(160),
  value: z.coerce
    .number("Value must be a number")
    .int("Value must be a whole number")
    .min(0, "Value cannot be negative")
    .max(1_000_000_000),
  stage: z.enum(DEAL_STAGES),
  expectedCloseDate: optionalDate,
  contactId: optionalTrimmed(64),
  companyId: optionalTrimmed(64),
});

export const dealMoveSchema = z.object({
  dealId: idSchema,
  stage: z.enum(DEAL_STAGES),
  position: z.coerce.number().int().min(0).max(100_000),
});

// ---------- activities ----------

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  content: z.string().trim().min(1, "Write something first").max(5000),
  contactId: optionalTrimmed(64),
  dealId: optionalTrimmed(64),
  companyId: optionalTrimmed(64),
});

// ---------- tasks ----------

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),
  dueDate: optionalDate,
  contactId: optionalTrimmed(64),
  dealId: optionalTrimmed(64),
});

/** Flatten a zod error into { field: message } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
