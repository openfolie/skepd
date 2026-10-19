import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";

let provider: NodeTracerProvider | null = null;

export function initTracing(): void {
  if (provider) return;
  provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  provider.register();
}

// Auto-initialize so importing the module is sufficient.
initTracing();

export const tracer: Tracer = trace.getTracer("skepd");

export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown> = {},
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs as any }, async (span) => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error)?.message });
      throw e;
    } finally {
      span.end();
    }
  });
}

export function getTraceId(): string | null {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();
  if (!ctx) return null;
  return ctx.traceId ?? null;
}

export function shutdownTracing(): void {
  provider?.shutdown().catch(() => {});
  provider = null;
}
