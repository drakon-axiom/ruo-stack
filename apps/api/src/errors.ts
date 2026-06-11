/** Typed HTTP error carrying a status code + stable error code for the client. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const Unauthorized = (msg = 'Unauthorized') => new HttpError(401, 'unauthorized', msg);
export const Forbidden = (msg = 'Forbidden') => new HttpError(403, 'forbidden', msg);
export const NotFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const BadRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const Conflict = (code: string, msg: string) => new HttpError(409, code, msg);
