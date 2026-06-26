import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./household.service";

describe("household service helpers", () => {
  it("normalizes approved emails before membership lookup", () => {
    expect(normalizeEmail("  Ed@Example.COM ")).toBe("ed@example.com");
  });
});
