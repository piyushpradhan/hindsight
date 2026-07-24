/**
 * SigNoz query API adapter. EVERYTHING SigNoz-version-specific lives in this
 * file; the rest of the app only sees SpanRow / PayloadLogInput.
 *
 * Known shape coded against (SigNoz EE v0.133.0):
 *   POST {base}/api/v3/query_range
 *   { start, end, compositeQuery: { queryType: "builder", panelType: "list",
 *     builderQueries: { A: { dataSource, queryName, expression, disabled,
 *     limit, offset, pageSize, filters: { items, op }, selectColumns,
 *     orderBy } } } }
 *   -> { status, data: { result: [ { queryName, list: [ { timestamp, data } ] } ] } }
 *
 * Centralized uncertainty (patch HERE if a live instance disagrees):
 *   1. Built-in column names: traces use traceID/spanID/parentSpanID/
 *      durationNano; logs use trace_id/span_id/body. See COL below.
 *   2. Numeric attributes are stored by SigNoz as float64 (ClickHouse
 *      attributes_number map) — see ATTR_DATA_TYPE.
 *   3. "exists" filter op semantics and whether built-in columns need
 *      type: "tag" — see filterItem().
 *   4. Log body may surface as "body" or nested; see readLogBody().
 */
import {
  ATTR,
  EVENT_LOG_MARKER,
  GENAI_ATTR,
  PAYLOAD_LOG_MARKER,
  type RunEvent,
} from "@hindsight/shared";
import { parseEventLogBody, parsePayloadLogBody } from "../payload-shape.js";
import type { PayloadLogInput, SpanInput } from "../rungraph/builder.js";

/* ------------------------- version-specific knobs ------------------------- */

const COL = {
  traces: {
    traceId: "traceID",
    spanId: "spanID",
    parentSpanId: "parentSpanID",
    name: "name",
    serviceName: "serviceName",
    durationNano: "durationNano",
  },
  logs: {
    traceId: "trace_id",
    spanId: "span_id",
    body: "body",
  },
} as const;

type DataType = "string" | "float64" | "bool";

/** SigNoz stores all numeric attributes as float64. */
const ATTR_DATA_TYPE: Record<string, DataType> = {
  [ATTR.SCHEMA_VERSION]: "string",
  [ATTR.RECORDER_VERSION]: "string",
  [ATTR.RUN_ID]: "string",
  [ATTR.AGENT_ID]: "string",
  [ATTR.AGENT_REVISION]: "string",
  [ATTR.TASK_ID]: "string",
  [ATTR.RUN_STEP_COUNT]: "float64",
  [ATTR.RUN_TOKENS_TOTAL]: "float64",
  [ATTR.RUN_COST_USD]: "float64",
  [ATTR.RUN_DURATION_MS]: "float64",
  [ATTR.STEP_INDEX]: "float64",
  [ATTR.STEP_KIND]: "string",
  [ATTR.TOOL_NAME]: "string",
  [ATTR.TOOL_CALL_ID]: "string",
  [ATTR.EVENT_NAME]: "string",
  [ATTR.PAYLOAD_REF]: "string",
  [ATTR.PAYLOAD_COMPLETE]: "bool",
  [ATTR.PAYLOAD_CAPTURE_POLICY]: "string",
  [ATTR.ARGS_HASH]: "string",
  [ATTR.COST_USD]: "float64",
  [ATTR.PRICE_SOURCE]: "string",
  [ATTR.PRICE_VERSION]: "string",
  [ATTR.OUTCOME]: "string",
  [ATTR.FORK_OF]: "string",
  [ATTR.FORK_POINT]: "float64",
  [ATTR.FORK_MUTATION]: "string",
  [ATTR.FORK_MUTATION_HASH]: "string",
  [ATTR.INCIDENT_ID]: "string",
  [GENAI_ATTR.OPERATION_NAME]: "string",
  [GENAI_ATTR.PROVIDER_NAME]: "string",
  [GENAI_ATTR.SYSTEM]: "string",
  [GENAI_ATTR.REQUEST_MODEL]: "string",
  [GENAI_ATTR.RESPONSE_MODEL]: "string",
  [GENAI_ATTR.INPUT_TOKENS]: "float64",
  [GENAI_ATTR.OUTPUT_TOKENS]: "float64",
  [GENAI_ATTR.TEMPERATURE]: "float64",
  [GENAI_ATTR.MAX_TOKENS]: "float64",
  [GENAI_ATTR.ERROR_TYPE]: "string",
};

const TRACE_ATTRS = Object.keys(ATTR_DATA_TYPE);

/* --------------------------------- errors --------------------------------- */

export type SignozErrorKind = "auth" | "unavailable" | "bad_response";

