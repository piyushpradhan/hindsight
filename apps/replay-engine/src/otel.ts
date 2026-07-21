/**
 * Minimal manual self-instrumentation (no NodeSDK/auto-instrumentations):
 * one TracerProvider + OTLP HTTP exporter, and Fastify hooks that wrap every
 * API/hook request in a span. Dogfooding: the replay engine's own traces flow
 * into the same SigNoz it reads from.
 */
import { SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface Telemetry {
  tracer: Tracer;
  shutdown: () => Promise<void>;
}

const spans = new WeakMap<FastifyRequest, Span>();

export function initTelemetry(opts: { serviceName: string; endpoint: string }): Telemetry {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: opts.serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${opts.endpoint}/v1/traces` })),
    ],
  });
  provider.register();
  return {
    tracer: trace.getTracer(opts.serviceName),
    shutdown: () => provider.shutdown(),
  };
}

export function registerTraceHooks(app: FastifyInstance, telemetry: Telemetry): void {
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api") && !request.url.startsWith("/hooks")) return;
    const route = request.routeOptions?.url ?? request.url;
    const span = telemetry.tracer.startSpan(`${request.method} ${route}`, {
      attributes: {
        "http.request.method": request.method,
        "http.route": route,
      },
    });
    spans.set(request, span);
  });

  app.addHook("onResponse", async (request, reply: FastifyReply) => {
    const span = spans.get(request);
    if (!span) return;
    span.setAttribute("http.response.status_code", reply.statusCode);
    if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    spans.delete(request);
  });

  app.addHook("onError", async (request, _reply, error) => {
    const span = spans.get(request);
    if (!span) return;
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  });
}
