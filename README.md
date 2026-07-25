# Hindsight

**A flight recorder for AI agents.** Hindsight records each run in
[SigNoz](https://signoz.io), replays the captured evidence without live calls,
and sends complete checkpoints back through the agent's registered runtime.

![Hindsight turns a recorded failure into a testable branch](docs/assets/hindsight-landing.png)

---

## A trace can't test a fix

An ordinary trace shows where a run failed, but it can't answer the next
question: what would have happened if that tool result, prompt, model, or
response setting had changed?

Agent failures often span several steps. A bad tool result can trigger a retry
loop, burn tokens, and leave the final response unusable. Reading those spans
explains the failure; it doesn't run the corrected path.

Hindsight records enough state to replay the run or branch from one step while
keeping the original trace intact.

---

## Three verbs: Record · Replay · Fork

- **Record:** Agents emit versioned OpenTelemetry spans, correlated payload and
  event logs, and fleet metrics. Payload capture supports `off`, `redacted`, or
  `full`; the recorder also writes byte limits, hashes, and completeness.
- **Replay:** The engine traverses recorded responses only. It performs zero
  provider or tool calls and rejects an incomplete, redacted, truncated, or
  tampered checkpoint.
- **Fork:** A configured runner reconstructs state before the branch, applies
  exactly one supported mutation, then runs the real agent loop. Recorded tools
  match by name, normalized arguments, and occurrence. Side-effecting
  tools never run live.

---

## Architecture

```
  demo-agents ──emit OTLP──▶  SigNoz (localhost:8080)  ◀── dashboards + alerts (infra/)
   (recorder)                  traces · logs · metrics          │
                                       ▲                         │ webhook
                                       │ query_range             ▼
                                  replay-engine (:4123) ──── /hooks/signoz
                                       ▲      │             incidents · evidence
                                       │ REST │ runner protocol
                                    studio    ▼
                                    (:5173)  agent runner (:4124)
```

### SigNoz as the system of record

SigNoz holds run evidence. The replay-engine's SQLite database holds only
operational state: incidents, alert deduplication, fork attempts, verification,
and measured resolution time.

| Concern                     | SigNoz pillar | How Hindsight uses it                                                        |
| --------------------------- | ------------- | --------------------------------------------------------------------------- |
| Run structure / step graph  | **Traces**    | Spans carry `hindsight.run.id`, `hindsight.agent.id`, step index/kind, hashes |
| Full payloads (msgs, I/O)   | **Logs**      | Payload log records correlated by `trace_id`/`span_id` (`hindsight.payload`)  |
| Fleet health / SLOs / cost  | **Metrics**   | `hindsight.runs.total`, `hindsight.step.duration`, `hindsight.loop.score`, `hindsight.cost.usd.total` |
| Detection → action          | **Alerts**    | Trace-correlated log rules POST authenticated webhooks to the engine          |

---

## Quickstart

Requirements: Docker, Node, and pnpm. This repository includes a self-hosted
SigNoz stack under `pours/deployment/`, so a clean checkout needs three
commands:

```bash
make signoz
```

```bash
make key
```

```bash
make demo
```

`make signoz` starts the vendored SigNoz stack and waits until it answers. The
first run pulls images and migrates ClickHouse, so give it a few minutes.

`make key` creates `.env`, generates the webhook bearer secret, then opens
SigNoz and waits for you to paste an API key. This is the only manual step,
because SigNoz mints API keys from its UI: create the first account if the
install is fresh, then **Settings → API Keys → New Key** with the Admin role.

Already running SigNoz elsewhere? Skip `make signoz` and set `SIGNOZ_URL`. Stop
the vendored stack with `make signoz-down`; telemetry volumes are kept.

Taskline defaults to the deterministic `offline` provider, so the full
record/replay/fork path works with nothing to download. See
[Taskline](#taskline-ai-to-do-agent-demo) to run it against a real model.

`make doctor` verifies Node, pnpm, the Foundry files, SigNoz v0.133.x, OTLP
ingestion, both required credentials, and the selected Taskline provider (plus
the configured Ollama model when that provider is chosen). `make demo`
idempotently provisions the notification channel, four alert rules, and two
dashboards; builds the workspace; waits for the reference runner (`:4124`),
replay-engine (`:4123`), Studio (`:5173`), and Taskline (`:4174`) to become
healthy; then records mixed demo runs.

An incident appears only when an installed trace-correlated SigNoz rule
delivers an authenticated webhook. Hindsight never inserts a fake incident in
the main demo path.

**The incident list is empty right after `make demo`; give it about three
minutes.** The seeded failures are already in SigNoz, but the rules evaluate on
a schedule (`frequency: 30s` over a `1m` window) and ingestion adds its own lag,
so nothing reaches `/hooks/signoz` until the first evaluation covers those runs.
On a verified run, four seeded failures produced four incidents a little over
three minutes after seeding finished. An empty list before then is the pipeline
working, not a broken install.

The JSON under `infra/` holds versioned source configuration. Repository copies
remain marked `template_uninstalled`; `make provision` strips that
template-only metadata and installs missing resources through the tested
SigNoz API. The provisioner finds existing resources by their stable names and
corrects known channel drift without duplicating them. Use
`make provision-dry-run` to inspect the plan. SigNoz v0.133 requires every rule
to have a channel, so the fleet-only cost and latency rules use the same
authenticated webhook sink. The engine acknowledges those aggregate
notifications but never creates an incident without an authoritative trace ID.

Other targets: `make up` (start stack), `make seed` (demo data), `make dev`
(watch mode), `make down` (stop app processes; SigNoz untouched).

### Live SigNoz evidence

We verified the repository's demo recorder against SigNoz EE v0.133.0.
The captures below show real OTLP data, not fixture UI.

![Hindsight metrics ingested by SigNoz](docs/assets/signoz-metrics.png)

![A failed agent trace with Hindsight step attributes](docs/assets/signoz-failed-trace.png)

![Payload and run-failure logs correlated to the failed trace](docs/assets/signoz-correlated-logs.png)

The full test suite, `pnpm typecheck`, `pnpm build`, and
`pnpm validate:infra` pass on the submitted revision.

### Taskline: AI to-do agent demo

`make up` also starts Taskline at `http://localhost:4174`. A normal request
records the agent's `list_tasks` and `create_task` calls. The failure example
uses an invalid priority, opens a Hindsight incident, and links directly to the
failed tool step so you can fork it with an overridden result.

Taskline defaults to `HINDSIGHT_TODO_PROVIDER=offline`, a deterministic
provider that needs no model and no key. To drive it with a real local model,
install [Ollama](https://ollama.com) and switch providers in `.env`:

```bash
ollama pull gemma3:1b
```

Then set `HINDSIGHT_TODO_PROVIDER=ollama` and re-run `make demo`. Ollama's local
API needs no key. Taskline uses a JSON action protocol because Gemma 3 1B does
not expose native tool calls. `anthropic` plus `ANTHROPIC_API_KEY` also works.

To prove the complete local non-mock path, including verified incident
resolution and `provider=ollama` evidence on the fork trace (requires the
`ollama` provider):

```bash
pnpm --filter @hindsight/demo-agents verify:ollama
```

The command exits non-zero unless Taskline uses Ollama, the fork carries valid
lineage and verification, the incident resolves, and every fork LLM step
reports a non-mock provider.

---

## Fork walkthrough

1. The recorder detects a loop or failed run and emits a trace-correlated
   `loop_detected` or `run_failed` log event.
2. SigNoz POSTs to `/hooks/signoz`; the replay-engine opens an **incident** anchored to the run's trace id.
3. Open the incident in Studio. The run view reports checkpoint completeness,
   agent revision, runner availability, and supported mutations.
4. Fork with one mutation. The registered runtime confirms the revision and
   mutation hash and emits a span-linked trace carrying the incident ID.
5. Hindsight queries the new trace and resolves only if the original failed,
   the linked fork succeeded, the original failure/event is absent, and all
   lineage and mutation evidence matches. Otherwise the incident returns open.

The exact three-minute recording path is in
[`docs/submission/demo-script.md`](docs/submission/demo-script.md).

---

## Design decisions

- **Payloads live in logs.** Span attributes have practical size limits, so full LLM messages and tool I/O are written as OTel *log records* correlated by `trace_id`/`span_id`. Spans stay cheap and queryable; payloads stay complete. See `packages/shared/src/telemetry.ts` and `apps/replay-engine/src/signoz/client.ts`.
- **Replay and fork are distinct.** Replay is data-only. Forking calls a
  configured runtime; strict mode rejects an unrecorded tool dependency, while
  hybrid mode may run only tools the runner declares safe.
- **Span links for lineage.** Forks reference their origin via `hindsight.fork.of` / `hindsight.fork.point`, so a forked run is traceable back to the incident and the exact step it branched from.
- **Proof before resolution.** Manual updates can dismiss with a reason, but
  cannot set `verifying` or `resolved`. Alert recovery also cannot resolve an
  incident.
- **Config-as-code.** Dashboard and alert templates target SigNoz v0.133.x.
  `pnpm validate:infra` checks their `hindsight.*` names against the shared
  telemetry contract. `make provision` installs them idempotently.
- **Local security by default.** The engine binds to loopback, uses an explicit
  Studio CORS allowlist, and requires bearer authentication unless the
  localhost-only development bypass is explicitly enabled. A remote bind must
  set `HINDSIGHT_API_TOKEN` and disable that bypass.

---

## Limitations & non-goals

- **Not a SigNoz replacement.** Hindsight assumes a running SigNoz (managed
  under `pours/deployment/`). It provisions Hindsight resources but does not
  stand up SigNoz itself.
- **Replay and fork require complete evidence.** Missing, redacted, truncated,
  mismatched, or expired payload logs fail closed; they never fall through to
  live execution.
- **Provisioned JSON is version-specific.** The `infra/` config targets SigNoz EE ~v0.133.0. On other versions, validate on import (each file carries a note).
- **Payload retention matters.** Keep payload logs at least as long as the
  traces operators expect to replay or fork. Full capture may contain
  sensitive data and increases log storage; redacted capture is safer but may
  intentionally make a checkpoint non-forkable.
- **Only registered revisions can fork.** Configure agent ID → runner URL and
  revision with `HINDSIGHT_RUNNERS`. The engine never accepts a callback URL
  from the browser.
- **Not a general agent framework or eval harness.** Hindsight records, replays, and forks runs; it does not orchestrate agents or score model quality.
- **Local-first.** The default endpoints and the `make demo` flow assume a single-host dev setup.

---

## License

[MIT](./LICENSE) © 2026 Hindsight.

## AI assistance disclosure

The project author used AI coding assistants during implementation, testing,
design review, and documentation. The author made the architecture and product
decisions, verified the integration, and reviewed the submitted result.
