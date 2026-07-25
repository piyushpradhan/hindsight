# Hindsight — config-as-code / infra targets.
#
# NOTE: SigNoz itself is NOT managed here. A self-hosted SigNoz already runs at
# http://localhost:8080 and its docker-compose lives under pours/deployment/.
# These targets bring up the Hindsight app layer (replay-engine + studio + Taskline),
# seed demo data, and open the UIs. Provisioned dashboards/alerts live under
# infra/dashboards and infra/alerts (import into SigNoz once; see README).

-include .env
export

# ---- config -----------------------------------------------------------------
SIGNOZ_URL       ?= http://localhost:8080
SIGNOZ_API_KEY   ?=
SIGNOZ_WEBHOOK_SECRET ?=
STUDIO_URL       ?= http://localhost:5173
REPLAY_ENGINE    ?= http://localhost:4123
RUNNER_URL       ?= http://127.0.0.1:4124
TODO_URL         ?= http://localhost:4174
HINDSIGHT_TODO_PROVIDER ?= ollama
OLLAMA_HOST       ?= http://127.0.0.1:11434
OLLAMA_MODEL      ?= gemma3:1b
HINDSIGHT_RUNNERS ?= {"research":{"url":"$(RUNNER_URL)","revision":"demo-research@1"},"support-triage":{"url":"$(RUNNER_URL)","revision":"demo-support-triage@1"},"codex":{"url":"$(RUNNER_URL)","revision":"codex-hindsight@ac879e5"},"todo-triage":{"url":"$(RUNNER_URL)","revision":"todo-triage@1"}}
LOG_DIR          ?= .hindsight-logs

# Cross-platform "open a URL" (macOS: open, Linux: xdg-open).
OPEN := $(shell command -v open >/dev/null 2>&1 && echo open || echo xdg-open)

.DEFAULT_GOAL := demo
.PHONY: demo doctor up dev seed seed-codex down help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# ---- the money target -------------------------------------------------------
# Goal: from zero to a live, seeded demo in under 5 minutes.
demo: doctor up seed ## Validate, build, start, seed, and open the demo (<5 min)
	@echo ""
	@echo "  Hindsight demo is live."
	@echo "  SigNoz (system of record): $(SIGNOZ_URL)"
	@echo "  Studio (record/replay/fork): $(STUDIO_URL)"
	@echo "  Taskline (AI to-do demo): $(TODO_URL)"
	@echo ""
	@$(OPEN) "$(SIGNOZ_URL)" >/dev/null 2>&1 || true
	@$(OPEN) "$(STUDIO_URL)" >/dev/null 2>&1 || true
	@$(OPEN) "$(TODO_URL)" >/dev/null 2>&1 || true

# ---- thin wrappers ----------------------------------------------------------
doctor: ## Validate local prerequisites and SigNoz credentials
	pnpm doctor

up: ## Install deps, build, and start replay-engine, studio, and Taskline
	@echo ">> Assuming SigNoz is already up at $(SIGNOZ_URL) (managed under pours/deployment)."
	pnpm install
	pnpm build
	@mkdir -p $(LOG_DIR)
	@echo ">> Starting reference runner on $(RUNNER_URL) ..."
	OLLAMA_HOST='$(OLLAMA_HOST)' pnpm --filter @hindsight/demo-agents runner > $(LOG_DIR)/runner.log 2>&1 &
	@echo ">> Starting AI to-do demo on $(TODO_URL) ..."
	HINDSIGHT_TODO_PROVIDER='$(HINDSIGHT_TODO_PROVIDER)' OLLAMA_HOST='$(OLLAMA_HOST)' OLLAMA_MODEL='$(OLLAMA_MODEL)' pnpm --filter @hindsight/demo-agents todo > $(LOG_DIR)/todo.log 2>&1 &
	@echo ">> Starting replay-engine on $(REPLAY_ENGINE) ..."
	@SIGNOZ_API_KEY='$(SIGNOZ_API_KEY)' SIGNOZ_WEBHOOK_SECRET='$(SIGNOZ_WEBHOOK_SECRET)' HINDSIGHT_RUNNERS='$(HINDSIGHT_RUNNERS)' pnpm --filter @hindsight/replay-engine start > $(LOG_DIR)/replay-engine.log 2>&1 &
	@echo ">> Starting studio on $(STUDIO_URL) ..."
	pnpm --filter @hindsight/studio dev > $(LOG_DIR)/studio.log 2>&1 &
	@for url in "$(RUNNER_URL)/hindsight/capabilities" "$(REPLAY_ENGINE)/api/health" "$(STUDIO_URL)" "$(TODO_URL)"; do \
		attempt=0; \
		until curl --fail --silent --max-time 2 "$$url" >/dev/null; do \
			attempt=$$((attempt + 1)); \
			if [ "$$attempt" -ge 40 ]; then echo "Timed out waiting for $$url"; exit 1; fi; \
			sleep 0.25; \
		done; \
	done
	@echo ">> Services ready. Logs in $(LOG_DIR)/."

dev: ## Run the whole workspace in watch mode (foreground, all packages)
	pnpm dev

seed: ## Record demo runs; installed SigNoz rules may open incidents from failures
	pnpm --filter @hindsight/demo-agents seed

seed-codex: ## Record this project's Codex sessions and seed their incident lifecycle
	pnpm --filter @hindsight/demo-agents seed:codex

down: ## Stop the Hindsight app processes started by `up` (leaves SigNoz alone)
	@echo ">> Stopping Hindsight apps (SigNoz under pours/deployment is untouched)."
	-@pkill -f "@hindsight/replay-engine" 2>/dev/null || true
	-@pkill -f "@hindsight/demo-agents runner" 2>/dev/null || true
	-@pkill -f "scripts/todo-server.ts" 2>/dev/null || true
	-@pkill -f "@hindsight/studio" 2>/dev/null || true
	-@pkill -f "vite" 2>/dev/null || true
	@echo ">> Done."
