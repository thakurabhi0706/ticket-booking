/**
 * validate.js — Tiny hand-rolled validation helper.
 * Keeps dependency count honest (no Joi / Zod).
 */
import { E } from './errors.js';

/**
 * Validate a request body against a schema.
 * Schema shape: { fieldName: { type, required, min, max, enum } }
 */
export function validate(schema, body) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const val = body[field];
    const missing = val === undefined || val === null || val === '';

    if (rules.required && missing) {
      errors.push(`${field} is required`);
      continue;
    }
    if (missing) continue;

    if (rules.type === 'string' && typeof val !== 'string') {
      errors.push(`${field} must be a string`);
    }
    if (rules.type === 'number' && typeof val !== 'number') {
      errors.push(`${field} must be a number`);
    }
    if (rules.type === 'array' && !Array.isArray(val)) {
      errors.push(`${field} must be an array`);
    }
    if (rules.minLength && typeof val === 'string' && val.length < rules.minLength) {
      errors.push(`${field} must be at least ${rules.minLength} characters`);
    }
    if (rules.maxLength && typeof val === 'string' && val.length > rules.maxLength) {
      errors.push(`${field} must be at most ${rules.maxLength} characters`);
    }
    if (rules.min !== undefined && typeof val === 'number' && val < rules.min) {
      errors.push(`${field} must be at least ${rules.min}`);
    }
    if (rules.max !== undefined && typeof val === 'number' && val > rules.max) {
      errors.push(`${field} must be at most ${rules.max}`);
    }
    if (rules.enum && !rules.enum.includes(val)) {
      errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
    }
    if (rules.minItems && Array.isArray(val) && val.length < rules.minItems) {
      errors.push(`${field} must have at least ${rules.minItems} item(s)`);
    }
    if (rules.maxItems && Array.isArray(val) && val.length > rules.maxItems) {
      errors.push(`${field} must have at most ${rules.maxItems} item(s)`);
    }
    if (rules.email && typeof val === 'string') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        errors.push(`${field} must be a valid email address`);
      }
    }
  }

  if (errors.length > 0) {
    throw E.validation(errors[0], errors);
  }
}
