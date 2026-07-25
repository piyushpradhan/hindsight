import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildPlan,
  channelPayload,
  parseExistingResources,
  transformAlertTemplate,
  transformDashboardTemplate,
} from "./provision-signoz.ts";

test("transforms legacy anomaly templates into SigNoz v5 query envelopes", async () => {
  const template = JSON.parse(
    await readFile("infra/alerts/cost-spike.json", "utf8"),
  );
  const payload = transformAlertTemplate(template);
  const condition = payload.condition as Record<string, any>;
  const queries = condition.compositeQuery.queries as Array<Record<string, any>>;

  assert.equal(payload.version, "v5");
  assert.equal(payload.hindsightInstallStatus, undefined);
  assert.deepEqual(payload.preferredChannels, ["hindsight-replay-engine"]);
  assert.equal(condition.z_score_threshold, undefined);
  assert.deepEqual(
    queries.map((query) => [query.type, query.spec.name]),
    [
      ["builder_query", "A"],
      ["builder_query", "B"],
      ["builder_formula", "F1"],
    ],
  );
  assert.deepEqual(queries[2].spec.functions, [
    { name: "anomaly", args: [{ name: "z_score_threshold", value: 3 }] },
  ]);
  assert.equal(queries[0].spec.limit, 10_000);
  assert.equal(queries[2].spec.limit, 100);
});

test("maps legacy percentile time aggregation to a valid v5 histogram query", async () => {
  const template = JSON.parse(
    await readFile("infra/alerts/latency-drift.json", "utf8"),
  );
  const payload = transformAlertTemplate(template);
  const condition = payload.condition as Record<string, any>;
  const aggregation = condition.compositeQuery.queries[0].spec.aggregations[0];

  assert.deepEqual(aggregation, {
    metricName: "hindsight.step.duration",
    timeAggregation: "avg",
    spaceAggregation: "p95",
  });
  assert.equal(condition.compositeQuery.queries[0].spec.groupBy[0].fieldContext, "attribute");
});

test("idempotency plan uses exact list response names and nested dashboard titles", () => {
  const existing = parseExistingResources(
    { data: [{ name: "hindsight-replay-engine", data: "never inspect this" }] },
    { data: [{ id: "rule-a-id", alert: "rule-a" }] },
    { data: [{ id: "dashboard-id", data: { title: "dashboard-a" } }] },
  );
  const desired = [
    { kind: "rule" as const, name: "rule-a", endpoint: "/api/v2/rules" as const, payload: {} },
    { kind: "rule" as const, name: "rule-b", endpoint: "/api/v2/rules" as const, payload: {} },
    {
      kind: "dashboard" as const,
      name: "dashboard-a",
      endpoint: "/api/v1/dashboards" as const,
      payload: {},
    },
  ];

  assert.deepEqual(buildPlan(existing, desired).map(({ kind, name }) => [kind, name]), [
    ["rule", "rule-b"],
  ]);
  existing.rules.set("rule-b", { id: "rule-b-id" });
  assert.deepEqual(buildPlan(existing, desired), []);
});

test("idempotency updates an existing rule when preferredChannels drift", () => {
  const existing = parseExistingResources(
    { data: [{ name: "hindsight-replay-engine" }] },
    {
      data: [
        {
          id: "rule-id",
          alert: "fleet-only",
          preferredChannels: ["hindsight-replay-engine"],
        },
      ],
    },
    { data: [] },
  );
  const actions = buildPlan(existing, [
    {
      kind: "rule",
      name: "fleet-only",
      endpoint: "/api/v2/rules",
      payload: { preferredChannels: [] },
    },
  ]);

  assert.deepEqual(actions, [
    {
      operation: "update",
      kind: "rule",
      name: "fleet-only",
      endpoint: "/api/v2/rules/rule-id",
      payload: { preferredChannels: [] },
    },
  ]);
});

test("trace-correlated templates retain their Hindsight threshold channel", async () => {
  const template = JSON.parse(
    await readFile("infra/alerts/run-failures.json", "utf8"),
  );
  const payload = transformAlertTemplate(template);
  const condition = payload.condition as Record<string, any>;

  assert.deepEqual(condition.thresholds.spec[0].channels, [
    "hindsight-replay-engine",
  ]);
  assert.equal(payload.preferredChannels, undefined);
});

test("dashboard create payload removes template-only installation metadata", () => {
  assert.deepEqual(
    transformDashboardTemplate({
      "//": "UNINSTALLED TEMPLATE",
      hindsightInstallStatus: "template_uninstalled",
      title: "Hindsight :: Ops",
    }),
    { title: "Hindsight :: Ops" },
  );
});

test("channel payload uses bearer auth without logging or embedding the secret in names", () => {
  const payload = channelPayload("http://example.test/hooks/signoz", "top-secret");
  const config = (payload.webhook_configs as Array<Record<string, any>>)[0];

  assert.equal(payload.name, "hindsight-replay-engine");
  assert.deepEqual(config.http_config, {
    authorization: { type: "Bearer", credentials: "top-secret" },
  });
  assert.equal(JSON.stringify({ name: payload.name }), '{"name":"hindsight-replay-engine"}');
});
