# Hindsight — Finished Product Implementation Plan

Status: phases 0–4 implemented; the core Phase 5 comparison/Studio work,
loopback API hardening, idempotent SigNoz provisioning, and a verified local
Ollama path are implemented. Remaining unchecked items are explicit release
and production-operations work rather than hidden demo claims.
Based on: repository and live SigNoz audit completed 2026-07-25

## 1. Target

Ship a trustworthy, self-hosted v1 for one organization in which an engineer
can:

1. record an agent run into SigNoz;
2. reconstruct and replay that run without making live calls;
3. fork a complete checkpoint through the agent's real runtime with exactly one
   supported mutation;
4. receive a trace-anchored incident from a SigNoz alert;
5. compare the original and fork;
6. close the incident only after Hindsight verifies that the linked fork fixed
   the recorded failure.

“Finished” means every visible control and reported number has real backing
behavior. Unsupported mutations, missing payloads, unknown costs, and
unavailable runners must be shown explicitly rather than replaced with a
plausible-looking success.

### v1 boundaries

- SigNoz remains the system of record for run traces, payload logs, and fleet
  metrics.
- Hindsight may keep only operational state such as incidents, webhook
  fingerprints, and fork attempts in its existing SQLite store.
- The supported deployment is self-hosted, single-organization, and
  authenticated with operator-configured secrets.
- One reference agent runtime must work end to end with a real provider. Other
  runtimes integrate through the same small runner protocol.
- SigNoz v0.133.x is the initial tested compatibility target. Config and schema
  versions must be reported, not assumed.

### Explicit non-goals for v1

- Reconstructing arbitrary agent source code from a trace.
- Hosted multi-tenancy, billing, team administration, or enterprise RBAC.
- An eval platform, autonomous root-cause analysis, or an LLM quality judge.
- Live execution of side-effecting tools from Studio.
- Supporting every agent framework before the reference integration is sound.

## 2. Product invariants

These are release-blocking rules:

- **Replay is offline.** It reads recorded outputs and never calls a provider or
  tool.
- **Forks are causal.** The actual registered agent runtime resumes from a
  complete checkpoint, and the requested mutation is applied exactly once.
- **Missing evidence fails closed.** An incomplete or truncated checkpoint
  cannot be presented as deterministic or forkable.
- **Tool matching is exact.** A recorded tool result is keyed by tool name,
  normalized arguments, and occurrence/step identity.
- **One fork, one mutation.** Invalid targets and unsupported mutation types are
  rejected before execution.
- **Resolution requires proof.** A successful linked fork must no longer contain
  the original failure condition; a manual note alone cannot resolve an
  incident.
- **Signals keep their jobs.** Traces describe a run, logs hold correlated
  payloads/events, and metrics report fleet aggregates. Aggregate metric alerts
  do not pretend to identify a single trace.
- **Unknown is not zero.** Missing token, price, cost, or duration data is shown
  as unknown.

## 3. Delivery order

The critical path is:

```text
telemetry contract
    → complete checkpoint
    → real runner and honest fork
    → trace-anchored incident
    → verified resolution
    → truthful UI and dashboards
    → hardened demo and release
```

Do not polish or expand the mutation UI before the real runner path passes its
acceptance tests.

## 4. Phase 0 — Stop overstating the current product

Goal: make the development baseline honest while the underlying work proceeds.

- [x] Add a single `hindsight.schema.version` constant and include it on all
      Hindsight root spans and payload records.
- [x] Add runner capabilities to the existing API response: availability,
      agent revision, supported mutation types, and whether the checkpoint is
      complete.
- [x] Hide or disable mutation controls that the selected runner does not
      support.
- [x] Reject fork requests when no real runner is registered. Remove the mock
      provider as the replay-engine's implicit fallback.
- [x] Change documentation that currently says missing payloads fall through to
      live execution. The required behavior is fail closed.
- [x] Mark demo dashboards/config as uninstalled until the SigNoz API confirms
      that they exist.
- [x] Correct `README.md` and `PRODUCT.md` claims about seeded incidents, live
      wiring, deterministic behavior, and supported SigNoz setup.

Acceptance gate:

- Every currently manufactured-success path returns a clear unsupported,
  incomplete-record, or runner-unavailable result.
- The Studio cannot imply that a disabled capability works.

