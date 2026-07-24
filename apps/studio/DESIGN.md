<!--
THESIS: A forensic workbench for finding the exact point an agent run diverged.
OWN-WORLD: Graphite console, system typography, translucent structural chrome, amber failure signal, green resolution signal.
STORY: Queue the incident, isolate the trace, inspect evidence, fork the failed step, compare the outcome.
FIRST VIEWPORT: Persistent navigation and system health frame a dense incident queue or causal trace—no marketing chrome.
FORM: Desktop mission-control shell; compact responsive workspace on narrow screens.
-->

# Hindsight Studio — Forensic Workbench

## North star

Hindsight is an operations instrument, not a generic SaaS dashboard. It should feel like a
well-made aerospace console: dense, calm, exact, and trustworthy under pressure. The
interface keeps structure dark and quiet so the causal path is easy to scan. Apple-style
physical feedback and material hierarchy make controls feel immediate without turning the
product into decorative glass. Amber is the single active signal for failure, selection, and
the fork that answers it. Green means only verified success or resolution.

The product story is always visible: **Record → Replay → Fork → Compare → Resolve**.

## Tokens

```css
--bg: #0b0c0d;
--panel: #111315;
--panel-raised: #17191c;
--panel-soft: #1d2023;
--ink: #f0eee8;
--muted: #a7a9ac;
--faint: #85878a;
--line: #2b2e31;
--line-strong: #404448;
--signal: #d89548;
--signal-strong: #f0aa59;
--signal-wash: #2d2115;
--ok: #7bb890;
--ok-wash: #16251c;
--danger: #e07d62;
--radius-control: 10px;
--radius-surface: 14px;
--radius-overlay: 18px;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

## Typography

- **Interface:** The platform system stack (`-apple-system`, BlinkMacSystemFont, Segoe UI).
  Optical sizing, native metrics, and familiar weight transitions take priority.
- **Instrumentation:** JetBrains Mono, system mono fallback. Use for trace IDs, time, cost,
  tokens, state labels, code, and controls—not for prose.
- Page title: 24–28px / 650.
- Section title: 13–15px / 600.
- Body: 13–14px / 1.5.
- Instrument label: 10–11px / 600; tracking no wider than `0.08em`.
- Data: 11–12px / 1.45.

## Layout

- Desktop uses a persistent 216px navigation rail and a full-height workspace.
- Content width is fluid; operational data is never squeezed into a centered landing-page column.
- Screens have a compact header, one primary work surface, and border-led groupings.
- Run detail keeps the scrubber pinned beneath the app bar; the causal transcript reads as
  one connected trace rather than a stack of unrelated cards.
- Below 880px the rail becomes a horizontal app bar, tables become scrollable, compare grids
  collapse, and controls wrap without hiding product-critical information.

## Components

### Navigation

The rail contains the wordmark, Record/Replay navigation, current engine state, fleet health,
and the SigNoz escape hatch. Active navigation is a quiet raised row with a 2px amber marker.

### Surfaces

Use tonal panels and 1px hairlines. The rail and sticky trace controls use dark translucent
materials because they structurally overlap the workspace; ordinary cards remain opaque.
Shadows are reserved for dialogs, popovers, and toasts. Controls use a 10px radius, work
surfaces 14px, and overlays 18px. Avoid pill-shaped containers except for compact statuses.

### Buttons

- Primary neutral: warm white fill, graphite text.
- Fork/action signal: amber fill, graphite text; at most one prominent amber action per view.
- Secondary: transparent or raised graphite with a hairline.
- Minimum touch target: 36px desktop, 44px mobile.

### Tables and queues

Rows are separators, not individual cards. Headers are mono instrument labels. Hover and focus
raise contrast without adding shadows. Status and failure cells get the color, not the entire row.

### Trace

The trace rail is the signature component. LLM steps are circles; tool steps are squared. A
hairline connects steps. Selected and failed states use amber; successful tool calls remain
neutral unless success is the information being compared.

### Data and diffs

JSON, prompts, outputs, and diffs live on the darkest inset surface. Additions use green;
removals and execution errors use warm red; selected evidence uses amber. Never use decorative
syntax colors that compete with incident state.

## Interaction

- Keyboard trace controls remain first-class: arrows move, `f` forks, `g` jumps to failure.
- Focus rings are 2px amber with visible offset.
- Controls respond on pointer-down with a subtle scale or translation and recover immediately.
- Floating materials enter and exit along the same path using a critically damped feel.
- Honor `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.
- Native controls and Base UI primitives provide semantics, focus management, and escape behavior.

## Content

Use forensic verbs: inspect, replay, fork, compare, resolve. Keep product claims honest:
reconstruction is explicit, SigNoz remains the system of record, and local fixture data is
labeled. Do not invent customers, performance claims, or live-system certainty.

## Non-negotiables

- No cream paper, decorative glass, gradients, blue/purple cyberpunk, floating-card grids, or landing-page spacing.
- Translucency is reserved for functional overlapping chrome; never stack translucent surfaces.
- No color used only for decoration.
- No ambiguous icon-only action without an accessible name.
- Never conceal trace IDs, run state, failure location, or source-system access.
