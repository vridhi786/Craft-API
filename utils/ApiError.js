export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details) { return new ApiError(400, code, message, details); }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED') { return new ApiError(401, code, message); }
  static forbidden(message = 'You do not have permission to do this', code = 'FORBIDDEN') { return new ApiError(403, code, message); }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') { return new ApiError(404, code, message); }
  static conflict(message = 'Conflict', code = 'CONFLICT', details) { return new ApiError(409, code, message, details); }
}
