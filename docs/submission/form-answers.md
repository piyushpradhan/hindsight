# Agents of SigNoz submission

Use this as the source of truth while filling the form. Replace the two
publication links before submitting.

## Email

`piyushpradhan3.14@gmail.com`

## Team name

`Hindsight`

## Person submitting

`Piyush Pradhan`

## Track

**Track 1: AI & Agent Observability**

## Project description

Hindsight is a flight recorder for AI agents that turns observability evidence
into a safe debugging action. It records each run as OpenTelemetry traces,
stores replayable messages and tool I/O as correlated logs, and measures agent
reliability, latency, token usage, loops, and cost with metrics. When SigNoz
detects a failed or looping run, its alert opens a trace-anchored Hindsight
incident. An engineer can replay the captured checkpoint without making live
provider or tool calls, change one input, and fork the real registered agent
runtime. Hindsight resolves the incident only after it verifies the new trace's
lineage, mutation proof, successful outcome, and removal of the original
failure. The result is an immutable before-and-after record of a fix rather
than a guess based on a dashboard.

AI coding assistants were used for implementation, testing, design review, and
documentation. The architecture, decisions, integration verification, and
submitted result were reviewed and owned by the project author.

## GitHub

https://github.com/piyushpradhan/hindsight

## Deployed project

Leave blank unless the complete SigNoz-backed system is publicly reachable.
The field is optional; do not submit a static frontend that cannot run the
workflow.

## YouTube demo

`[YOUTUBE LINK]`

## How SigNoz is used

SigNoz is Hindsight's system of record, not an auxiliary dashboard. Agents emit
versioned OpenTelemetry spans containing run identity, ordered step metadata,
tool hashes, token usage, cost, outcome, and fork lineage. Full LLM messages and
tool inputs/outputs are emitted as payload log records correlated by trace ID
and span ID, keeping spans queryable while preserving the evidence required for
replay. Metrics track run outcomes, tool errors, loop score, step latency,
tokens, cost, incidents, forks, and verified-resolution duration. Two
config-as-code dashboards cover agent reliability and Hindsight operations.
Trace-correlated SigNoz log alerts send authenticated webhooks that open
deduplicated Hindsight incidents. After a fork, Hindsight queries the original
and linked fork traces from SigNoz and resolves the incident only when the
recorded evidence proves the mutation fixed the original failure.

## Project blog

`[PUBLISHED BLOG LINK]`

## Hackathon experience

The hackathon changed how I think about observability for agents. My first
instinct was to build a richer trace viewer, but the useful question was not
"what failed?"—SigNoz already answered that. The harder question was "can I
change one input and prove what would have happened?" Building Hindsight forced
me to treat telemetry as evidence with integrity requirements: payloads needed
hashes and completeness flags, replay had to make zero live calls, forks needed
explicit lineage, and an alert recovery alone could not count as a fix. The
most valuable lesson was that deep observability is not more charts; it is a
trustworthy chain from detection to action to verified outcome.