## 5. Phase 1 — Repair the telemetry contract

Goal: make recorder output, replay queries, alerts, and dashboards use one
tested vocabulary.

### Recorder and shared schema

- [x] Define attribute and metric names once in
      `packages/shared/src/telemetry.ts`; import them from recorder and engine
      code and generate/validate infra config against the same names.
- [x] Emit the label keys consumed by infra. Choose one namespaced form such as
      `hindsight.agent.id`, `hindsight.run.outcome`,
      `hindsight.step.kind`, and `hindsight.tool.name`; remove the current
      `agent`/`outcome`/`kind`/`tool` split.
- [x] Add current GenAI semantic-convention fields, including operation and
      provider names, while retaining Hindsight fields needed for stable
      queries.
- [x] Treat `service.name` as application-owned recorder configuration. Keep
      agent identity in `hindsight.agent.id`; do not compute an unused
      per-agent service name inside a multi-agent process.
- [x] On the root run span, record final outcome, step count, token totals, known
      cost, duration, error type, payload completeness, recorder version, and
      agent/runtime revision.
- [x] Honor the recorder's supplied price table. Unknown model pricing must
      produce unknown cost plus a price-source/version marker, not `$0`.
- [x] Record payload bytes, truncation, redaction, and capture-policy metadata.

### Replay-engine queries

- [x] List runs from root spans only and read the root aggregates directly.
- [x] Rebuild detail views from child spans and payload logs without requiring
      run identity to have been copied to every child span.
- [x] Support the previous schema for one migration window, but emit only the
      new version.
- [x] Replace hand-built test fixtures with at least one fixture exported from
      the real recorder so tests cannot invent attributes production does not
      emit.

### Infra

- [x] Update all dashboard and alert filters/grouping fields to match emitted
      labels.
- [x] Add a validation script that extracts referenced `hindsight.*` names from
      `infra/` and fails when a name is absent from the shared contract.

Acceptance gate:

- A newly recorded run has correct non-zero list summaries and the same totals
  in detail view.
- Every dashboard/alert field exists in captured live telemetry.
- An unknown price is visibly unknown.

## 6. Phase 2 — Make records sufficient for replay and resume

Goal: turn a trace plus payload logs into an explicit, validated checkpoint.

### Payload capture and governance

- [x] Capture the exact ordered provider request/response messages, tool call
      IDs, normalized tool arguments/results, model, provider, parameters,
      finish reason, and agent/runtime revision needed to resume.
- [x] Add recorder-side redaction hooks with safe defaults for common secret
      fields and headers.
- [x] Add configurable payload byte limits. Emit a truncation flag and payload
      hash; never silently cut content.
- [x] Document the security and storage cost of full-payload capture and provide
      capture-off/redacted/full modes.
- [x] Document SigNoz retention requirements and the effect of a payload log
      expiring before its trace.

### Checkpoint builder

- [x] Build the checkpoint from recorded provider messages and tool call IDs;
      do not synthesize chat history from display text.
- [x] Validate continuity, ordering, payload hashes, tool-call pairing, and
      schema version.
- [x] Return a machine-readable completeness report listing missing,
      truncated, redacted, or unsupported pieces.
- [x] Make replay a pure traversal of recorded responses. If a required response
      is absent, stop at that step with `incomplete_record`.
- [x] Preserve original step indices and mark the branch point separately.

Acceptance gate:

- Replay performs zero provider/tool calls and reproduces the recorded outputs.
- Deleting one required payload log makes replay/fork fail closed with the exact
  missing span/step identified.
- Sensitive fields configured for redaction are absent from SigNoz.

## 7. Phase 3 — Replace simulated forks with a real runner

Goal: make a fork evidence about the real agent, not the replay-engine's mock
script.

### Minimal runner contract

Implement one HTTP runner contract instead of teaching the replay-engine every
agent framework. The engine sends:

- origin trace/run ID and fork point;
- validated checkpoint;
- exactly one typed mutation;
- recorded tool mocks for deterministic dependencies;
- idempotency key, timeout, and lineage metadata.

The runner returns:

- accepted/rejected status and structured errors;
- new run/trace ID;
- runtime and agent revision actually used;
- mutation actually applied;
- terminal outcome.

The forked run itself must still be emitted through the recorder into SigNoz.

### Execution work

