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

export type ThreadErrorCode =
  | "THREAD_NOT_FOUND"
  | "THREAD_REVISION_CONFLICT"
  | "TASK_THREAD_REQUIRES_TASK_DELETE";

export class ThreadError extends Error {
  constructor(
    readonly code: ThreadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThreadError";
  }
}
