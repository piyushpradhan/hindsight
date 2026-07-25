# Hindsight: replaying a failed AI agent with SigNoz

SigNoz could already show me the span where an agent failed. What I couldn't
answer from that trace was more useful: if I replaced the bad tool result,
would the rest of the run recover?

I built **Hindsight** during Agents of SigNoz to test exactly that. It records
an agent run in SigNoz, rebuilds the state before a selected step without
calling the model or its tools, then resumes the registered runtime with one
change. The original run stays untouched; the fork gets its own linked trace.
Hindsight only closes the incident after those two traces prove that the
change removed the failure.

Calling it a replay debugger made for a tidy pitch. Making the replay honest
was most of the work.

## A trace wasn't enough

An agent rarely fails in one neat function. It chooses a tool, builds the
arguments, reads the result, updates its conversation, and decides what to do
next. A malformed response near the end may have started with a bad choice
several steps earlier.

A normal trace preserves timing and parent-child relationships. To rebuild a
checkpoint, I also needed the exact requests and responses, tool call IDs,
arguments, outputs, occurrence order, agent revision, and proof that nobody
had truncated or changed the recording.

My first design treated replay as "run the agent again and mock a few calls."
That wasn't replay. One unrecorded dependency could quietly run live, leaving
me with a result I couldn't reproduce or trust. Hindsight now separates the
two jobs:

- **Replay** reads recorded responses and makes no provider or tool calls.
- **Fork** reconstructs the state before one step, applies an explicit
  mutation, and hands the checkpoint to a registered runtime.

The word *replay* now has a hard boundary. If the recording can't support it,
the operation stops.

## SigNoz stores the evidence

I didn't add another analytics database beside the observability stack;
SigNoz stays the system of record.

Every run becomes an OpenTelemetry trace whose root span carries the run and
agent IDs, agent revision, task, outcome, step count, token usage, cost, and
capture policy. Ordered child spans represent model and tool steps; a fork
also records the original trace ID, branch point, incident ID, and mutation
hash.

![A failed Hindsight run in SigNoz](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-failed-trace.png)

This trace comes from the controlled malformed-tool case used in the demo,
with three spans and two errors. On the selected model span, SigNoz shows the
model, token counts, cost, step index, schema version, and payload reference.

Full messages don't fit well in span attributes. Large attributes can hit
size limits, and stuffing raw tool output into every span makes the trace
awkward to query. Hindsight writes each payload as an OpenTelemetry log record
linked to the same trace and span instead. The record carries a SHA-256 hash,
byte count, redaction and truncation flags, schema version, and payload
reference.

![Payload and failure logs correlated to the trace](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-correlated-logs.png)

Those logs hold the exact model request and response, the tool arguments and
malformed output, plus the `run_failed` event. Spans show the route through the
agent; correlated logs hold the material needed to travel it again.

## Missing evidence stops the replay

Before it replays anything, Hindsight builds an ordered run graph from SigNoz
spans and payload logs. It checks every expected payload, recalculates the
hashes, and keeps tool call IDs in their original occurrence order.

If retention removed a payload, a policy redacted it, the recorder truncated
it, or the hash no longer matches, Hindsight returns a checkpoint error. It
doesn't fill the gap with a live model or tool call. "Best effort" would be
convenient here, but it would also make the answer worthless during an
incident.

The recorder has three capture modes for different environments. `off` keeps
sensitive content out of storage, while `redacted` supplies the safer default
for a real deployment. The local demo uses `full` because forking requires the
complete payload. Retention and privacy still belong to the operator; agent
messages aren't harmless just because they sit in an observability system.

## The fleet view

The same recorder emits metrics for outcomes, step duration, tool errors, loop
score, tokens, and cost. Replay adds incident counts, fork attempts, and the
time taken to verify a fix.

![Hindsight metrics in SigNoz](https://raw.githubusercontent.com/piyushpradhan/hindsight/main/docs/assets/signoz-metrics.png)

Two JSON dashboards ship with the project: **Agent Reliability** shows success
rate, open incidents, p95 step latency, and tool error rate by agent, while
**Hindsight Ops** tracks opened incidents, executed forks, and verification
time.

The fleet view answers a different question: which agents keep breaking, and
does this process cut the time between an alert and a proven fix?

## An alert needs a real trace

The recorder sends trace-linked `run_failed` and `loop_detected` log events to
SigNoz. Alert rules group them by trace ID, run ID, agent ID, and failure type.
An authenticated webhook then opens an incident in Hindsight, with
deduplication so repeated deliveries don't create copies.

Cost and latency alerts work differently. A fleet metric can say something
looks wrong, but it can't identify the run that caused it. Hindsight leaves
those alerts as notifications until an operator chooses a trace rather than
inventing an incident ID from aggregate data.

So the incident page only claims what SigNoz can support.

## Change one value, then run the real agent

A fork request names the original trace, branch step, mutation, mock policy,
optional incident, and idempotency key. The replay service sends the rebuilt
checkpoint to a configured runner. It never accepts a callback URL from the
browser.

The runner rejects a checkpoint when its registered agent revision differs
from the recording. It matches recorded tools by name, normalized argument
hash, and occurrence; strict mode requires every tool result to exist already.
Hybrid mode may call a tool marked safe, but it never runs side-effecting tools
live.

In the demo, the chosen mutation replaces a malformed tool result. Hindsight
then resumes the same agent loop, and the new run emits a trace with an
OpenTelemetry span link back to the original. The original trace doesn't
move.

## A successful response doesn't prove the fix

After a fork returns, Hindsight queries both traces from SigNoz and checks:

1. the original trace contains the incident's failure;
2. the fork points to that trace and the selected branch step;
3. its incident ID and mutation hash match the request;
4. the runner used the recorded agent revision;
5. the new run succeeded;
6. the original failure doesn't appear in the fork.

Only this verifier can resolve an incident. A manual status edit can't, and
neither can a recovered Alertmanager notification. When telemetry arrives
late or the evidence disagrees, Hindsight keeps the incident open and shows
the failed check.

## What survived the build

The trace timeline was the easy part. The harder part was keeping recorded
data, demo fixtures, replay, and live execution from blurring together.

Observability became useful once it drove a constrained action, not another
chart. Replay also turned out to be a data-integrity problem: a missing record
must stay missing, where an operator can see it, instead of disappearing
behind a live call. And incident resolution belongs to evidence, not a green
button.

Hindsight now passes 80 automated checks covering the recorder, capture
policy, graph reconstruction, replay, mutations, webhook parsing,
deduplication, interface behavior, provisioning, and verified resolution. Its
telemetry configuration also passes a shared contract check.

The path is now the one I wanted when I started: **record, replay, fork, prove
the fix.** SigNoz holds the evidence, and Hindsight turns one change into a
testable before-and-after result.

---

Repository: https://github.com/piyushpradhan/hindsight

I used AI coding assistants for implementation, tests, design review, and
editing. I reviewed the architecture, technical decisions, SigNoz integration,
and final text, and I own the submitted result.
