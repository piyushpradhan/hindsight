import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
type ResourceKind = "channel" | "rule" | "dashboard";

export interface ExistingResources {
  channels: Set<string>;
  rules: Map<string, { id: string; preferredChannels?: string[] }>;
  dashboards: Set<string>;
}

export interface DesiredResource {
  kind: Exclude<ResourceKind, "channel">;
  name: string;
  endpoint: "/api/v2/rules" | "/api/v1/dashboards";
  payload: Json;
}

export interface ProvisionAction {
  operation: "create" | "update";
  kind: ResourceKind;
  name: string;
  endpoint:
    | "/api/v1/channels"
    | "/api/v2/rules"
    | `/api/v2/rules/${string}`
    | "/api/v1/dashboards";
  payload?: Json;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channelName = "hindsight-replay-engine";

export function buildPlan(
  existing: ExistingResources,
  desired: DesiredResource[],
): ProvisionAction[] {
  const actions: ProvisionAction[] = [];
  if (!existing.channels.has(channelName)) {
    actions.push({
      operation: "create",
      kind: "channel",
      name: channelName,
      endpoint: "/api/v1/channels",
    });
  }
  for (const resource of desired) {
    if (resource.kind === "dashboard") {
      if (!existing.dashboards.has(resource.name)) {
        actions.push({ operation: "create", ...resource });
      }
      continue;
    }

    const installed = existing.rules.get(resource.name);
    if (!installed) {
      actions.push({ operation: "create", ...resource });
      continue;
    }
    const desiredChannels = stringArray(resource.payload.preferredChannels);
    if (
      desiredChannels &&
      !sameStrings(desiredChannels, installed.preferredChannels ?? [])
    ) {
      actions.push({
        operation: "update",
        ...resource,
        endpoint: `/api/v2/rules/${encodeURIComponent(installed.id)}`,
      });
    }
  }
  return actions;
}

export function parseExistingResources(
  channelsResponse: unknown,
  rulesResponse: unknown,
  dashboardsResponse: unknown,
): ExistingResources {
  return {
    channels: new Set(listData(channelsResponse, "/api/v1/channels").map((item) => text(item.name))),
    rules: new Map(
      listData(rulesResponse, "/api/v2/rules").map((item) => [
        text(item.alert),
        {
          id: text(item.id),
          preferredChannels: stringArray(item.preferredChannels),
        },
      ]),
    ),
    dashboards: new Set(
      listData(dashboardsResponse, "/api/v1/dashboards").map((item) =>
        text(object(item.data, "dashboard.data").title),
      ),
    ),
  };
}

export function transformDashboardTemplate(template: Json): Json {
  const payload = structuredClone(template);
  delete payload["//"];
  delete payload.hindsightInstallStatus;
  return payload;
}

export function transformAlertTemplate(template: Json): Json {
  const payload = structuredClone(template);
  delete payload["//"];
  delete payload.hindsightInstallStatus;
  if (payload.ruleType !== "anomaly_rule") return payload;

  const condition = object(payload.condition, "condition");
  const composite = object(condition.compositeQuery, "condition.compositeQuery");
  const selected = text(condition.selectedQueryName);
  const zScore = number(condition.z_score_threshold, "condition.z_score_threshold");
  const builderQueries = object(composite.builderQueries, "builderQueries");
  const formulas = array(composite.queryFormulas, "queryFormulas");
  const queries: Json[] = [];

  for (const name of Object.keys(builderQueries).sort()) {
    const legacy = object(builderQueries[name], `builderQueries.${name}`);
    const aggregate = object(legacy.aggregateAttribute, `${name}.aggregateAttribute`);
    const filter = object(legacy.filters, `${name}.filters`);
    const filterItems = array(filter.items, `${name}.filters.items`);
    if (filterItems.length) {
      throw new Error(`${name}: legacy non-empty filters are not supported`);
    }

    const timeAggregation = text(legacy.timeAggregation);
    const spec: Json = {
      name,
      signal: "metrics",
      stepInterval: 60,
      aggregations: [
        {
          metricName: text(aggregate.key),
          timeAggregation: percentile(timeAggregation) ? "avg" : timeAggregation,
          spaceAggregation: text(legacy.spaceAggregation),
        },
      ],
      filter: { expression: "" },
      groupBy: array(legacy.groupBy, `${name}.groupBy`).map((value) => {
        const group = object(value, `${name}.groupBy[]`);
        return {
          name: text(group.key),
          fieldContext: group.type === "resource" ? "resource" : "attribute",
          fieldDataType: text(group.dataType),
        };
      }),
      disabled: legacy.disabled === true,
      limit: legacy.disabled === true ? 10_000 : 100,
      order: [{ key: { name: "__result" }, direction: "desc" }],
      legend: text(legacy.legend),
    };
    if (name === selected) spec.functions = anomalyFunction(zScore);
    queries.push({ type: "builder_query", spec });
  }

  for (const value of formulas) {
    const formula = object(value, "queryFormulas[]");
    const name = text(formula.queryName);
    const spec: Json = {
      name,
      expression: text(formula.expression),
      disabled: formula.disabled === true,
      limit: 100,
      order: [{ key: { name: "__result" }, direction: "desc" }],
      legend: text(formula.legend),
    };
    if (name === selected) spec.functions = anomalyFunction(zScore);
    queries.push({ type: "builder_formula", spec });
  }

  if (!queries.some((query) => object(query.spec, "query.spec").name === selected)) {
    throw new Error(`selected query ${selected} does not exist`);
  }

  condition.compositeQuery = {
    queryType: text(composite.queryType),
    panelType: text(composite.panelType),
    queries,
  };
  delete condition.z_score_threshold;
  payload.version = "v5";
  payload.preferredChannels = [channelName];
  return payload;
}

export function channelPayload(webhookUrl: string, secret: string): Json {
  const url = new URL(webhookUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("SIGNOZ_WEBHOOK_URL must use http or https");
  }
  if (!secret.trim()) throw new Error("SIGNOZ_WEBHOOK_SECRET is required to create the channel");
  return {
    name: channelName,
    webhook_configs: [
      {
        send_resolved: true,
        url: url.toString(),
        http_config: {
          authorization: { type: "Bearer", credentials: secret },
        },
      },
    ],
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
  const apply = args.delete("--apply");
  const dryRun = args.delete("--dry-run");
  if (args.size || (apply && dryRun)) {
    throw new Error("usage: pnpm provision:signoz [--apply|--dry-run]");
  }

  const baseUrl = (process.env.SIGNOZ_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const apiKey = process.env.SIGNOZ_API_KEY?.trim();
  if (!apiKey) throw new Error("SIGNOZ_API_KEY is required");

  const client = new SigNozClient(baseUrl, apiKey);
  const [channels, rules, dashboards, desired] = await Promise.all([
    client.get("/api/v1/channels"),
    client.get("/api/v2/rules"),
    client.get("/api/v1/dashboards"),
    loadDesiredResources(),
  ]);
  const existing = parseExistingResources(channels, rules, dashboards);
  const actions = buildPlan(existing, desired);
  const mode = apply ? "apply" : "dry-run";

  if (!actions.length) {
    console.log(`SigNoz provisioning (${mode}): all 7 resources already installed.`);
    return;
  }

  console.log(`SigNoz provisioning (${mode}): ${actions.length} change(s) pending.`);
  for (const action of actions) {
    console.log(`- ${action.operation} ${action.kind}: ${action.name}`);
  }
  if (!apply) return;

  const failures: string[] = [];
  for (const action of actions) {
    try {
      const payload =
        action.kind === "channel"
          ? channelPayload(
              process.env.SIGNOZ_WEBHOOK_URL ??
                "http://host.docker.internal:4123/hooks/signoz",
              process.env.SIGNOZ_WEBHOOK_SECRET ?? "",
            )
          : action.payload;
      if (action.operation === "update") {
        await client.put(action.endpoint, payload as Json);
      } else {
        await client.post(action.endpoint, payload as Json);
      }
      console.log(`✓ ${action.operation}d ${action.kind}: ${action.name}`);
    } catch (error) {
      failures.push(
        `${action.operation} ${action.kind} ${action.name}: ${
          error instanceof Error ? error.message : "failed"
        }`,
      );
    }
  }
  if (failures.length) {
    throw new Error(`SigNoz provisioning failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
}

class SigNozClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  get(endpoint: string): Promise<unknown> {
    return this.request("GET", endpoint);
  }

  post(endpoint: string, payload: Json): Promise<unknown> {
    return this.request("POST", endpoint, payload);
  }

  put(endpoint: string, payload: Json): Promise<unknown> {
    return this.request("PUT", endpoint, payload);
  }

  private async request(method: string, endpoint: string, payload?: Json): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          "SIGNOZ-API-KEY": this.apiKey,
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(`SigNoz ${method} ${endpoint} was unreachable`);
    }
    if (!response.ok) {
      throw new Error(`SigNoz ${method} ${endpoint} failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("json") ? response.json() : undefined;
  }
}

async function loadDesiredResources(): Promise<DesiredResource[]> {
  const alertFiles = [
    "cost-spike.json",
    "latency-drift.json",
    "loop-tripwire.json",
    "run-failures.json",
  ];
  const dashboardFiles = ["agent-reliability.json", "hindsight-ops.json"];
  const alerts = await Promise.all(
    alertFiles.map(async (file) => {
      const payload = transformAlertTemplate(await readJson(join(root, "infra/alerts", file)));
      return {
        kind: "rule" as const,
        name: text(payload.alert),
        endpoint: "/api/v2/rules" as const,
        payload,
      };
    }),
  );
  const dashboards = await Promise.all(
    dashboardFiles.map(async (file) => {
      const payload = transformDashboardTemplate(
        await readJson(join(root, "infra/dashboards", file)),
      );
      return {
        kind: "dashboard" as const,
        name: text(payload.title),
        endpoint: "/api/v1/dashboards" as const,
        payload,
      };
    }),
  );
  return [...alerts, ...dashboards];
}

async function readJson(file: string): Promise<Json> {
  return object(JSON.parse(await readFile(file, "utf8")), file);
}

function anomalyFunction(zScore: number): Json[] {
  return [{ name: "anomaly", args: [{ name: "z_score_threshold", value: zScore }] }];
}

function percentile(value: string): boolean {
  return /^p(?:50|75|90|95|99)$/.test(value);
}

function listData(value: unknown, endpoint: string): Json[] {
  const data = object(value, endpoint).data;
  return array(data, `${endpoint}.data`).map((item) => object(item, `${endpoint}.data[]`));
}

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Json;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("expected a non-empty string");
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(text);
}

function sameStrings(left: string[], right: string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "SigNoz provisioning failed");
    process.exitCode = 1;
  });
}
