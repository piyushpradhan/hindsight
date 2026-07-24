---
target: Studio app UI (apps/studio)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-07-23T18-36-22Z
slug: apps-studio-src-app-tsx
---
# Design Critique — Hindsight Studio (app UI)

**Method: dual-agent** (A: design review · B: detector + browser overlay evidence, run in isolation)
**Surface mode:** Operate (task completion — scanability, consistency, native expectations outrank expression)
**Judged against the *running* app**, which is a warm "flight-recorder" system (paper `#F6F2EA`, ember `#C1440E`, JetBrains Mono + Inter, forest-green success) — **not** the Apple/#f5f5f7 revamp the project memory described. The memory was stale; both the source and the live page confirm the warm theme.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Engine dot + mock pill + per-step latency/cost are excellent; scrubber "selected" state and transcript scroll can desync, no "you are here" marker in the transcript itself. |
| 2 | Match System / Real World | 4 | Domain language is precise and correct: traces, spans, steps, mutations, counterfactual, dry-run stub. |
| 3 | User Control and Freedom | 3 | `←/→/f` scrubbing is great; but no undo after an incident status transition, no breadcrumb back from Compare to the incident. |
| 4 | Consistency and Standards | 3 | Mostly tight; but mutation tabs render raw enums (`tool_output_override`) amid prose, and radio "pills" vs mutation "tabs" look near-identical yet behave differently. |
| 5 | Error Prevention | 2 | "Run fork" and all incident status changes have no confirmation and no reassurance; under `live` policy fork can make real model calls / side-effects unguarded. JSON override only validates on submit. |
| 6 | Recognition Rather Than Recall | 3 | Fork panel pre-fills current values (good); but "Resolve via fork" makes you hand-paste a fork trace id — pure recall. |
| 7 | Flexibility and Efficiency | 3 | `←/→/f` shortcuts are a real power win; but no jump-to-failed-step, no command palette, no filter/search on Incidents or Runs tables. |
| 8 | Aesthetic and Minimalist | 3 | Restrained and confident; but every step card auto-expands full request/response JSON, so the failure page is enormous. No progressive disclosure. |
| 9 | Error Recovery | 3 | `friendlyError` gives title+hint; but fork-panel form errors are plain red text at the bottom of a tall form, easy to miss. |
| 10 | Help and Documentation | 2 | Empty state teaches the SDK (excellent) and the kbd-hint helps; but no persistent help, no legend for the circle-vs-square scrubber language, no cost explanation of strict/hybrid/live until selected. |
| **Total** | | **29/40** | **Good** — above-average Operate surface; losses cluster in error-prevention/reassurance (H5) and help (H10). |

## Design Specificity Verdict — **AUTHORED** (with one soft spot)

**LLM assessment:** This is not a reskinned admin dashboard; it was designed for an agent replay+fork debugger.
- **Step scrubber** encodes a domain distinction in *geometry*: tool steps are square, LLM steps are circular — reasoning vs. side-effect, not just color. Failed step pulses an ember halo; the strip is sticky-pinned so you can scrub a long transcript from anywhere.
- **Fork panel** is genuinely product-specific: five mutation types with tailored inputs, a strict/hybrid/live mock-policy selector with honest-replay hints ("side-effectful tools return a dry-run stub"), and it *pre-selects `tool_output_override` and pre-fills the malformed JSON* when you fork a failed tool step.
- **Compare screen** is the strongest: a verdict headline ("failure → success"), delta stats colored by *desirability* (negative cost = green), an aligned CHANGED/ADDED/REMOVED diff, and an output diff of the actual corrected answer. This is "change the input, not just read the output" made visual.
- **Copy is written for this product**: "replay is free — no model calls, $0.00", "state is rebuilt up to (not including) this step."

**The soft spot:** the fork is authored but not the visual *protagonist*. Its trigger is `btn-ghost btn-sm` — the quietest style in the system, identical to "Postmortem." The failed step gets an ember pulse; the action that fixes it gets grey ghost chrome.

