import { describe, expect, it } from "vitest";
import {
  companySchema,
  contactSchema,
  dealSchema,
  fieldErrors,
  loginSchema,
  registerSchema,
} from "./validation";

describe("registerSchema", () => {
  it("accepts a valid registration and lowercases the email", () => {
    const result = registerSchema.safeParse({
      name: "Jeric R",
      email: "User@Example.COM",
      password: "long-enough-password",
    });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("user@example.com");
  });

  it("rejects an invalid email address", () => {
    const result = registerSchema.safeParse({
      name: "Jeric R",
      email: "not-an-email",
      password: "long-enough-password",
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      name: "Jeric R",
      email: "user@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Password must be at least 8 characters",
    );
  });

  it("rejects single-character names", () => {
    const result = registerSchema.safeParse({
      name: "J",
      email: "user@example.com",
      password: "long-enough-password",
    });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires a password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Password is required");
  });
});

describe("contactSchema", () => {
  it("accepts a minimal contact and normalizes empty email to null", () => {
    const result = contactSchema.safeParse({
      firstName: "Maya",
      lastName: "Okafor",
      status: "LEAD",
      email: "",
    });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBeNull();
  });

  it("rejects a malformed email when one is provided", () => {
    const result = contactSchema.safeParse({
      firstName: "Maya",
      lastName: "Okafor",
      status: "LEAD",
      email: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown contact statuses", () => {
    const result = contactSchema.safeParse({
      firstName: "Maya",
      lastName: "Okafor",
      status: "VIP",
    });
    expect(result.success).toBe(false);
  });
});

describe("companySchema", () => {
  it("requires the website to be a real URL with a protocol", () => {
    const bad = companySchema.safeParse({ name: "Acme", website: "example.com" });
    expect(bad.success).toBe(false);

    const good = companySchema.safeParse({
      name: "Acme",
      website: "https://example.com",
    });
    expect(good.success).toBe(true);
  });

  it("treats an empty website field as null", () => {
    const result = companySchema.safeParse({ name: "Acme", website: "" });
    expect(result.success).toBe(true);
    expect(result.data?.website).toBeNull();
  });
});

describe("dealSchema", () => {
  it("coerces form-string values into integers", () => {
    const result = dealSchema.safeParse({
      title: "Annual license",
      value: "5000",
      stage: "PROPOSAL",
    });
    expect(result.success).toBe(true);
    expect(result.data?.value).toBe(5000);
  });

  it("rejects negative and fractional values", () => {
    expect(
      dealSchema.safeParse({ title: "X", value: "-5", stage: "LEAD" }).success,
    ).toBe(false);
    expect(
      dealSchema.safeParse({ title: "X", value: "12.5", stage: "LEAD" }).success,
    ).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("flattens a zod error into a field → first-message map", () => {
    const result = registerSchema.safeParse({
      name: "J",
      email: "bad",
      password: "x",
    });
    expect(result.success).toBe(false);
    const errors = fieldErrors(result.error!);
    expect(errors).toEqual({
      name: "Name must be at least 2 characters",
      email: "Enter a valid email address",
      password: "Password must be at least 8 characters",
    });
  });
});
