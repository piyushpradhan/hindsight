# Three-minute demo script

Target: 2:45–2:55, 16:9, 1080p, screen recording with voiceover and captions.
Record the live system with `?mock=0`; never show fixture mode.

## Before recording

- Run `make doctor`, then `make demo`.
- Open SigNoz's failed run, correlated logs, metrics, dashboards, and alert rule
  in separate tabs.
- Open Hindsight's live incident queue and the target incident.
- Increase browser zoom only enough to keep text readable.
- Hide bookmarks, notifications, tokens, email addresses, and unrelated tabs.

## Beat sheet

### 0:00–0:18 — The problem

**Screen:** Hindsight landing page, then the failed Taskline request.

**Narration:**
"AI agent failures are paths, not isolated errors. A trace can show me where an
agent failed, but it cannot answer the question I actually care about: if I
change one input, does the agent recover? Hindsight turns that recorded trace
into a safe, testable branch."

### 0:18–0:42 — Architecture

**Screen:** README architecture diagram.

**Narration:**
"The agent records every run with OpenTelemetry. SigNoz holds the traces, the
payload logs, and fleet metrics. Trace-correlated alerts open Hindsight
incidents. Hindsight reconstructs the checkpoint, while a registered runner is
the only component allowed to execute a fork."

### 0:42–1:18 — SigNoz is the system of record

**Screen:** Failed trace → Logs tab → Metrics summary → dashboards.

**Narration:**
"Here is a real failed run in SigNoz. Each LLM and tool step has a stable index,
cost, token counts, and a payload reference. Full messages and tool I/O live in
correlated logs instead of oversized span attributes. The same recorder emits
reliability, latency, loop, token, and cost metrics. SigNoz is not bolted onto
the demo; it is where Hindsight reads the run back from."

### 1:18–1:40 — Detection becomes an incident

**Screen:** Firing `Hindsight: recorded run failed` alert → live Hindsight
incident queue.

**Narration:**
"A SigNoz log alert groups the failure by trace and sends an authenticated
webhook. Hindsight deduplicates it and opens an incident anchored to that exact
trace—no copied telemetry and no seeded incident."

### 1:40–2:15 — Replay and fork

**Screen:** Incident run detail → failed tool step → replay → tool output
override → Fork.

**Narration:**
"Replay traverses captured responses only. It rejects missing, redacted,
truncated, or tampered evidence instead of silently calling a live dependency.
At the failed tool step, I replace one bad result and fork. The registered
runtime checks the exact agent revision, rebuilds the checkpoint, and resumes
the real loop. Side-effecting recorded tools stay mocked."

### 2:15–2:42 — Prove the fix

**Screen:** Compare view → linked fork trace in SigNoz → resolved incident.

**Narration:**
"A successful response is not enough. Hindsight verifies the fork's span link,
incident ID, mutation hash, runner revision, successful outcome, and absence of
the original failure. Only then does the incident move to resolved. The
comparison and both SigNoz traces remain as the proof."

### 2:42–2:55 — Close

**Screen:** Hindsight landing page and GitHub URL.

**Narration:**
"Hindsight turns observability from an autopsy into a time machine: record,
replay, fork, and prove the fix."

## Export check

- Duration is no more than 3:00.
- Captions are burned in or uploaded to YouTube.
- The YouTube link is public or unlisted and works in a private window.
- Description links to the repository and project blog.
