# Hindsight demo voiceover

Target delivery: calm, confident, 130–140 words per minute. Pronounce **SigNoz** as **“sig-nozz.”**

| Time | Visual | Narration |
|---|---|---|
| 0:00–0:08 | Hindsight landing page | Agent failures are paths. Hindsight returns to the exact failure, changes one thing, and proves whether the agent recovers. |
| 0:08–0:26 | Failed trace in SigNoz | This is a real support-triage run, recorded with OpenTelemetry and inspected in SigNoz. Every model and tool call has a stable step index, latency, token count, cost, and payload reference. The failed span belongs to the original trace—not a reconstruction. |
| 0:26–0:40 | Trace-correlated logs | Full prompts, messages, tool inputs, and outputs stay in trace-correlated logs instead of oversized span attributes. Hindsight uses the trace ID to load the exact evidence required to replay the run. |
| 0:40–0:52 | SigNoz metrics | The same recorder emits fleet-level reliability, latency, loop, token, and cost metrics. SigNoz remains the system of record for both detection and investigation. |
| 0:52–1:08 | Live incident queue | When a SigNoz alert fires, an authenticated webhook opens a deduplicated Hindsight incident anchored to that trace. These are live alert-created incidents, including the support-triage failure we are about to test. |
| 1:08–1:32 | Trace-matched failure in Hindsight | Hindsight reconstructs the causal run and takes us directly to the failed ticket lookup. The recorded tool returned malformed JSON. Replay is evidence-only: if required data is missing, redacted, truncated, or tampered with, Hindsight stops instead of silently calling a live dependency. |
| 1:32–1:50 | Test-a-fix step | From the failed step, I replace only the bad tool result with valid ticket data. The original run stays untouched. A registered runner checks the exact agent revision, rebuilds the checkpoint, keeps side-effecting tools mocked, and resumes the real loop from this point. |
| 1:50–2:14 | Failure-to-success comparison | The fork succeeds. Hindsight compares the original and tested branches, shows the changed output, and preserves both trace IDs. It verifies the span link, incident ID, mutation hash, runner revision, successful outcome, and absence of the original failure before accepting the fix. Both traces remain inspectable in SigNoz. |
| 2:14–2:26 | Architecture | The chain is simple: record with OpenTelemetry, observe and alert in SigNoz, replay in Hindsight, and execute one controlled change through the runner. No copied telemetry, no guesswork. |
| 2:26–2:35 | Outro | Hindsight turns observability from an autopsy into a time machine: record, replay, fork, and prove the fix. |

## Recording notes

- Leave about 0.2 seconds of room at the start and end of each row.
- Record one row per take so timing adjustments are easy.
- Export a mono or stereo 48 kHz WAV file.
- Do not read the visual labels aloud.

## Add the finished narration

```bash
ffmpeg -i docs/demo-video/hindsight-demo-silent.mp4 \
  -i docs/demo-video/voiceover.wav \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -af "apad,atrim=0:155" -t 155 -movflags +faststart \
  docs/demo-video/hindsight-demo-final.mp4
```
