# Hindsight — config-as-code / infra targets.
#
# NOTE: SigNoz itself is NOT managed here. A self-hosted SigNoz already runs at
# http://localhost:8080 and its docker-compose lives under pours/deployment/.
# These targets bring up the Hindsight app layer (replay-engine + studio),
# seed demo data, and open the UIs. Provisioned dashboards/alerts live under
# infra/dashboards and infra/alerts (import into SigNoz once; see README).

# ---- config -----------------------------------------------------------------
SIGNOZ_URL       ?= http://localhost:8080
STUDIO_URL       ?= http://localhost:5173
REPLAY_ENGINE    ?= http://localhost:4123
RUNNER_URL       ?= http://127.0.0.1:4124
HINDSIGHT_RUNNERS ?= {"research":{"url":"$(RUNNER_URL)","revision":"demo-research@1"},"support-triage":{"url":"$(RUNNER_URL)","revision":"demo-support-triage@1"}}
LOG_DIR          ?= .hindsight-logs

# Cross-platform "open a URL" (macOS: open, Linux: xdg-open).
OPEN := $(shell command -v open >/dev/null 2>&1 && echo open || echo xdg-open)

.DEFAULT_GOAL := demo
.PHONY: demo up dev seed down help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# ---- the money target -------------------------------------------------------
# Goal: from zero to a live, seeded demo in under 5 minutes.
demo: up seed ## Install, build, start stack, seed demo data, open UIs (<5 min)
	@echo ""
	@echo "  Hindsight demo is live."
	@echo "  SigNoz (system of record): $(SIGNOZ_URL)"
	@echo "  Studio (record/replay/fork): $(STUDIO_URL)"
	@echo ""
	@$(OPEN) "$(SIGNOZ_URL)" >/dev/null 2>&1 || true
	@$(OPEN) "$(STUDIO_URL)" >/dev/null 2>&1 || true

# ---- thin wrappers ----------------------------------------------------------
up: ## Install deps, build, and start replay-engine + studio in the background
	@echo ">> Assuming SigNoz is already up at $(SIGNOZ_URL) (managed under pours/deployment)."
	pnpm install
	pnpm build
	@mkdir -p $(LOG_DIR)
	@echo ">> Starting reference runner on $(RUNNER_URL) ..."
	pnpm --filter @hindsight/demo-agents runner > $(LOG_DIR)/runner.log 2>&1 &
	@echo ">> Starting replay-engine on $(REPLAY_ENGINE) ..."
	HINDSIGHT_RUNNERS='$(HINDSIGHT_RUNNERS)' pnpm --filter @hindsight/replay-engine start > $(LOG_DIR)/replay-engine.log 2>&1 &
	@echo ">> Starting studio on $(STUDIO_URL) ..."
	pnpm --filter @hindsight/studio dev > $(LOG_DIR)/studio.log 2>&1 &
	@echo ">> Logs in $(LOG_DIR)/ . Give the services a few seconds to bind."

dev: ## Run the whole workspace in watch mode (foreground, all packages)
	pnpm dev

seed: ## Record demo runs; installed SigNoz rules may open incidents from failures
	pnpm --filter @hindsight/demo-agents seed

down: ## Stop the Hindsight app processes started by `up` (leaves SigNoz alone)
	@echo ">> Stopping replay-engine and studio (SigNoz under pours/deployment is untouched)."
	-@pkill -f "@hindsight/replay-engine" 2>/dev/null || true
	-@pkill -f "@hindsight/demo-agents runner" 2>/dev/null || true
	-@pkill -f "@hindsight/studio" 2>/dev/null || true
	-@pkill -f "vite" 2>/dev/null || true
	@echo ">> Done."
