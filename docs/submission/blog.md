# From Autopsy to Time Machine: Replaying and Forking AI Agents with SigNoz

When an AI agent fails, the trace usually tells me *where* it happened. That is
useful, but it leaves the expensive question unanswered: if I change the bad
tool result, prompt, or model setting, does the agent actually recover?

I built **Hindsight** to answer that question. It is a flight recorder for AI
agents that records a run into SigNoz, reconstructs a checkpoint without live
calls, and forks the real registered runtime from one chosen step. The original
run stays immutable. The fork becomes a counterfactual experiment with its own
trace, and Hindsight resolves the incident only after the evidence proves that
the experiment removed the original failure.

That sounds like a replay debugger. The difficult part was making every word in
that description honest.

## A trace is an autopsy

Agent failures are rarely one bad function call. An agent chooses a tool,
constructs arguments, consumes the result, updates its conversation, and makes
another decision. A timeout or malformed response near the end of that chain
may be caused by something several steps earlier.

A normal trace preserves the timing and parent-child structure, but replay
needs more. It needs the exact request and response payloads, tool call IDs,
arguments, outputs, ordering, agent revision, and evidence that none of those
records were truncated or changed.

My first design mistake was treating replay as "run the agent again while
mocking a few calls." That is not replay. If an unrecorded dependency quietly
runs live, the result is neither reproducible nor safe. Hindsight therefore
separates two operations:

- **Replay** reads recorded responses only and performs zero provider or tool
  calls.
- **Fork** reconstructs state before one step, applies one explicit mutation,
  and resumes through a registered runtime.

The distinction made the architecture simpler and gave each operation a clear
trust boundary.

## SigNoz as the evidence store

Hindsight does not copy agent telemetry into a second analytics database.
SigNoz is the system of record.

Each run is an OpenTelemetry trace. The root span identifies the run, agent,
agent revision, task, final outcome, total steps, token usage, cost, and capture
policy. Child spans represent ordered LLM and tool steps. Fork spans include
the original trace ID, branch point, incident ID, and mutation hash.

![A failed Hindsight run in SigNoz](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-failed-trace.png)

The screenshot shows a controlled malformed-tool failure. The trace has three
spans and two errors. The selected LLM span includes its model, token counts,
cost, step index, schema version, and payload reference.

Full messages and tool outputs do not belong in span attributes. Attribute
size limits make large values unreliable, and huge spans become painful to
query. Hindsight writes each payload as an OpenTelemetry log record correlated
to the same trace and span. Every record contains a SHA-256 hash, byte count,
redaction flag, truncation flag, schema version, and payload reference.

![Payload and failure logs correlated to the trace](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-correlated-logs.png)

The logs preserve the exact LLM request and response, the tool arguments and
malformed output, and the `run_failed` event. This gave me a useful rule:
**spans describe the path; correlated logs preserve the replay evidence.**

## Fail closed instead of faking a replay

Before replaying, Hindsight builds an ordered run graph from SigNoz spans and
payload logs. It checks that every step has the expected payload, that hashes
match, that tool calls retain their IDs and occurrence order, and that the
recording is complete.

If a payload was redacted, truncated, deleted by retention, or modified,
replay returns a structured checkpoint error. It never falls through to a live
model or tool. This is less convenient than "best effort," but it is the only
behavior I would trust during incident response.

The recorder supports three payload modes. `off` avoids storing sensitive
content. `redacted` is the safe default for real systems. `full` is used by the
local demonstration because a complete payload is required for a fork.
Operators have to choose retention and privacy policy deliberately; Hindsight
does not pretend that raw agent messages are harmless.

## Observing the fleet, not just one trace

The same recorder emits metrics for run outcomes, step duration, tool errors,
loop score, tokens, and cost. The replay engine adds incidents, fork attempts,
and verified-resolution duration.

![Hindsight metrics in SigNoz](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-metrics.png)

Two dashboards ship as JSON:

- **Agent Reliability** groups success rate, incidents, p95 step latency, and
  tool error rate by agent.
- **Hindsight Ops** measures incidents opened, forks executed, and the time
  until a fork is verified.

This changed the product story. Hindsight is not only a debugger for one trace.
It also measures whether the debugging workflow is improving agent reliability
and resolution time.

## From a SigNoz alert to a testable incident

The recorder emits trace-correlated `run_failed` and `loop_detected` log
events. SigNoz rules group those events by trace ID, run ID, agent ID, and
failure type. An authenticated webhook sends the firing alert to Hindsight,
which deduplicates deliveries and opens one incident anchored to the trace.

Aggregate cost and latency alerts deliberately do not invent trace incidents.
A fleet metric can indicate that something is wrong, but it does not provide
an authoritative run ID. Those rules remain notifications until an operator
selects a real trace.

This is a small design decision with an important consequence: the incident
screen never claims more evidence than SigNoz supplied.

## Forking one variable

A fork request identifies the original trace, branch step, mutation, mock
policy, optional incident, and idempotency key. The replay engine sends a
complete checkpoint to a configured runner—not a callback URL supplied by the
browser.

The runner rejects the request if the recorded agent revision does not match.
Recorded tools are matched by name, normalized argument hash, and occurrence.
In strict mode, every required tool result must already exist. A tool declared
safe may run in hybrid mode, but side-effecting tools never execute live.

For the demonstration, I use a tool-output override: replace the malformed
result at the failed step, then resume the same agent loop. The fork emits a
new trace with an OpenTelemetry span link to the original.

## A green response is not proof

The most important part of Hindsight is what happens after the fork succeeds.
The engine queries both traces from SigNoz and verifies:

1. the original trace contains the incident's failure condition;
2. the fork links to the original trace and exact branch point;
3. the fork carries the same incident ID and mutation hash;
4. the registered runner revision matches;
5. the fork outcome is successful; and
6. the original failure is absent from the fork.

Only that verification path can mark an incident resolved. A manual status
update cannot do it, and a resolved Alertmanager notification cannot do it.
If telemetry arrives late or any evidence disagrees, the incident returns to
open with the failed verification reason.

## What I learned

The hardest part was not drawing the trace timeline. It was preserving honest
boundaries between recorded data, fixture data, replay, and execution.

Three lessons survived every redesign:

- Observability becomes more useful when it drives a constrained action, not
  merely another visualization.
- Replayability is a data-integrity property. Missing evidence must be visible,
  not patched over with live calls.
- Incident resolution should be an evidence-backed state transition, not a
  button.

Hindsight now builds successfully, its telemetry configuration is validated
against a shared contract, and 80 automated checks cover recording, payload
policy, graph reconstruction, replay, mutation validation, webhook parsing,
deduplication, responsive layout, sorting, provisioning, and verified
resolution.

The result is the workflow I wanted at the start: **Record. Replay. Fork. Prove
the fix.** SigNoz supplies the evidence; Hindsight turns it into a controlled
counterfactual.

---

Repository: https://github.com/piyushpradhan/hindsight

AI coding assistants helped with implementation, testing, design review, and
editing. The architecture, technical decisions, integration verification, and
final text were reviewed and owned by the author.
