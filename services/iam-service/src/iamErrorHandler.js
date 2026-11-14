import { AppError } from './iamErrors.js';

export const errorHandler = (err, req, res, _next) => {
  console.error('IAM request error:', { message: err.message, stack: err.stack, url: req.url, method: req.method });
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message, ...(err.errors && { errors: err.errors }) } });
  }
  if (err.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE_ENTRY', message: 'A record with this value already exists' } });
  if (err.code === 'P2022') return res.status(503).json({ error: { code: 'SCHEMA_MISMATCH', message: 'IAM database schema is out of date; apply the IAM database migrations.' } });
  if (err.name === 'ValidationError') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
  return res.status(err.status || 500).json({ error: {
    code: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  } });
};
