import assert from "node:assert/strict";
import { test } from "node:test";
import { replayRun } from "./replay.js";
import { buildRunGraph } from "../rungraph/builder.js";
import {
  TRACE_ID,
  fixturePayloadLogs,
  fixtureSpans,
} from "../rungraph/builder.test-fixture.js";

test("complete replay returns recorded steps and has no live-call path", () => {
  const graph = buildRunGraph(TRACE_ID, fixtureSpans(), fixturePayloadLogs());
  assert.equal(graph.checkpoint?.complete, true);
  const replay = replayRun(graph);
  assert.equal(replay.liveCalls, 0);
  assert.deepEqual(replay.steps, graph.steps);
});

test("missing payload fails closed with the missing step", () => {
  const graph = buildRunGraph(TRACE_ID, fixtureSpans(), fixturePayloadLogs().slice(1));
  assert.equal(graph.checkpoint?.complete, false);
  assert.throws(() => replayRun(graph), /step 0 has no correlated payload log/);
});
