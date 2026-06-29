export class AuthenticationRequiredError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "You are not authorized for this household.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class MembershipAuthorizationError extends AuthorizationError {
  constructor(message = "This Google account is not approved for this household.") {
    super(message);
    this.name = "MembershipAuthorizationError";
  }
}

export class CapabilityAuthorizationError extends AuthorizationError {
  constructor(capability: string) {
    super(`You need ${capability} access to do that.`);
    this.name = "CapabilityAuthorizationError";
  }
}

export function isExpectedAuthError(error: unknown) {
  return error instanceof AuthenticationRequiredError || error instanceof AuthorizationError;
}