**Deterministic scan (detector CLI + browser overlay):**
- CLI (`detect.mjs` on `apps/studio/src`, exit 2): **4× `side-tab`** — `border-left: 3px solid ember` at `styles.css:118` (`.error-note`), `:311` (`.step-card.failed`), `:387` (`.form-error`), `:441` (`.mini-step.err`). All four are semantically scoped to *error/failure* states, not decorative accents on neutral cards — a milder form of the flagged pattern, but literally the shape.
- Browser overlay (4 routes): **low-contrast is the dominant runtime finding** — `--faint #9c9284` on paper measures **2.7:1 (needs 4.5:1)** across `.inc-notes`, `.kbd-hint`, `.d-label`, and on `/compare` `3.0:1` on raised surfaces. `/runs/:id` flagged 40 elements (25 low-contrast, 11 over-long lines, 3 side-tab, 1 tiny-text); `/compare` flagged 32 (27 low-contrast, 2 all-caps-body, 2 side-tab, 2 cramped-padding, 2 tiny-text). Also: transcript prose `.msg-text` runs **~147 chars/line** (aim <80); `.kbd-hint` is 10.5px and `.cell-empty` 11px; `.compare-col-head` uppercases body text.
- **False positive (in spirit):** `cream-palette` fires on `<body>` every route — that is the deliberate flight-recorder POV, not slop. Worth noting only because there is no committed `DESIGN.md` pinning the palette, so a detector reads it as a generic "cream AI background" tell.

**Where they agree:** the design review independently flagged `--faint` on paper as a contrast risk; the overlay quantified it at 2.7:1 across many elements — this is the most confirmed issue in the run. **Detector caught what the review missed:** exact contrast ratios, the ~147-char transcript line length, all-caps body on compare headers, cramped empty-cell padding.

## Overall Impression

Confident, genuinely authored work with a strong POV and a best-in-class payoff screen (Compare). The interface *earns anxiety* at a failure and *rewards* resolution. Two things hold it back from excellent: **the product's defining action (fork) is its faintest button**, and **the scariest click (Run fork, possibly live) is completely unguarded**. The single biggest opportunity is to make the fork the visual and emotional protagonist of the run-detail page — and to reassure the user at the moment they pull the trigger.

## What's Working

1. **The scrubber's geometric encoding + sticky pinning** (`StepScrubber.tsx`, `styles.css:236-305`) — circle=LLM, square=tool teaches the run's shape at a glance and survives long transcripts. This is where the brand correctly lives: in a precise, load-bearing detail.
2. **The Compare screen as a decision artifact** (`CompareScreen.tsx`) — delta stats colored by desirability, the aligned CHANGED/ADDED/REMOVED grid, and the red/green output diff turn "did the fix work?" into a two-second read.
3. **Fork panel context-awareness** (`ForkPanel.tsx:45-63`, `POLICY_HINTS`) — pre-selecting `tool_output_override`, pre-filling the failed step's malformed JSON, and being honest about strict/hybrid/live side effects shows real understanding of the debugging loop.

## Priority Issues

- **[P1] The fork trigger is the quietest control in the system.**
  *Why it matters:* Fork is the product's entire reason to exist; the incident→fork→resolved spine dies if users don't reach for it. It's `btn-ghost btn-sm`, indistinguishable from "Postmortem," while the failed step gets an ember pulse.
  *Fix:* Make the fork trigger the primary/ember action on the *selected* (and especially failed) step — larger, ember, a "→ fork" chevron; surface a "Fork to fix this" CTA in/beside the run-error banner; demote Postmortem/status buttons to ghost.
  *Suggested command:* `$impeccable bolder`

- **[P1] "Run fork" has no reassurance or guard — dangerous under `live` policy.**
  *Why it matters:* For a 3am on-call this is the scariest click, and under `live` it can call real models and hit real side-effects with no confirm, no cost preview, no dry-run affirmation. The reassurance vocabulary ("$0.00", "dry-run stub") exists elsewhere but isn't deployed at the trigger.
  *Fix:* Inline reassurance at the button — strict/hybrid: "Free · no live calls · ~$0.00"; `live`: an explicit amber confirm ("runs live model calls and may hit real side-effects") plus a projected cost/step count before running.
  *Suggested command:* `$impeccable harden`

