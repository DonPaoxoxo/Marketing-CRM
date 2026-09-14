/** One error shape for the whole API: `{ message, field?, conflictId? }`.
 *
 *  The browser client already maps `field` onto the offending input and
 *  `conflictId` onto the blocking record, so keeping this contract is what lets
 *  the frontend switch from the mock to this server without form changes. */

import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  field?: string;
  conflictId?: string;

  constructor(status: number, message: string, extra: { field?: string; conflictId?: string } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.field = extra.field;
    this.conflictId = extra.conflictId;
  }
}

export const badRequest = (message: string, extra?: { field?: string }) => new HttpError(400, message, extra);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string, extra?: { field?: string; conflictId?: string }) =>
  new HttpError(409, message, extra);
export const unprocessable = (message: string, extra?: { field?: string }) => new HttpError(422, message, extra);
export const tooManyRequests = (message: string) => new HttpError(429, message);

/** Wraps an async handler so a rejected promise reaches the error middleware
 *  instead of hanging the request. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Final error handler.
 *
 *  Known errors report their message. Anything else is logged server-side and
 *  answered with a generic message — an unexpected database error must not leak
 *  a query, a column name or a connection string to the browser. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
      ...(error.conflictId ? { conflictId: error.conflictId } : {}),
    });
    return;
  }

  // Body-parser refusals are the client's to fix, not a server fault.
  const parserType = (error as { type?: string } | null)?.type;
  if (parserType === 'entity.too.large') {
    res.status(413).json({ message: 'That is too large to send.' });
    return;
  }
  if (parserType === 'entity.parse.failed') {
    res.status(400).json({ message: 'The request body could not be read.' });
    return;
  }

  console.error('Unhandled request error:', error);
  res.status(500).json({ message: 'Something went wrong. The error has been logged.' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: 'No such endpoint.' });
}
