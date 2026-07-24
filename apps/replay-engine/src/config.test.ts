import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

test("runner configuration accepts fixed HTTP endpoints and exact revisions", () => {
  const config = loadConfig({
    HINDSIGHT_RUNNERS: JSON.stringify({
      research: {
        url: "http://127.0.0.1:4124/",
        revision: "demo-research@1",
        secret: "runner-secret",
      },
    }),
  });
  assert.deepEqual(config.runners.research, {
    url: "http://127.0.0.1:4124",
    revision: "demo-research@1",
    secret: "runner-secret",
  });
});

test("runner configuration rejects unsafe or ambiguous endpoints", () => {
  for (const url of [
    "file:///tmp/runner",
    "http://user:pass@runner.local",
    "https://runner.local?callback=other",
  ]) {
    assert.throws(() =>
      loadConfig({
        HINDSIGHT_RUNNERS: JSON.stringify({
          research: { url, revision: "demo-research@1" },
        }),
      }),
    );
  }
});