export class SignozError extends Error {
  constructor(
    readonly kind: SignozErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SignozError";
  }
}

/* ------------------------------ wire shapes ------------------------------- */

interface FilterItem {
  key: { key: string; dataType: DataType; type: "tag" };
  op: string;
  value: unknown;
}

interface ListItem {
  timestamp?: unknown;
  data?: Record<string, unknown>;
}

interface QueryRangeResponse {
  status?: string;
  data?: {
    result?: Array<{ queryName?: string; list?: ListItem[] }>;
  };
}

export interface ListRunsOptions {
  agentId?: string;
  limit?: number;
  sinceMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE = 1000;

export class SignozClient {
  readonly authed: boolean;

  constructor(private readonly opts: { baseUrl: string; apiKey?: string }) {
    this.authed = !!opts.apiKey;
  }

  /** Low-level passthrough for debugging / future panels. */
  async queryRange(body: unknown): Promise<QueryRangeResponse> {
    if (!this.authed) {
      throw new SignozError("auth", "SIGNOZ_API_KEY not configured");
    }
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}/api/v3/query_range`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "SIGNOZ-API-KEY": this.opts.apiKey as string,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new SignozError("unavailable", `query_range fetch failed: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SignozError("auth", `query_range returned ${res.status}`, res.status);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SignozError("bad_response", `query_range ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    try {
      return (await res.json()) as QueryRangeResponse;
    } catch {
      throw new SignozError("bad_response", "query_range returned non-JSON", res.status);
    }
  }

  /** Root run spans, newest first (raw material for run lists). */
  async listRunSpans(options: ListRunsOptions = {}): Promise<SpanInput[]> {
    const limit = clampInt(options.limit, 1, MAX_PAGE, 200);
    const sinceMs = options.sinceMs ?? Date.now() - 7 * DAY_MS;
    const items: FilterItem[] = [existsFilter(ATTR.OUTCOME)];
    if (options.agentId) items.push(eqFilter(ATTR.AGENT_ID, options.agentId));
    const list = await this.runListQuery({
      dataSource: "traces",
      filters: items,
      selectColumns: traceSelectColumns(),
      limit,
      sinceMs,
    });
    return list.map(traceItemToSpan).filter((s): s is SpanInput => s !== null);
  }

  async getSpansForTrace(traceId: string): Promise<SpanInput[]> {
    const list = await this.runListQuery({
      dataSource: "traces",
      filters: [builtinEqFilter(COL.traces.traceId, traceId)],
      selectColumns: traceSelectColumns(),
      limit: MAX_PAGE,
      sinceMs: Date.now() - 30 * DAY_MS,
    });
    return list.map(traceItemToSpan).filter((s): s is SpanInput => s !== null);
  }

  /** Payload log records correlated to a trace (optionally one span). */
  async getPayloadLogs(traceId: string, spanId?: string): Promise<PayloadLogInput[]> {
    const items: FilterItem[] = [
      builtinEqFilter(COL.logs.traceId, traceId),
      containsFilter(COL.logs.body, PAYLOAD_LOG_MARKER),
    ];
    if (spanId) items.push(builtinEqFilter(COL.logs.spanId, spanId));
    const list = await this.runListQuery({
      dataSource: "logs",
      filters: items,
      selectColumns: [
        { key: COL.logs.traceId, dataType: "string", type: "tag" },
        { key: COL.logs.spanId, dataType: "string", type: "tag" },
        { key: COL.logs.body, dataType: "string", type: "tag" },
      ],
      limit: MAX_PAGE,
      sinceMs: Date.now() - 30 * DAY_MS,
    });
    const out: PayloadLogInput[] = [];
    for (const item of list) {
      const rec = parsePayloadLogBody(readLogBody(item));
      if (!rec) continue;
      const data = item.data ?? {};
      out.push({
        ...rec,
        traceId: str(data[COL.logs.traceId]) ?? traceId,
        spanId: str(data[COL.logs.spanId]),
        timestamp: toIso(item.timestamp),
      });
    }
    return out;
  }

  async getRunEvents(traceId: string): Promise<RunEvent[]> {
    const list = await this.runListQuery({
      dataSource: "logs",
      filters: [
        builtinEqFilter(COL.logs.traceId, traceId),
        containsFilter(COL.logs.body, EVENT_LOG_MARKER),
      ],
      selectColumns: [
        { key: COL.logs.traceId, dataType: "string", type: "tag" },
        { key: COL.logs.body, dataType: "string", type: "tag" },
      ],
      limit: MAX_PAGE,
      sinceMs: Date.now() - 30 * DAY_MS,
    });
    return list.flatMap((item) => {
      const event = parseEventLogBody(readLogBody(item));
      return event ? [{ ...event, timestamp: toIso(item.timestamp) }] : [];
    });
  }

  /* ------------------------------ internals ------------------------------ */

  private async runListQuery(q: {
    dataSource: "traces" | "logs";
    filters: FilterItem[];
    selectColumns: Array<{ key: string; dataType: DataType; type: "tag" }>;
    limit: number;
    sinceMs: number;
  }): Promise<ListItem[]> {
    const body = {
      start: q.sinceMs,
      end: Date.now(),
      step: 60,
      compositeQuery: {
        queryType: "builder",
        panelType: "list",
        builderQueries: {
          A: {
            dataSource: q.dataSource,
            queryName: "A",
            expression: "A",
            disabled: false,
            // v0.133 builder validates these even for a list ("noop") panel:
            // an empty/absent aggregateOperator is rejected with a 400.
            aggregateOperator: "noop",
            aggregateAttribute: {},
            functions: [],
            having: [],
            groupBy: [],
            reduceTo: "avg",
            stepInterval: 60,
            limit: q.limit,
            offset: 0,
            pageSize: q.limit,
            filters: { items: q.filters, op: "AND" },
            selectColumns: q.selectColumns,
            orderBy: [{ columnName: "timestamp", order: "desc" }],
          },
        },
      },
    };
    const res = await this.queryRange(body);
    const result = res.data?.result ?? [];
    return result.find((r) => r.queryName === "A")?.list ?? result[0]?.list ?? [];
  }
}

/* ---------------------------- row conversion ------------------------------ */

function traceSelectColumns(): Array<{ key: string; dataType: DataType; type: "tag" }> {
  return [
    { key: COL.traces.traceId, dataType: "string", type: "tag" },
    { key: COL.traces.spanId, dataType: "string", type: "tag" },
    { key: COL.traces.parentSpanId, dataType: "string", type: "tag" },
    { key: COL.traces.name, dataType: "string", type: "tag" },
    { key: COL.traces.serviceName, dataType: "string", type: "tag" },
    { key: COL.traces.durationNano, dataType: "float64", type: "tag" },
    ...TRACE_ATTRS.map((key) => ({ key, dataType: ATTR_DATA_TYPE[key], type: "tag" as const })),
  ];
}

function traceItemToSpan(item: ListItem): SpanInput | null {
  const data = item.data ?? {};
  const traceId = str(data[COL.traces.traceId]);
  const spanId = str(data[COL.traces.spanId]);
  if (!traceId || !spanId) return null;
  const attributes: Record<string, string | number | boolean> = {};
  for (const key of TRACE_ATTRS) {
    const v = data[key];
    if (v === undefined || v === null || v === "") continue;
    if (ATTR_DATA_TYPE[key] === "float64") {
      const n = Number(v);
      if (!Number.isNaN(n)) attributes[key] = n;
    } else if (ATTR_DATA_TYPE[key] === "bool") {
      attributes[key] = v === true || v === "true";
    } else {
      attributes[key] = String(v);
    }
  }
  return {
    traceId,
    spanId,
    parentSpanId: str(data[COL.traces.parentSpanId]) || undefined,
    name: str(data[COL.traces.name]) ?? "",
    serviceName: str(data[COL.traces.serviceName]),
    startTime: toIso(item.timestamp ?? data.timestamp),
    durationNano: Number(data[COL.traces.durationNano] ?? 0) || 0,
    attributes,
  };
}

/** Body column naming is a live-instance guess; fallbacks centralized here. */
function readLogBody(item: ListItem): unknown {
  const data = item.data ?? {};
  return data[COL.logs.body] ?? data["attributes_string.body"] ?? data["resources_string.body"];
}

/* -------------------------------- helpers --------------------------------- */

function eqFilter(key: string, value: string): FilterItem {
  return { key: { key, dataType: ATTR_DATA_TYPE[key] ?? "string", type: "tag" }, op: "=", value };
}

function builtinEqFilter(key: string, value: string): FilterItem {
  return { key: { key, dataType: "string", type: "tag" }, op: "=", value };
}

function existsFilter(key: string): FilterItem {
  return { key: { key, dataType: ATTR_DATA_TYPE[key] ?? "string", type: "tag" }, op: "exists", value: "" };
}

function containsFilter(key: string, value: string): FilterItem {
  return { key: { key, dataType: "string", type: "tag" }, op: "contains", value };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v === undefined || Number.isNaN(v)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** SigNoz list timestamps are RFC3339 strings; tolerate epoch s/ms/ns too. */
function toIso(v: unknown): string {
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    const n = Number(v);
    if (!Number.isNaN(n)) return toIso(n);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e17 ? v / 1e6 : v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}
