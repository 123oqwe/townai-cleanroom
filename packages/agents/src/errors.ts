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
  | "TASK_THREAD_REQUIRES_TASK_DELETE"
  | "TASK_THREAD_REQUIRES_TASK_UPDATE";

export class ThreadError extends Error {
  constructor(
    readonly code: ThreadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThreadError";
  }
}

export type TurnErrorCode = "REFERENCE_UNAVAILABLE" | "TASK_NOT_FOUND";

export class TurnError extends Error {
  constructor(
    readonly code: TurnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TurnError";
  }
}

export type TaskErrorCode =
  "TASK_NOT_FOUND" | "TASK_REVISION_CONFLICT" | "REFERENCE_UNAVAILABLE";

export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export type InputRequestErrorCode =
  "INPUT_REQUEST_NOT_FOUND" | "INPUT_REQUEST_ALREADY_RESOLVED";

export class InputRequestError extends Error {
  constructor(
    readonly code: InputRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InputRequestError";
  }
}
