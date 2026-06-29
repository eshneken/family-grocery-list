import { describe, expect, it } from "vitest";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  CapabilityAuthorizationError,
  MembershipAuthorizationError,
  isExpectedAuthError
} from "./errors";

describe("auth errors", () => {
  it("classifies expected auth failures without swallowing operational errors", () => {
    expect(isExpectedAuthError(new AuthenticationRequiredError())).toBe(true);
    expect(isExpectedAuthError(new MembershipAuthorizationError())).toBe(true);
    expect(isExpectedAuthError(new AuthorizationError())).toBe(true);
    expect(isExpectedAuthError(new Error("database unavailable"))).toBe(false);
  });

  it("provides explicit capability messages", () => {
    expect(new CapabilityAuthorizationError("shop")).toMatchObject({
      name: "CapabilityAuthorizationError",
      message: "You need shop access to do that."
    });
  });
});
