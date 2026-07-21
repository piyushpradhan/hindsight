/**
 * SigNoz alert webhook receiver. SigNoz (Alertmanager-style) POSTs variants of:
 *   { status, alerts: [ { labels, annotations, startsAt, ... } ], ... }
 * but test hooks / channel previews may send a single { labels, annotations }
 * or even a bare labels map. We tolerate all three.
 *
 * Field extraction heuristics (documented per spec):
 *   - alert name: labels.alertname, else annotations.title/summary
 *   - severity:   labels.severity
 *   - agent id:   any label/annotation key matching /agent/i
 *                 (covers hindsight.agent.id, agent_id, agentId, ...)
 *   - trace id:   first 32-char hex value found across labels, then
 *                 annotations, then the entire serialized payload
 * Anything we cannot make sense of -> 400 with the body echoed for debugging.
 */
import type { Incident } from "@hindsight/shared";
import type { IncidentStore } from "../incidents/store.js";

const TRACE_ID_RE = /[0-9a-f]{32}/i;

interface AlertLike {
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export type WebhookOutcome =
  | { ok: true; incidents: Incident[] }
  | { ok: false };

export function handleSignozWebhook(payload: unknown, store: IncidentStore): WebhookOutcome {
  const alerts = extractAlerts(payload);
  if (!alerts || alerts.length === 0) return { ok: false };
  const incidents: Incident[] = [];
  for (const alert of alerts) {
    const traceId = findTraceId(alert, payload);
    if (!traceId) return { ok: false }; // an alert without a run anchor is noise to us
    incidents.push(
      store.create({
        traceId,
        agentId: findAgentId(alert) ?? "unknown",
        alertName: findAlertName(alert),
        severity: alert.labels.severity,
      }),
    );
  }
  return { ok: true, incidents };
}

function extractAlerts(payload: unknown): AlertLike[] | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.alerts)) {
    const alerts = p.alerts
      .map((a) => ({
        labels: strMap((a as Record<string, unknown>)?.labels),
        annotations: strMap((a as Record<string, unknown>)?.annotations),
      }))
      .filter((a) => Object.keys(a.labels).length > 0 || Object.keys(a.annotations).length > 0);
    return alerts.length > 0 ? alerts : null;
  }
  const labels = strMap(p.labels);
  const annotations = strMap(p.annotations);
  if (Object.keys(labels).length > 0 || Object.keys(annotations).length > 0) {
    return [{ labels, annotations }];
  }
  if (typeof p.alertname === "string") {
    return [{ labels: strMap(payload) ?? {}, annotations: {} }];
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
  for (const source of [alert.labels, alert.annotations]) {
    for (const [key, value] of Object.entries(source)) {
      if (/agent/i.test(key) && value) return value;
    }
  }
  return undefined;
}

function findTraceId(alert: AlertLike, wholePayload: unknown): string | undefined {
  for (const source of [alert.labels, alert.annotations]) {
    for (const value of Object.values(source)) {
      const match = TRACE_ID_RE.exec(value);
      if (match) return match[0].toLowerCase();
    }
  }
  const match = TRACE_ID_RE.exec(JSON.stringify(wholePayload));
  return match ? match[0].toLowerCase() : undefined;
}

function strMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}
