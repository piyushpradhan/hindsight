import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToolArgs, canonicalJson } from "./hash.js";

test("key order does not change the hash", () => {
  const a = hashToolArgs({ query: "cats", limit: 3 });
  const b = hashToolArgs({ limit: 3, query: "cats" });
  assert.equal(a, b);
});

test("different args hash differently", () => {
  assert.notEqual(hashToolArgs({ q: "a" }), hashToolArgs({ q: "b" }));
});

test("nested objects are canonicalized recursively", () => {
  const a = canonicalJson({ a: { z: 1, y: 2 }, b: [3, 2] });
  const b = canonicalJson({ b: [3, 2], a: { y: 2, z: 1 } });
  assert.equal(a, b);
});

test("hash is a 64-char sha256 hex digest", () => {
  assert.match(hashToolArgs({ x: 1 }), /^[0-9a-f]{64}$/);
});
