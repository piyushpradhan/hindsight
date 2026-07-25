# SigNoz adapter notes

All SigNoz-version-specific guesses live in `client.ts` (see `COL`,
`ATTR_DATA_TYPE`, `readLogBody`). To re-derive column names against a live
instance (with `SIGNOZ_API_KEY` set):

1. Open SigNoz (`http://localhost:8080`) -> Logs/Traces explorer, run any
   list query, and copy the request body of `POST /api/v3/query_range` from
   browser devtools — that is the exact builder-query shape this version emits.
2. Diff its `selectColumns`/`filters` keys (e.g. `trace_id` vs `traceID`,
   `body` handling, `type: "tag"` vs `"resource"`) against `COL` in client.ts.
3. Or `curl -H "SIGNOZ-API-KEY: $KEY" http://localhost:8080/api/v3/query_range`
   with a minimal body and inspect `data.result[0].list[0].data` keys.
4. Patch ONLY client.ts; `SpanInput`/`PayloadLogInput` stay unchanged.
5. Re-run `pnpm --filter @hindsight/replay-engine test` to confirm the patch
   didn't affect the pure layers.
