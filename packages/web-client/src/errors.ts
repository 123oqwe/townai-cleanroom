/** A typed API error carrying the HTTP status and machine-readable code. */
export class TownApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly metadata: Record<string, string> | null;

  constructor(
    status: number,
    code: string | null,
    message: string,
    metadata: Record<string, string> | null = null,
  ) {
    super(message);
    this.name = "TownApiError";
    this.status = status;
    this.code = code;
    this.metadata = metadata;
  }
}
