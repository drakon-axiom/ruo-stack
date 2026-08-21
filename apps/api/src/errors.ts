/** Typed HTTP error carrying a status code + stable error code for the client. */
export class HttpError extends Error {
  // Explicit fields rather than parameter properties: this API runs from
  // TypeScript source and Node strips its types at load time, which handles
  // erasable syntax only. `erasableSyntaxOnly` in apps/api/tsconfig.json fails
  // the typecheck if a parameter property is reintroduced.
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'HttpError';
  }
}

export const Unauthorized = (msg = 'Unauthorized') => new HttpError(401, 'unauthorized', msg);
export const Forbidden = (msg = 'Forbidden', code = 'forbidden') => new HttpError(403, code, msg);
export const NotFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const BadRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const Conflict = (code: string, msg: string) => new HttpError(409, code, msg);
