# Hindsight

**A flight recorder for AI agents.** Record every run, replay any run deterministically, and fork from the exact step where things went wrong — built on top of [SigNoz](https://signoz.io) as the system of record.

<!-- TODO: hero GIF — a run failing, an incident opening, a one-click fork succeeding -->

---

## The problem: traces are autopsies

When an agent misbehaves, the usual observability stack tells you *that* it failed and roughly *where* — after the fact, on a corpse. A trace is an autopsy: read-only, past-tense, and missing the one thing you actually want, which is to change one input and see what *would have* happened.

Agents make this worse. They loop. They burn tokens. They call the wrong tool, then apologize, then call it again. The failure is rarely a single bad span — it's a *path*, and you can't re-walk the path from a flat trace.

Hindsight turns the autopsy into a time machine: the same telemetry that records the run also lets you **re-run it, and branch it.**

---

## Three verbs: Record · Replay · Fork

- **Record** — Agents emit OpenTelemetry spans (GenAI semantic conventions) plus Hindsight extensions under `hindsight.*`. Full payloads (LLM messages, tool I/O) go out as correlated **log records**, so spans stay small while nothing is lost. Metrics like `hindsight.loop.score`, `hindsight.runs.total`, and `hindsight.cost.usd.total` power the dashboards and alerts.
- **Replay** — The replay-engine reconstructs a run graph from SigNoz (traces + payload logs) and re-executes it deterministically. Mocked tool/LLM responses come straight from the recorded payloads, so a replay is byte-for-byte the original.
- **Fork** — Pick a step, mutate one input (a prompt, a tool result, a parameter), and re-run from there. Everything before the fork point is replayed from the record; everything after is live. That's how you close an incident: fork from the last good step, fix the input, confirm it resolves.

---

## Architecture

```
  demo-agents ──emit OTLP──▶  SigNoz (localhost:8080)  ◀── dashboards + alerts (infra/)
   (recorder)                  traces · logs · metrics          │
                                       ▲                         │ webhook
                                       │ query_range             ▼
                                  replay-engine (:4123) ──── /hooks/signoz
                                       ▲                    incidents · forks
                                       │ REST /api
                                    studio (:5173)
```

### SigNoz as the system of record — pillar map

Hindsight stores **no separate copy** of run data. SigNoz's three pillars *are* the recorder's storage.

| Concern                     | SigNoz pillar | How Hindsight uses it                                                        |
| --------------------------- | ------------- | --------------------------------------------------------------------------- |
| Run structure / step graph  | **Traces**    | Spans carry `hindsight.run.id`, `hindsight.agent.id`, step index/kind, hashes |
| Full payloads (msgs, I/O)   | **Logs**      | Payload log records correlated by `trace_id`/`span_id` (`hindsight.payload`)  |
| Fleet health / SLOs / cost  | **Metrics**   | `hindsight.runs.total`, `hindsight.step.duration`, `hindsight.loop.score`, `hindsight.cost.usd.total` |
| Detection → action          | **Alerts**    | Rules POST to the replay-engine webhook, which opens incidents               |

---

## Quickstart

SigNoz is expected to already be running at `http://localhost:8080` (its compose lives under `pours/deployment/`).

```bash
make demo
```

`make demo` installs deps, builds the workspace, starts the replay-engine (`:4123`) and studio (`:5173`), seeds demo agents + a triggered incident, and opens both the SigNoz UI and Studio. Target: **under 5 minutes**.

Import the provisioned config once:

- **Dashboards** — SigNoz UI → Dashboards → *Import JSON* → `infra/dashboards/agent-reliability.json` and `infra/dashboards/hindsight-ops.json`.
- **Alerts** — SigNoz UI → Alerts → *New Alert* → import each file in `infra/alerts/`. First create a webhook notification channel named `hindsight-replay-engine` pointing at `http://localhost:4123/hooks/signoz`.

Other targets: `make up` (start stack), `make seed` (demo data), `make dev` (watch mode), `make down` (stop app processes; SigNoz untouched).

<!-- TODO: screenshot — the two imported dashboards side by side -->

---

## Fork walkthrough

1. An agent loops. The **loop tripwire** alert (`hindsight.loop.score >= 3`) fires immediately.
2. SigNoz POSTs to `/hooks/signoz`; the replay-engine opens an **incident** anchored to the run's trace id.
3. Open the incident in Studio. The run graph highlights the loop entry as a suggested **fork point**.
4. Mutate the offending input and **fork**. Steps before the fork replay from the record; steps after run live.
5. The fork resolves. `hindsight.forks.resolved.total` ticks up, the incident closes, and the *Hindsight :: Ops* dashboard shows the `$ saved by fork vs full re-run`.

<!-- TODO: GIF — the full loop-to-fork-to-resolved flow in Studio -->

---

## Design decisions

- **Payload-as-logs.** Span attributes have practical size limits, so full LLM messages and tool I/O are written as OTel *log records* correlated by `trace_id`/`span_id`. Spans stay cheap and queryable; payloads stay complete. See `packages/shared/src/telemetry.ts` and `apps/replay-engine/src/signoz/client.ts`.
- **Mock policy for deterministic replay.** During replay/fork, all recorded tool and LLM calls are served from their payload logs — no live calls before the fork point. This is what makes a replay reproducible and a fork honest (only the mutated branch is live).
- **Span links for lineage.** Forks reference their origin via `hindsight.fork.of` / `hindsight.fork.point`, so a forked run is traceable back to the incident and the exact step it branched from.
- **Config-as-code.** Dashboards and alert rules live in `infra/` as version-controlled JSON, matched to SigNoz EE v0.133.0. Metric and attribute names are frozen in `packages/shared/src/telemetry.ts` so config and code never drift.

---

## Limitations & non-goals

- **Not a SigNoz replacement or installer.** Hindsight assumes a running SigNoz (managed under `pours/deployment/`); it does not stand one up.
- **Deterministic replay requires recorded payloads.** Steps whose I/O wasn't captured can't be mocked and will fall through to live execution.
- **Provisioned JSON is version-specific.** The `infra/` config targets SigNoz EE ~v0.133.0. On other versions, validate on import (each file carries a note).
- **Not a general agent framework or eval harness.** Hindsight records, replays, and forks runs; it does not orchestrate agents or score model quality.
- **Local-first.** The default endpoints and the `make demo` flow assume a single-host dev setup.

---

## License

[MIT](./LICENSE) © 2026 Hindsight.
