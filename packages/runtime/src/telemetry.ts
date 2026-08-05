import {
  trace,
  type Span,
  type SpanOptions,
  type Tracer,
} from "@opentelemetry/api";

const TRACER_NAME = "townai.runtime";

let cachedTracer: Tracer | undefined;

/**
 * Returns the runtime tracer. When no OTEL SDK is registered (i.e.
 * OTEL_EXPORTER_OTLP_ENDPOINT is unset), @opentelemetry/api returns a
 * no-op tracer and spans have zero overhead.
 */
export function getTracer(): Tracer {
  if (cachedTracer === undefined) cachedTracer = trace.getTracer(TRACER_NAME);
  return cachedTracer;
}

/**
 * Wraps an async function in an active span. Exceptions are recorded on
 * the span and re-thrown; the span is always ended.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as unknown as Error);
      span.setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Reset the cached tracer (for testing). */
export function resetTracer(): void {
  cachedTracer = undefined;
}
