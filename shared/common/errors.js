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
  constructor(message = 'Workflow is closed or archived') {
    super(message, 400, 'WORKFLOW_CLOSED');
  }
}

export class WorkflowNotPublishedError extends AppError {
  constructor(message = 'Workflow is not published') {
    super(message, 400, 'WORKFLOW_NOT_PUBLISHED');
  }
}

export class TenantMismatchError extends AppError {
  constructor(message = 'Tenant mismatch detected') {
    super(message, 403, 'TENANT_MISMATCH');
  }
}

export class InvalidReferralStateError extends AppError {
  constructor(message = 'Invalid referral state operation') {
    super(message, 400, 'INVALID_REFERRAL_STATE');
  }
}