- [x] Register agent ID/revision to runner URL through server configuration.
      Validate scheme/host and prevent arbitrary user-supplied callback URLs.
- [x] Implement the contract in `apps/demo-agents` using the real agent loop,
      with at least one real provider path for end-to-end verification.
- [x] Keep the existing mock provider only as an explicitly selected test/demo
      provider.
- [x] Validate mutation target, type, and old value before contacting the
      runner.
- [x] Support only mutations the reference runner can prove:
      prompt/message edit, model swap, parameter change, and exact tool-result
      override. Hide any type until its positive and negative tests pass.
- [x] Match tool mocks by name + normalized argument hash + occurrence/step ID.
- [x] Disallow live side-effecting tools in v1. Pure/read-only tools may be
      allowed only when declared by the runner and shown as live in the result.
- [x] Add timeout/abort handling and an idempotency key to the existing
      synchronous endpoint. Do not add a queue until measured fork duration
      requires it.
- [x] Emit real fork lineage with an OTel span link plus origin trace, fork
      point, mutation ID/hash, incident ID, and checkpoint completeness.
- [x] Return the actual failure if the agent still fails. Removing injected
      chaos cannot itself count as a successful mutation.

Acceptance gate:

- Each exposed mutation changes the intended runtime input and has a negative
  test showing that a nonexistent target is rejected.
- Repeating a request with the same idempotency key does not run it twice.
- A control fork with an irrelevant mutation does not automatically succeed.
- The new SigNoz trace identifies the real runner/runtime and links to the
  original trace.

## 8. Phase 4 — Complete the alert-to-resolution lifecycle

Goal: make Incident → Fork → Verified Resolution the actual product spine.

### Detection

- [x] Emit structured, trace-correlated failure and loop events/logs at the
      point they are detected.
- [x] Use trace/log alerts for run-specific incidents so the alert includes a
      trace ID and run ID.
- [x] Keep metric alerts for fleet/SLO notifications; route them to a separate
      aggregate finding or notification flow rather than inventing a trace ID.
- [x] Provision and test alert rules against the selected SigNoz version.

### Webhook and incident state

- [x] Authenticate SigNoz webhooks with a configured bearer secret or HMAC.
- [ ] Parse firing and resolved payloads using versioned fixtures captured from
      the live SigNoz instance.
- [x] Deduplicate by alert fingerprint + trace ID with a database constraint.
- [x] Persist alert name, source, condition, original run/trace, opened time,
      status, and linked fork attempts.
- [x] Add explicit `open`, `verifying`, `resolved`, and `dismissed` states.
- [x] Accept `incidentId` on a fork request and write it to fork telemetry.

### Verification and postmortem

- [x] Compare the linked fork after telemetry becomes queryable.
- [x] Resolve only when the original failed, the fork completed successfully,
      the original failure condition is absent, and the mutation was confirmed
      by the runner.
- [x] Store `resolvedAt`, measured resolution duration, winning mutation,
      original/fork costs when known, and compare result.
- [x] Permit dismissal with a reason; do not expose an unverified “resolve”
      action.
- [x] Generate the postmortem from stored evidence after resolution. Label
      unknown root cause as unknown instead of fabricating an explanation.
- [x] Emit engine meta-metrics for incidents opened/resolved, fork
      attempts/outcomes, and measured resolution duration.

Acceptance gate:

- One intentional failing demo run causes SigNoz to call the webhook, opens one
  incident, links a real fork, verifies it, and resolves it without database
  seeding or manual status edits.
- Duplicate webhook delivery creates no duplicate incident.
- A successful but unrelated fork does not resolve the incident.

## 9. Phase 5 — Make comparison, Studio, and dashboards truthful

Goal: present the repaired backend clearly and remove decorative or misleading
states.

### Compare

- [x] Show the shared prefix once and compare the original branch with the fork
      from the preserved fork point.
- [x] Diff prompt/message, model, parameters, tool result, terminal output,
      tokens, duration, and known cost.
- [x] Use `improved`, `unchanged`, `regressed`, and `not_verifiable` verdicts.
- [x] Calculate saved execution only from measured values. For v1, compare the
      original full-run cost with the fork branch cost and label excluded
      recorded-prefix cost clearly. Never show savings when either cost is
      unknown.

### Studio

