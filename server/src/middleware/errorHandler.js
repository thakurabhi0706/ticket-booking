/**
 * errorHandler.js — Global Express error handler.
 * Normalizes all errors to { error: { code, message, details } }.
 */
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // PostgreSQL invalid text representation (e.g. a non-UUID in a :id path param)
  // is a client mistake, not a server fault.
  if (err.code === '22P02') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Malformed identifier in request.' },
    });
  }

  // PostgreSQL unique violation → conflict
  if (err.code === '23505') {
    return res.status(409).json({
      error: { code: 'DUPLICATE', message: 'A record with this data already exists.' },
    });
  }

  console.error('[ERROR]', err.message, err.stack?.split('\n')[1]);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
    },
  });
}
