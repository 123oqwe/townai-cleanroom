export type AgentErrorCode =
  | "AGENT_NOT_FOUND"
  | "AGENT_REVISION_CONFLICT"
  | "PERSONAL_AGENT_ALREADY_EXISTS";

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
