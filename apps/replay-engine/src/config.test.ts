import assert from "node:assert/strict";
import { test } from "node:test";
import { isApiRequestAuthorized, loadConfig, requiresApiAuth } from "./config.js";

test("security defaults bind locally, allow Studio origins, and require API auth", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.deepEqual(config.corsOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  assert.equal(config.apiToken, undefined);
  assert.equal(config.allowUnauthenticatedLocalhost, false);
});

test("API auth accepts bearer tokens or an explicit loopback-only bypass", () => {
  const secured = {
    host: "127.0.0.1",
    apiToken: "engine-secret",
    allowUnauthenticatedLocalhost: false,
  };
  assert.equal(isApiRequestAuthorized(secured, "Bearer engine-secret", "10.0.0.8"), true);
  assert.equal(isApiRequestAuthorized(secured, "Bearer wrong", "127.0.0.1"), false);
  assert.equal(isApiRequestAuthorized(secured, undefined, "127.0.0.1"), false);

  const development = { ...secured, apiToken: undefined, allowUnauthenticatedLocalhost: true };
  assert.equal(isApiRequestAuthorized(development, undefined, "::1"), true);
  assert.equal(isApiRequestAuthorized(development, undefined, "10.0.0.8"), false);
  assert.equal(
    isApiRequestAuthorized({ ...development, host: "0.0.0.0" }, undefined, "127.0.0.1"),
    false,
  );
});

test("health, webhook, and preflight requests stay outside API bearer auth", () => {
  assert.equal(requiresApiAuth("GET", "/api/runs"), true);
  assert.equal(requiresApiAuth("GET", "/api/health?verbose=1"), false);
  assert.equal(requiresApiAuth("POST", "/hooks/signoz"), false);
  assert.equal(requiresApiAuth("OPTIONS", "/api/runs"), false);
});

test("security configuration rejects malformed allowlists and bypass flags", () => {
  assert.throws(() => loadConfig({ HINDSIGHT_CORS_ORIGINS: "https://example.com/path" }));
  assert.throws(() =>
    loadConfig({ HINDSIGHT_ALLOW_UNAUTHENTICATED_LOCALHOST: "yes" }),
  );
});

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
