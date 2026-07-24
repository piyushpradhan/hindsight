import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { IncidentStore } from "../incidents/store.js";
import { handleSignozWebhook } from "./signoz.js";

const TRACE = "11111111111111111111111111111111";
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;

test("firing SigNoz webhook opens one trace incident and deduplicates retries", () => {
  const store = new IncidentStore(":memory:");
  const payload = fixture("signoz-v0.133-firing.json");
  const first = handleSignozWebhook(payload, store);
  const second = handleSignozWebhook(payload, store);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].failureCondition, "MalformedToolJsonError");
  assert.equal(store.list()[0].runId, "run-fixture");
  assert.equal(store.list()[0].source, "signoz");
  store.close();
});

test("aggregate metric alert is accepted but does not invent a trace incident", () => {
  const store = new IncidentStore(":memory:");
  const result = handleSignozWebhook(
    {
      alerts: [
        {
          labels: {
            alertname: "Hindsight: fleet cost spike",
            "hindsight.agent.id": "research",
          },
          annotations: {},
        },
      ],
    },
    store,
  );
  assert.deepEqual(result, { ok: true, incidents: [], created: [], ignored: 1 });
  assert.equal(store.list().length, 0);
  store.close();
});

test("resolved alert never closes an incident without fork verification", () => {
  const store = new IncidentStore(":memory:");
  handleSignozWebhook(fixture("signoz-v0.133-firing.json"), store);
  handleSignozWebhook(fixture("signoz-v0.133-resolved.json"), store);
  assert.equal(store.list()[0].status, "open");
  store.close();
});
