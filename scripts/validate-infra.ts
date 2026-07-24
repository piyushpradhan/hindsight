import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ATTR,
  EVENT_LOG_MARKER,
  METRIC,
  PAYLOAD_LOG_MARKER,
} from "../packages/shared/src/telemetry.ts";

const known = new Set<string>([
  ...Object.values(ATTR),
  ...Object.values(METRIC),
  EVENT_LOG_MARKER,
  PAYLOAD_LOG_MARKER,
]);
const unknown = new Map<string, string[]>();
const invalid: string[] = [];

for (const file of jsonFiles("infra")) {
  const text = readFileSync(file, "utf8");
  const value = JSON.parse(text) as Record<string, unknown>;
  if (value.hindsightInstallStatus !== "template_uninstalled") {
    invalid.push(`${file}: missing template_uninstalled status`);
  }
  if (value.alertType === "LOGS_BASED_ALERT") validateIncidentRule(file, value);
  if (value.alertType === "METRIC_BASED_ALERT") {
    if (
      !Array.isArray(value.preferredChannels) ||
      value.preferredChannels.length !== 0
    ) {
      invalid.push(`${file}: aggregate metric alerts must not use the incident webhook`);
    }
  }
  for (const name of text.match(/\bhindsight(?:\.[a-z_][a-z0-9_]*)+/g) ?? []) {
    if (known.has(name)) continue;
    const files = unknown.get(name) ?? [];
    files.push(file);
    unknown.set(name, files);
  }
}

if (unknown.size || invalid.length) {
  for (const [name, files] of unknown) {
    console.error(`${name}: ${[...new Set(files)].join(", ")}`);
  }
  for (const error of invalid) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`infra telemetry contract is valid (${known.size} known names)`);
}

function validateIncidentRule(file: string, rule: Record<string, unknown>): void {
  if (rule.version !== "v5" || rule.schemaVersion !== "v2alpha1") {
    invalid.push(`${file}: expected SigNoz v5/v2alpha1 rule schema`);
  }
  const text = JSON.stringify(rule);
  if (!text.includes('"trace_id"')) {
    invalid.push(`${file}: run-specific alert must group by trace_id`);
  }
  if (!text.includes('"hindsight-replay-engine"')) {
    invalid.push(`${file}: run-specific alert has no incident webhook channel`);
  }
}

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.name.endsWith(".json") ? [path] : [];
  });
}
