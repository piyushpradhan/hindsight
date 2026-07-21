/**
 * OTel wiring for the recorder: trace + logs + metrics, all exported over
 * OTLP/HTTP to the local SigNoz collector. Kept deliberately small — one
 * provider per signal, batch processors for throughput, and an explicit
 * force-flush on shutdown so short-lived scripts actually ship their data.
 */
import { metrics, trace, type Tracer } from "@opentelemetry/api";
import { logs, type Logger } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const INSTRUMENTATION = "@hindsight/recorder";
const SERVICE_NAME = "hindsight-recorder";

export interface OtelHandles {
  tracer: Tracer;
  logger: Logger;
  meter: import("@opentelemetry/api").Meter;
  shutdown: () => Promise<void>;
}

export interface OtelInitOptions {
  /** Base OTLP/HTTP URL, e.g. http://localhost:4318 (no signal suffix). */
  otlpHttpUrl: string;
  serviceName?: string;
  /**
   * Register providers as the global tracer/logger/meter (default true). Set
   * false to run purely off the returned handles without touching globals —
   * used when embedding a recorder inside a process that already owns the
   * global OTel providers (e.g. the replay-engine's fork executor). The Run
   * passes span context explicitly, so no global context manager is required.
   */
  register?: boolean;
}

/**
 * Initialize the three OTel signal pipelines against a single OTLP/HTTP
 * endpoint. The signal-specific paths (/v1/traces, /v1/logs, /v1/metrics) are
 * appended per exporter, matching the collector's conventional routes.
 */
export function initOtel(opts: OtelInitOptions): OtelHandles {
  const base = opts.otlpHttpUrl.replace(/\/+$/, "");
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName ?? SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: "0.1.0",
  });

  const traceProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` })),
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }) }),
    ],
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
    exportIntervalMillis: 10_000,
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });

  const register = opts.register ?? true;
  if (register) {
    traceProvider.register();
    logs.setGlobalLoggerProvider(loggerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
  }

  return {
    // Off-global mode reads handles straight from the provider instances.
    tracer: register ? trace.getTracer(INSTRUMENTATION) : traceProvider.getTracer(INSTRUMENTATION),
    logger: register ? logs.getLogger(INSTRUMENTATION) : loggerProvider.getLogger(INSTRUMENTATION),
    meter: register ? metrics.getMeter(INSTRUMENTATION) : meterProvider.getMeter(INSTRUMENTATION),
    async shutdown() {
      // Force-flush before shutdown so nothing is left in a batch buffer.
      await Promise.allSettled([
        traceProvider.forceFlush(),
        loggerProvider.forceFlush(),
        meterProvider.forceFlush(),
      ]);
      await Promise.allSettled([
        traceProvider.shutdown(),
        loggerProvider.shutdown(),
        meterProvider.shutdown(),
      ]);
    },
  };
}
