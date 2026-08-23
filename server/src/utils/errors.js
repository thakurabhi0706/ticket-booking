/**
 * errors.js — Typed application errors that map to HTTP status codes.
 */

export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const E = {
  notFound:        (msg = 'Not found')        => new AppError('NOT_FOUND',        msg, 404),
  unauthorized:    (msg = 'Unauthorized')      => new AppError('UNAUTHORIZED',     msg, 401),
  forbidden:       (msg = 'Forbidden')         => new AppError('FORBIDDEN',        msg, 403),
  conflict:        (code, msg)                 => new AppError(code,               msg, 409),
  gone:            (code, msg)                 => new AppError(code,               msg, 410),
  validation:      (msg, details = null)       => new AppError('VALIDATION_ERROR', msg, 400, details),
  seatUnavailable: ()                          => new AppError('SEAT_UNAVAILABLE', 'One or more seats are no longer available', 409),
  holdExpired:     ()                          => new AppError('HOLD_EXPIRED',     'Your hold has expired. Please select seats again.', 410),
  offerExpired:    ()                          => new AppError('OFFER_EXPIRED',    'This offer has expired or already been claimed.', 410),
  tooManyRequests: ()                          => new AppError('RATE_LIMITED',     'Too many requests. Please slow down.', 429),
};
