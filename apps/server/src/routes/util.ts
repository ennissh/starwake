export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export const httpError = (status: number, code: string, message: string, detail?: unknown) =>
  new HttpError(status, code, message, detail);
