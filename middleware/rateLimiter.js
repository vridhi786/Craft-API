import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', message)),
  });

export function createLimiters({ loginMax, apiMax, orderMax }) {
  return {
    api: make(15 * 60 * 1000, apiMax, 'Too many requests. Please try again shortly.'),
    login: make(15 * 60 * 1000, loginMax, 'Too many login attempts. Please try again in 15 minutes.'),
    order: make(60 * 60 * 1000, orderMax, 'Too many orders submitted. Please try again later.'),
    track: make(15 * 60 * 1000, 30, 'Too many tracking attempts. Please try again later.'),
  };
}
