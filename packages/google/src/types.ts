export class GoogleApiError extends Error {
  constructor(
    readonly code:
      "GOOGLE_API_NOT_GOOGLE" | "GOOGLE_API_HTTP" | "GOOGLE_API_INVALID",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}