- [x] Drive mutation controls from runner capabilities.
- [x] Show checkpoint completeness, schema version, agent revision, runner
      status, and payload redaction/truncation before enabling a fork.
- [x] Mark every displayed step as recorded, mocked, or live.
- [x] Show actionable errors for SigNoz connectivity, missing payloads,
      unsupported mutations, runner failure, and verification failure.
- [ ] Poll existing endpoints for fork/incident completion; add streaming only
      if polling creates a measured problem.
- [x] Make the incident page lead directly to the linked run, suggested fork
      point, fork attempt, compare result, and evidence-backed postmortem.
- [ ] Add loading, empty, keyboard, focus, contrast, and narrow-screen states to
      the core Run, Incident, Fork, and Compare flows.

### Dashboards

- [x] Replace the current fake MTTR calculation with measured incident
      resolution duration.
- [x] Replace the current “dollars saved” formula with recorded fork comparison
      values, or remove the panel until those metrics exist.
- [x] Build reliability panels only from emitted metrics: runs, outcome rate,
      latency, tokens, known cost, tool errors, and loop score.
- [x] Build Hindsight operations panels from emitted engine meta-metrics.
- [ ] Include config version and install status in dashboard metadata.

Acceptance gate:

- A first-time operator can move from an alert to a verified comparison without
  reading source code or entering IDs manually.
- Every visible number can be traced to a stored span, log, incident timestamp,
  or emitted metric.

## 10. Phase 6 — Security and operational safety

Goal: make the self-hosted product safe to expose inside an engineering
network.

- [x] Require an API token for engine endpoints; allow an explicit
      localhost-only development bypass.
- [x] Use a CORS allowlist and bind to loopback by default.
- [ ] Validate request bodies, mutation sizes, identifiers, runner responses,
      and webhook bodies. Add conservative body and request time limits.
- [ ] Keep provider, SigNoz, webhook, and runner secrets out of payload logs,
      spans, API responses, and frontend bundles.
- [ ] Add an audit record for fork requested/completed, mutation type, incident
      transition, dismissal, and postmortem generation. Store hashes or
      summaries rather than secret payloads.
- [ ] Add readiness checks for SigNoz query access, OTLP export, database
      migration, and configured runner reachability. Keep liveness independent
      of external services.
- [ ] Version SQLite migrations and document backup/restore for operational
      state.
- [ ] Document TLS/reverse-proxy setup, token rotation, payload retention,
      redaction, and incident-store backup.
- [ ] Pin container/image versions used by the supported compose path.
- [ ] Run dependency and secret scanning in CI using repository/platform
      features before adding new services.

Acceptance gate:

- Unauthenticated API and webhook requests fail.
- The default process is not remotely reachable.
- A redaction/secret-canary test finds no canary in SigNoz or API output.
- Restarting the engine preserves incidents and completed fork evidence.

## 11. Phase 7 — Deliver a real five-minute demo and install path

Goal: make setup repeatable from a clean checkout.

- [x] Add `.env.example` with every required value and a safe local default
      where one exists.
- [ ] Add `make doctor` to validate Node/pnpm, SigNoz version/health/API key,
      OTLP ingestion, replay-engine auth, and runner configuration.
- [x] Make `make demo` load configuration, install/build, wait for health, and
      fail on timeout rather than sleeping optimistically.
- [x] Provision the notification channel, dashboards, and alert rules
      idempotently through the tested SigNoz API.
- [ ] Seed a uniquely identified failing run and wait for the real alert-created
      incident. Do not insert an incident directly.
- [x] Run the reference fork and verification path as a smoke test, while
      leaving the resulting incident and traces available for exploration.
- [ ] Add `make down` cleanup based on recorded PIDs or compose ownership rather
      than broad `pkill` patterns.
- [ ] Add a production deployment guide for connecting an existing SigNoz,
      running engine/Studio, registering a runner, configuring auth, and
      importing/provisioning config.
- [x] Rewrite the README walkthrough from the verified clean-shell flow and
      replace TODO/fabricated screenshots with captured results.
- [ ] Add a compatibility note covering tested SigNoz and telemetry schema
      versions plus the upgrade procedure.

Acceptance gate:

- On a clean machine with the documented prerequisites, one command reaches a
  real alert → incident → fork → verified-resolution result in under five
  minutes.
