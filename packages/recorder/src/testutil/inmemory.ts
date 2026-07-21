/**
 * In-memory OTel harness for recorder tests. Wires trace/log/metric providers
 * to in-memory exporters and returns both the OtelHandles the recorder needs
 * and the exporters so tests can assert on what was emitted — no live SigNoz.
 */
import type { Meter } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
  PeriodicExportingMetricReader,
  MeterProvider,
} from "@opentelemetry/sdk-metrics";
import type { OtelHandles } from "../otel.js";

export interface InMemoryOtel {
  handles: OtelHandles;
  spans: InMemorySpanExporter;
  logsExporter: InMemoryLogRecordExporter;
  metricsExporter: InMemoryMetricExporter;
  meterProvider: MeterProvider;
}

export function createInMemoryOtel(): InMemoryOtel {
  // Read tracer/logger/meter straight off the provider instances (not the OTel
  // global registry) so each call is fully isolated — globals can only be set
  // once per process and would leak between tests.
  const spans = new InMemorySpanExporter();
  const traceProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spans)],
  });

  const logsExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logsExporter })],
  });

  const metricsExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: metricsExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ readers: [reader] });

  const meter: Meter = meterProvider.getMeter("test");
  const logger: Logger = loggerProvider.getLogger("test");

  const handles: OtelHandles = {
    tracer: traceProvider.getTracer("test"),
    logger,
    meter,
    async shutdown() {
      await Promise.allSettled([
        traceProvider.forceFlush(),
        loggerProvider.forceFlush(),
        meterProvider.forceFlush(),
      ]);
    },
  };

  return { handles, spans, logsExporter, metricsExporter, meterProvider };
}
