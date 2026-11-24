/** An error that maps directly to an HTTP response. Thrown from route logic, caught by `handle()`. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "Please sign in to continue.", "UNAUTHENTICATED");
export const forbidden = () => new HttpError(403, "You do not have permission to do this.", "FORBIDDEN");
// 404 (not 403) for other people's resources, so their existence is not leaked.
export const notFound = (what = "Resource") => new HttpError(404, `${what} not found.`, "NOT_FOUND");
export const conflict = (message: string, code = "CONFLICT") => new HttpError(409, message, code);