- **[P1] Faint text fails WCAG AA contrast, widely.**
  *Why it matters:* `--faint #9C9284` on `--paper #F6F2EA` = 2.7:1 (needs 4.5:1), used for timestamps, kbd-hints, delta labels, "not present in original," and empty cells — often at 10.5–11px mono, which compounds it. Confirmed by both the design review and the runtime overlay (25–27 elements per data-heavy route). Low-vision and 3am-tired users can't read the metadata.
  *Fix:* Darken `--faint` to ≥4.5:1 on both `--paper` and `--paper-raise` (roughly `#6E655A`-ish territory, i.e. merge toward `--muted`); raise the smallest mono text off 10.5px; reserve the lightest tone for non-essential decoration only.
  *Suggested command:* `$impeccable typeset` (legibility cluster: contrast + tiny-text + 147-char transcript lines + all-caps headers)

- **[P2] No progressive disclosure on the run transcript.**
  *Why it matters:* Every step renders full request/response JSON, so the failure page is enormous and the failed step is below the fold — the one thing the on-call needs is the farthest down. Fails cognitive-load "one-thing-at-a-time" and "progressive disclosure."
  *Fix:* Collapse step cards to their head row by default (index/kind/name/latency/cost/error); expand the selected step and auto-expand + scroll-to the first failed step on load; truncate JSON with "show full payload."
  *Suggested command:* `$impeccable distill`

- **[P2] Incident status changes are unguarded, and the Actions column has no primary.**
  *Why it matters:* "Dismiss"/"Mark diagnosed" fire instantly with no toast or undo (H3/H5); the Actions column stacks up to 4 equal-weight verbs that wrap to two rows, with no clear primary.
  *Fix:* Add an undo toast on transition; collapse secondary actions into an overflow "⋯" menu leaving one primary verb per row (for an open incident, "Resolve via fork").
  *Suggested command:* `$impeccable harden`

## Persona Red Flags

**Alex (power user):** no jump-to-failed-step (`←/→` walks all steps one at a time); no search/filter on Incidents or Runs tables; mock-policy default `hybrid` can't be set per-session; no deep-link to a specific step (`/runs/:id#step-5`) to share "look at step 5."

**Sam (accessibility):** color-only status in delta stats (green/red + only a `+/-` sign); `--faint` contrast fails AA (above); scrubber uses `role="tablist"/"tab"` but the transcript cards aren't wired as `tabpanel`s (half-built ARIA); modals close on backdrop click with no visible focus trap or `role="dialog"`/`aria-modal`; circle/square LLM-vs-tool distinction is unlabeled.

**On-call engineer at 3am (project persona):** must scroll past ~6 fully-expanded steps to reach the failure and its fork button (P2); the resolving action (fork) is styled identically to the documenting action (postmortem) (P1); the scariest click ("Run fork" under `live`) is unguarded (P1); if a fork *doesn't* fix it, there's no "try a different mutation" loop — the panel doesn't remember or diff prior attempts.

## Minor Observations

- Mutation tabs show raw enums (`tool_output_override`) — should be prose ("Override tool output"). (`$impeccable clarify`)
- `f`-to-fork toggles the panel but doesn't scroll it into view if the selected step is off-screen.
- "Resolve via fork" asks you to hand-paste a fork trace id (P3) — the app just ran the fork and knows the id; pre-fill or offer a picker.
- `side-tab` left-borders are semantically scoped to error states (milder than the canonical accent-stripe tell), but four instances is enough to read as a system habit — consider one shared error-surface treatment.
- Genuinely complete state coverage (empty vs loading vs error, empty-incidents onboarding) — rare and worth keeping.
- The mock pill + engine dot are clean "honest replay" hygiene at the chrome level.

## Questions to Consider

1. If the fork is the product, why is its trigger the only button in the system with no color? What if the failed step *opened* into a fork composer instead of requiring a grey button click?
2. The Compare screen is your best screen and your *last* screen. Should run-detail show a live "what-if" fork preview inline, so the payoff isn't a page away?
3. You built strict/hybrid/live with honest cost/side-effect semantics — but never show the *projected* cost before "Run fork." Is honest replay honest if it doesn't tell the user what the button will cost before they press it?
4. For the 3am engineer, is "read the whole transcript" ever the goal? What if the default view were "the failure and the three steps around it," with the full transcript opt-in?
