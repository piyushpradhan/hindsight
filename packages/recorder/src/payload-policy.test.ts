import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldRecordPayload,
  runIsSampled,
  SAMPLE_EVERY,
  protectPayload,
} from "./payload-policy.js";

test("always records every step", () => {
  assert.equal(shouldRecordPayload({ policy: "always", errored: false, runSampled: false }), true);
  assert.equal(shouldRecordPayload({ policy: "always", errored: true, runSampled: false }), true);
});

test("onError records only failed steps", () => {
  assert.equal(shouldRecordPayload({ policy: "onError", errored: false, runSampled: true }), false);
  assert.equal(shouldRecordPayload({ policy: "onError", errored: true, runSampled: false }), true);
});

test("sampled records only when the run is in the sampled cohort", () => {
  assert.equal(shouldRecordPayload({ policy: "sampled", errored: false, runSampled: false }), false);
  assert.equal(shouldRecordPayload({ policy: "sampled", errored: false, runSampled: true }), true);
  // errored steps still gated by run sampling under "sampled".
  assert.equal(shouldRecordPayload({ policy: "sampled", errored: true, runSampled: false }), false);
});

test("runIsSampled fires roughly 1 in SAMPLE_EVERY runs", () => {
  let hits = 0;
  for (let i = 0; i < SAMPLE_EVERY * 4; i++) if (runIsSampled(i)) hits++;
  assert.equal(hits, 4);
  assert.equal(runIsSampled(0), true);
  assert.equal(runIsSampled(1), false);
});

test("never records no steps", () => {
  assert.equal(shouldRecordPayload({ policy: "never", errored: true, runSampled: true }), false);
});

test("redacted payloads remove common secrets and are marked incomplete", () => {
  const payload = protectPayload(
    { headers: { authorization: "Bearer canary" }, value: "safe" },
    { mode: "redacted" },
  );
  assert.equal(
    (payload.body?.headers as Record<string, unknown>).authorization,
    "[REDACTED]",
  );
  assert.equal(JSON.stringify(payload.body).includes("canary"), false);
  assert.equal(payload.redacted, true);
  assert.equal(payload.complete, false);
});

test("oversize payloads retain a hash but no partial body", () => {
  const payload = protectPayload({ value: "too large" }, { mode: "full", maxBytes: 4 });
  assert.equal(payload.body, undefined);
  assert.equal(payload.truncated, true);
  assert.equal(payload.complete, false);
  assert.equal(payload.hash.length, 64);
});
