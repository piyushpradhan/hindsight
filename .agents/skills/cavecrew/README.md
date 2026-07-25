# cavecrew

Decision guide. When to delegate to caveman subagents instead of doing the work inline.

## What it does

Tells the main thread when to spawn a caveman-style subagent instead of the standard version. Subagent results enter the main context verbatim, so shorter output leaves more room for the rest of the task. Caveman output measures roughly one-third the size of the standard prose.

Three subagents:

| Subagent | Job | Use when |
|----------|-----|----------|
| `cavecrew-investigator` | Locate code (read-only) | "Where is X defined / what calls Y / list uses of Z" |
| `cavecrew-builder` | Surgical edit, 1-2 files | Scope is obvious, ≤2 files. Refuses 3+ file scope. |
| `cavecrew-reviewer` | Diff/file review | One-line findings with severity emoji |

Use vanilla `Explore` or `Code Reviewer` when you want prose, architecture commentary, or rationale. Use main thread directly for one-line answers and 3+ file refactors.

This skill is a decision guide, not a slash command. It activates when the conversation mentions delegation.

## How to invoke

Triggers on phrases like "delegate to subagent", "use cavecrew", "spawn investigator", "save context", "compressed agent output".

## Example chaining

Locate → fix → verify (most common):

1. `cavecrew-investigator` returns a site list (`path:line | symbol | note`)
2. Main thread picks 1-2 sites, hands paths to `cavecrew-builder`
3. `cavecrew-reviewer` audits the resulting diff

Parallel scout: spawn 2-3 `cavecrew-investigator` calls in one message with different angles (defs, callers, tests). Aggregate in main.

## Model overrides

By default, `cavecrew-reviewer` and `cavecrew-investigator` pin `model: haiku` in their frontmatter; `cavecrew-builder` has no `model:` line (uses the API session default). Set env vars in your shell before launching Claude Code to override per-agent:

| Env var | Agent |
|---|---|
| `CAVECREW_REVIEWER_MODEL` | `cavecrew-reviewer` |
| `CAVECREW_BUILDER_MODEL` | `cavecrew-builder` |
| `CAVECREW_INVESTIGATOR_MODEL` | `cavecrew-investigator` |

Example: run reviewer on sonnet, keep others on default:

```sh
export CAVECREW_REVIEWER_MODEL=sonnet
```

Use the same model name strings you'd use in any Claude Code agent frontmatter (e.g. `haiku`, `sonnet`, `opus`).

Overrides patch only the `model:` line in the installed agent's frontmatter and leave the prompt body open to upstream updates. This applies to plugin installs only; standalone hook installs have no local agent files to patch. Unset or blank = no change. The patch remains until an update or reinstall replaces the file.

## See also

- [`SKILL.md`](./SKILL.md): full decision matrix and output contracts
- [`agents/cavecrew-investigator.md`](../../agents/cavecrew-investigator.md)
- [`agents/cavecrew-builder.md`](../../agents/cavecrew-builder.md)
- [`agents/cavecrew-reviewer.md`](../../agents/cavecrew-reviewer.md)
- [Caveman README](../../README.md): repo overview
