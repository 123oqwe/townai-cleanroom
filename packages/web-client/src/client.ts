import type { Id, ServerEvent } from "@town/contracts";

import { TownApiError } from "./errors.js";
import { parseEventStream } from "./sse.js";
import type {
  AuthSessionResponse,
  ListOptions,
  MessageInput,
  MessageSubmission,
  SafeUser,
  Thread,
  ThreadCreateInput,
  ThreadPage,
  TurnPage,
} from "./types.js";

export interface TownClientOptions {
  baseUrl: string;
  token?: string;
  /** Inject `fetch` for tests; defaults to the global. */
  fetch?: typeof globalThis.fetch;
}

export interface StreamOptions {
  cursor?: string;
  intervalMs?: number;
  windowMs?: number;
  signal?: AbortSignal;
}

export interface AuthApi {
  createSession(email: string): Promise<AuthSessionResponse>;
  deleteSession(): Promise<void>;
}

export interface MeApi {
  get(): Promise<SafeUser>;
}

export interface ThreadsApi {
  list(options?: ListOptions): Promise<ThreadPage>;
  get(id: Id<"thread">): Promise<Thread>;
  create(input: ThreadCreateInput): Promise<Thread>;
  turns(id: Id<"thread">, options?: ListOptions): Promise<TurnPage>;
}

export interface SessionsApi {
  create(
    threadId: Id<"thread">,
    input: MessageInput,
  ): Promise<MessageSubmission>;
  eventsStream(
    sessionId: Id<"runtime-session">,
    options?: StreamOptions,
  ): AsyncIterable<ServerEvent>;
}

interface RequestOptions {
  readonly method: string;
  readonly body?: unknown;
  readonly accept?: string;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

/**
 * Typed client for the Town `/v1` REST + SSE API. Construct with the API base
 * URL and an optional bearer token; every method returns a typed promise and
 * throws `TownApiError` (carrying `status`/`code`) on non-2xx responses.
 */
export class TownClient {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;
  readonly auth: AuthApi;
  readonly me: MeApi;
  readonly threads: ThreadsApi;
  readonly sessions: SessionsApi;

  constructor(options: TownClientOptions) {
    if (options.baseUrl.length === 0)
      throw new TypeError("TownClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.auth = {
      createSession: (email: string) =>
        this.postJson<AuthSessionResponse>("/v1/auth/session", { email }),
      deleteSession: () => this.delete("/v1/me/session"),
    };
    this.me = {
      get: () => this.getJson<{ user: SafeUser }>("/v1/me").then((r) => r.user),
    };
    this.threads = {
      list: (options?: ListOptions) =>
        this.getJson<ThreadPage>(`/v1/threads${this.query(options)}`),
      get: (id: Id<"thread">) =>
        this.getJson<{ thread: Thread }>(`/v1/threads/${id}`).then(
          (r) => r.thread,
        ),
      create: (input: ThreadCreateInput) =>
        this.postJson<{ thread: Thread }>("/v1/threads", input).then(
          (r) => r.thread,
        ),
      turns: (id: Id<"thread">, options?: ListOptions) =>
        this.getJson<TurnPage>(`/v1/threads/${id}/turns${this.query(options)}`),
    };
    this.sessions = {
      create: (threadId: Id<"thread">, input: MessageInput) =>
        this.postJson<MessageSubmission>(
          `/v1/threads/${threadId}/messages`,
          { text: input.text, mentions: input.mentions ?? [] },
          { idempotencyKey: crypto.randomUUID() },
        ),
      eventsStream: (
        sessionId: Id<"runtime-session">,
        options?: StreamOptions,
      ) => this.eventStream(sessionId, options),
    };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private query(options: ListOptions | undefined): string {
    if (options === undefined) return "";
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const search = params.toString();
    return search === "" ? "" : `?${search}`;
  }

  private buildHeaders(init: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: init.accept ?? "application/json",
      ...(init.headers ?? {}),
    };
    if (this.token !== undefined)
      headers["Authorization"] = `Bearer ${this.token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.idempotencyKey !== undefined)
      headers["Idempotency-Key"] = init.idempotencyKey;
    return headers;
  }

  private async request(path: string, init: RequestOptions): Promise<Response> {
    const headers = this.buildHeaders(init);
    const response = await this.fetchImpl(this.url(path), {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    });
    return response;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: "GET" });
    return this.parseJson<T>(response);
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    extra: { readonly idempotencyKey?: string } | undefined = undefined,
  ): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      body,
      ...(extra?.idempotencyKey !== undefined
        ? { idempotencyKey: extra.idempotencyKey }
        : {}),
    });
    return this.parseJson<T>(response);
  }

  private async delete(path: string): Promise<void> {
    const response = await this.request(path, { method: "DELETE" });
    if (!response.ok) throw await this.toError(response);
  }

  private async parseJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw await this.toError(response);
    return (await response.json()) as T;
  }

  private async toError(response: Response): Promise<TownApiError> {
    let code: string | null = null;
    let detail = `API returned ${response.status}`;
    let metadata: Record<string, string> | null = null;
    try {
      const body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null) {
        const obj = body as Record<string, unknown>;
        const codeValue = obj["code"];
        if (typeof codeValue === "string") code = codeValue;
        else {
          const errorValue = obj["error"];
          if (typeof errorValue === "string") code = errorValue;
        }
        const detailValue = obj["detail"];
        if (typeof detailValue === "string") detail = detailValue;
        const metadataValue = obj["metadata"];
        if (
          typeof metadataValue === "object" &&
          metadataValue !== null &&
          !Array.isArray(metadataValue)
        ) {
          metadata = metadataValue as Record<string, string>;
        }
      }
    } catch {
      // Non-JSON error body: keep the default detail.
    }
    return new TownApiError(response.status, code, detail, metadata);
  }

  private async *eventStream(
    sessionId: Id<"runtime-session">,
    options: StreamOptions | undefined,
  ): AsyncGenerator<ServerEvent> {
    const params = new URLSearchParams();
    if (options?.cursor !== undefined) params.set("cursor", options.cursor);
    if (options?.intervalMs !== undefined)
      params.set("intervalMs", String(options.intervalMs));
    if (options?.windowMs !== undefined)
      params.set("windowMs", String(options.windowMs));
    const search = params.toString();
    const path = `/v1/sessions/${sessionId}/events/stream${
      search === "" ? "" : `?${search}`
    }`;
    const response = await this.request(path, {
      method: "GET",
      accept: "text/event-stream",
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw await this.toError(response);
    if (response.body === null)
      throw new TownApiError(0, "NO_STREAM_BODY", "Event stream had no body.");
    yield* parseEventStream(response.body, options?.signal);
  }
}
