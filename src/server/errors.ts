/**
 * Errors thrown by services. Route handlers and server actions translate them
 * into user-facing messages; nothing here contains secrets or stack details.
 */

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Not signed in, or the session is no longer valid. */
export class AuthenticationError extends AppError {
  constructor(message = "Sign in to continue.") {
    super(message, "UNAUTHENTICATED");
  }
}

/** Signed in, but the role does not allow this action. */
export class ForbiddenError extends AppError {
  constructor(message = "Your role does not allow this action.") {
    super(message, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "That record no longer exists.") {
    super(message, "NOT_FOUND");
  }
}

/** Someone else changed the record first, or a business rule blocks the change. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class ValidationError extends AppError {
  constructor(
    readonly fieldErrors: Record<string, string[]>,
    message = "Check the highlighted fields.",
  ) {
    super(message, "VALIDATION");
  }
}