- Running setup twice is safe and does not duplicate config or incidents.

## 12. Phase 8 — Test and release gates

Goal: prove the product, not just its components.

### Automated coverage

- [x] Keep unit tests for hashing, payload policy, graph reconstruction,
      mutation validation, compare logic, webhook parsing, and incident state.
- [ ] Add a recorder → OTLP fixture → replay-engine contract test.
- [ ] Add a live SigNoz integration suite that records and queries traces, logs,
      metrics, span links, dashboards, alerts, and webhook payloads.
- [ ] Add API tests for authentication, validation, idempotency, timeout,
      deduplication, and restart persistence.
- [ ] Add browser tests for Runs → Fork → Compare and Incident → Verified
      Resolution. Use one established browser-test dependency only.
- [ ] Add failure scenarios: missing/truncated/redacted payload, unknown price,
      unavailable runner, invalid mutation target, provider failure, tool loop,
      delayed telemetry, duplicate webhook, and unsuccessful verification.
- [ ] Add a modest scale check using a 1,000-step trace and concurrent fork
      requests to establish documented limits; optimize only measured failures.

### CI and release

- [ ] Required CI: format/lint if configured, typecheck, unit tests, build, API
      integration, and UI smoke test.
- [ ] Run the heavier live-SigNoz suite for releases and on a scheduled job if
      it is too slow for every change.
- [ ] Produce versioned packages/images, schema/config versions, changelog,
      upgrade notes, checksums, and license notices.
- [ ] Verify health/readiness, clean install, upgrade from the previous schema,
      backup/restore, and uninstall instructions.
- [ ] Remove or clearly label every remaining mock, TODO, unsupported control,
      placeholder metric, and sample-only claim.

Release is blocked unless:

1. all exposed mutation types pass positive and negative real-runner tests;
2. replay makes zero live calls;
3. the clean demo completes through a real SigNoz alert;
4. incident resolution is evidence-backed and persisted;
5. telemetry names match all infra queries;
6. payload safety defaults and authentication are enabled;
7. a restart loses no operational evidence;
8. README behavior matches the released build.

## 13. Recommended pull-request sequence

Keep changes reviewable and avoid a second architecture:

1. **Truthful baseline** — schema version, capability reporting, fail-closed
   behavior, documentation corrections.
2. **Telemetry contract** — emitted labels, root aggregates, pricing, real
   recorder fixture, infra-name validator.
3. **Checkpoint completeness** — exact payload capture, redaction/limits,
   validator, offline replay.
4. **Runner contract** — configured HTTP runner, reference implementation,
   idempotency, timeout, lineage.
5. **Mutation proof** — one PR per exposed mutation only where behavior differs;
   include positive and negative tests.
6. **Incident loop** — trace/log alert, authenticated/deduplicated webhook,
   evidence-backed resolution, meta-metrics.
7. **Truthful surfaces** — compare, Studio states, dashboards, accessibility.
8. **Hardening** — API auth, CORS/bind defaults, migrations, readiness, secret
   canary.
9. **Distribution** — doctor/provision/demo flow, deployment docs, live
   integration suite, release artifacts.

Each PR must leave the product honest: a partially delivered capability remains
disabled until its acceptance gate passes.

## 14. Effort and milestone forecast

Planning range for one engineer already familiar with the repository:

| Milestone | Phases | Expected effort |
| --- | --- | ---: |
| Honest observability foundation | 0–2 | 6–9 engineering days |
| Real fork and verified incident loop | 3–4 | 8–12 engineering days |
| Product surfaces and security | 5–6 | 6–9 engineering days |
| Install, end-to-end proof, release | 7–8 | 5–8 engineering days |
| **Total** |  | **25–38 engineering days** |

This is a planning range, not a calendar promise. The largest uncertainty is
the resume contract required by the first real target agent runtime. Do not
reduce that uncertainty by falling back to a mock; narrow the supported runtime
instead.

## 15. Post-v1 backlog

Add only after the release gates are met and usage proves the need:

- asynchronous/distributed fork jobs for runs that exceed the bounded
  synchronous request;
- more agent-framework adapters;
- explicit approval workflows for live side-effecting tools;
- multi-organization RBAC and hosted deployment;
- automatic diagnosis or LLM-judged output quality;
- broad SigNoz version support;
- MCP integrations and external incident-management systems.
