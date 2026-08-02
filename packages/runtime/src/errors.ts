export type RuntimeErrorCode =
  | "SESSION_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "RUN_STATE_CONFLICT"
  | "LEASE_NOT_FOUND"
  | "LEASE_EXPIRED";

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}
