import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it.each([
    ["  Person@GMAIL.COM ", "person@gmail.com"],
    ["person+shopping@gmail.com", "person+shopping@gmail.com"],
    ["first.last@gmail.com", "first.last@gmail.com"]
  ])("normalizes case and whitespace without rewriting Gmail aliases", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
