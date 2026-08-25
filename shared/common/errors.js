/**
 * Shared Error Classes
 * Custom error classes for microservices
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message = 'Invalid transition for current case state') {
    super(message, 400, 'INVALID_TRANSITION');
  }
}

export class WorkflowClosedError extends AppError {
  constructor(message = 'Workflow is locked (not editable in current status)') {
    super(message, 409, 'WORKFLOW_CLOSED');
  }
}

export class WorkflowNotPublishedError extends AppError {
  constructor(message = 'No published workflow matches the request') {
    super(message, 409, 'WORKFLOW_NOT_PUBLISHED');
  }
}

export class TenantMismatchError extends AppError {
  constructor(message = 'Tenant mismatch detected') {
    super(message, 403, 'TENANT_MISMATCH');
  }
}

export class InvalidReferralStateError extends AppError {
  constructor(message = 'Referral cannot be transitioned from this state') {
    super(message, 409, 'INVALID_REFERRAL_STATE');
  }
}

export class InvalidQueryError extends AppError {
  constructor(message = 'Malformed query payload', errors = []) {
    super(message, 400, 'INVALID_QUERY');
    this.errors = errors;
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(message = 'Mutation rejected by business rules') {
    super(message, 422, 'BUSINESS_RULE_VIOLATION');
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfter = 60) {
    super('Rate limit exceeded. Please try again later.', 429, 'RATE_LIMITED');
    this.retryAfter = retryAfter;
  }
}

