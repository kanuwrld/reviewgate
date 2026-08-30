export class ReviewGateError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "invalid_request",
  ) {
    super(message);
    this.name = "ReviewGateError";
  }
}
