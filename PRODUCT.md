# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are engineers responsible for AI agents in production — served in
two moments, with the incident-response moment as the spine:

- **On-call reliability engineer** — paged when an agent misbehaves. Opens the
  incident, finds the step that went wrong, forks with a corrected input, and
  confirms it resolves.
- **Agent developer** — replays and forks their own runs during development to
  understand a failure before shipping.

Everything else hangs off the incident → fork → resolved path.

## Product Purpose

Hindsight is a flight recorder for AI agents: record every run, traverse a
complete record without live calls, and fork from the exact step where things
went wrong through the registered agent runtime. It
exists because ordinary observability gives you an autopsy — read-only,
past-tense — when what you actually need is to change one input and see what
*would have* happened. Success is closing an incident by forking from the last
good step, fixing the input, and confirming the fix, faster and cheaper than a
full re-run.

## Positioning

Hindsight turns a trace into a time machine by treating the same telemetry that
records a run as the substrate to **replay and branch it**. SigNoz holds run
evidence; SQLite holds incident and verification state. Replay returns recorded
responses only and fails closed when evidence is incomplete. A fork rebuilds
checkpoint state and resumes the real registered runtime with one mutation.
This
"replay + honest fork on top of your existing SigNoz" is the mechanism a
neighboring dashboard or trace viewer cannot truthfully claim.

## Operating Context

- Agents emit OpenTelemetry (GenAI semantic conventions) plus `hindsight.*`
  extensions; full payloads go out as correlated log records so spans stay small.
- Assumes a SigNoz instance already running (EE ~v0.133.0, `localhost:8080` in
  the demo); Hindsight queries it via REST and receives alert webhooks.
- Detection → action loop: the recorder emits trace-correlated `run_failed` and
  `loop_detected` logs; installed SigNoz log alerts POST an authenticated
  webhook that opens an incident anchored to the run's trace ID.
- Core surfaces going forward: the **Studio app UI** (run graph, replay, fork,
  incidents — an Operate surface) and the uninstalled SigNoz templates in
  `infra/`. Marketing is out of scope for now.
- Local-first: default endpoints and the `make demo` flow assume a single-host
  dev setup, targeting a working demo in under 5 minutes.

## Capabilities and Constraints

- **Record · Replay · Fork** are the three verbs. Record = OTel spans + payload
  logs + metrics; Replay = pure traversal of captured responses; Fork = mutate
  one input and resume a complete checkpoint through a configured runner.
- Frozen vocabulary: metric/attribute names live in
  `packages/shared/src/telemetry.ts` (`hindsight.run.id`, `hindsight.agent.id`,
  `hindsight.loop.score`, `hindsight.cost.usd.total`, `hindsight.forks.resolved.total`,
  fork lineage via `hindsight.fork.of` / `hindsight.fork.point`, etc.) so config
  and code never drift. Treat these names as fixed.
- Replay and fork require complete, hash-valid payloads and tool-call
  continuity. Missing, redacted, truncated, or expired evidence fails closed.
- Provisioned dashboard/alert JSON in `infra/` is version-specific to SigNoz EE
  ~v0.133.0.
- Stack: pnpm monorepo — `apps/studio` (Vite/React, :5173), `apps/replay-engine`
  (:4123), `apps/demo-agents`, `packages/recorder`, `packages/shared`.

**Non-goals:** not a SigNoz replacement or installer; not a general agent
framework or eval harness; does not orchestrate agents or score model quality.

## Brand Commitments

- Name: **Hindsight**. Tagline: "A flight recorder for AI agents."
- MIT licensed, © 2026 Hindsight. Open-source project aimed at public adoption.
- The **Record · Replay · Fork** triad and "autopsy → time machine" framing are
  the load-bearing story; SigNoz-as-system-of-record is a deliberate, stated
  architectural commitment, not an incidental dependency.

## Evidence on Hand

- `README.md` — authoritative product description, architecture diagram, pillar
  map, fork walkthrough, design decisions, non-goals.
- `infra/` — uninstalled, versioned dashboard and alert templates. Installation
  must be confirmed in SigNoz.
- `apps/demo-agents` + `make demo` — a runnable reference runner and telemetry
  seed. Incidents are never inserted as demo data.
- Studio uses the live engine by default. `?mock=1` is an explicit,
  visibly-labelled fixture mode.

## Product Principles

1. **Change the input, not just read the output** — every surface should move the
   user toward re-running or forking, not just inspecting a dead trace.
2. **Honest replay** — replay makes zero calls; fork execution is labelled and
   constrained by runner capabilities. Never blur recorded, mocked, and live.
3. **SigNoz is the system of record** — store no separate copy; the design must
   feel like a native layer over the user's existing telemetry, not a silo.
4. **Incident → fork → resolved is the spine** — optimize the path from alert to
   confirmed fix; other flows are tributaries.
5. **Frozen names, versioned config** — the `hindsight.*` vocabulary and `infra/`
   JSON are contracts; design and copy honor them exactly.
