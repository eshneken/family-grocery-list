/** Signals that the caller has no usable authenticated identity. */
export class AuthenticationRequiredError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/** Base error for authenticated callers who may not access the requested household resource. */
export class AuthorizationError extends Error {
  constructor(message = "You are not authorized for this household.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Signals that an identity lacks an active membership in the household. */
export class MembershipAuthorizationError extends AuthorizationError {
  constructor(message = "This Google account is not approved for this household.") {
    super(message);
    this.name = "MembershipAuthorizationError";
  }
}

/** Signals that an active member lacks one of the role-like household capabilities. */
export class CapabilityAuthorizationError extends AuthorizationError {
  constructor(capability: string) {
    super(`You need ${capability} access to do that.`);
    this.name = "CapabilityAuthorizationError";
  }
}

/** Identifies auth failures that pages may safely turn into a login or access redirect. */
export function isExpectedAuthError(error: unknown) {
  return error instanceof AuthenticationRequiredError || error instanceof AuthorizationError;
}
