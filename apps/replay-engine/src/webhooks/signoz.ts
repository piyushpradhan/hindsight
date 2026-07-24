import { createHash } from "node:crypto";
import type { Incident } from "@hindsight/shared";
import type { IncidentStore } from "../incidents/store.js";

const TRACE_ID_RE = /^[0-9a-f]{32}$/i;

interface AlertLike {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  fingerprint?: string;
  status: string;
}

export type WebhookOutcome =
  | { ok: true; incidents: Incident[]; created: Incident[]; ignored: number }
  | { ok: false };

export function handleSignozWebhook(
  payload: unknown,
  store: IncidentStore,
): WebhookOutcome {
  const alerts = extractAlerts(payload);
  if (!alerts?.length) return { ok: false };
  const incidents: Incident[] = [];
  const created: Incident[] = [];
  let ignored = 0;
  for (const alert of alerts) {
    if (alert.status === "resolved") {
      // Alertmanager recovery does not prove an agent fork fixed the run.
      ignored++;
      continue;
    }
    const traceId = findTraceId(alert);
    if (!traceId) {
      // Fleet metric alerts are valid notifications, but cannot open a run incident.
      ignored++;
      continue;
    }
    const alertFingerprint = alert.fingerprint ?? fingerprint(alert, traceId);
    const existed = store.getByAlert(alertFingerprint, traceId);
    const incident = store.createOrGet({
        traceId,
        runId: findRunId(alert),
        source: "signoz",
        agentId: findAgentId(alert) ?? "unknown",
        alertName: findAlertName(alert),
        severity: alert.labels.severity,
        alertFingerprint,
        failureCondition: findFailureCondition(alert),
      });
    incidents.push(incident);
    if (!existed) created.push(incident);
  }
  return { ok: true, incidents, created, ignored };
}

function extractAlerts(payload: unknown): AlertLike[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const rootStatus = typeof root.status === "string" ? root.status : "firing";
  if (Array.isArray(root.alerts)) {
    const alerts = root.alerts
      .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
      .map((value) => ({
        labels: strMap(value.labels),
        annotations: strMap(value.annotations),
        fingerprint: string(value.fingerprint),
        status: string(value.status) ?? rootStatus,
      }))
      .filter(
        (alert) =>
          Object.keys(alert.labels).length > 0 ||
          Object.keys(alert.annotations).length > 0,
      );
    return alerts.length ? alerts : null;
  }
  const labels = strMap(root.labels);
  const annotations = strMap(root.annotations);
  if (Object.keys(labels).length || Object.keys(annotations).length) {
    return [
      {
        labels,
        annotations,
        fingerprint: string(root.fingerprint),
        status: rootStatus,
      },
    ];
  }
  return null;
}

function findAlertName(alert: AlertLike): string {
  return (
    alert.labels.alertname ??
    alert.annotations.title ??
    alert.annotations.summary ??
    "unknown_alert"
  );
}

function findAgentId(alert: AlertLike): string | undefined {
  return (
    alert.labels["hindsight.agent.id"] ??
    alert.labels.agent_id ??
    alert.labels.agentId ??
    alert.annotations["hindsight.agent.id"]
  );
}

function findTraceId(alert: AlertLike): string | undefined {
  for (const key of [
    "trace_id",
    "traceId",
    "traceID",
    "hindsight.trace.id",
  ]) {
    const value = alert.labels[key] ?? alert.annotations[key];
    if (value && TRACE_ID_RE.test(value)) return value.toLowerCase();
  }
  for (const source of [alert.labels, alert.annotations]) {
    for (const value of Object.values(source)) {
      const match = value.match(/[0-9a-f]{32}/i)?.[0];
      if (match) return match.toLowerCase();
    }
  }
  return undefined;
}

function findRunId(alert: AlertLike): string | undefined {
  return (
    alert.labels["hindsight.run.id"] ??
    alert.labels.run_id ??
    alert.annotations["hindsight.run.id"]
  );
}

function findFailureCondition(alert: AlertLike): string {
  return (
    alert.labels["error.type"] ??
    alert.labels.failure_condition ??
    alert.labels.trigger ??
    alert.annotations.failure_condition ??
    alert.annotations.summary ??
    findAlertName(alert)
  );
}

function fingerprint(alert: AlertLike, traceId: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        traceId,
        alertName: findAlertName(alert),
        labels: sorted(alert.labels),
      }),
    )
    .digest("hex");
}

function sorted(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function strMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") result[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") result[key] = String(item);
  }
  return result;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
