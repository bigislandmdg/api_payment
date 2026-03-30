import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

export interface ErrorWithStatus extends Error {
  status?: number;
  code?: string;
}

export const errorHandler = (
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'INTERNAL_ERROR';

  res.status(status).json({
    success: false,
    error: message,
    code,
    timestamp: new Date().toISOString(),
    path: req.url,
  });
};

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    code: 'NOT_FOUND',
    path: req.url,
    method: req.method
  });
};