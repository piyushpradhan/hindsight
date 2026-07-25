# Hindsight — config-as-code / infra targets.
#
# `make signoz` starts the self-hosted SigNoz stack vendored under
# pours/deployment/. `make demo` brings up the Hindsight app layer
# (replay-engine + studio + Taskline), seeds demo data, and opens the UIs.
# `provision` installs the versioned resources under infra/dashboards and
# infra/alerts through the SigNoz API.
#
# From a clean checkout:  make signoz && make key && make demo

-include .env
export

# ---- config -----------------------------------------------------------------
SIGNOZ_URL       ?= http://localhost:8080
SIGNOZ_API_KEY   ?=
SIGNOZ_WEBHOOK_SECRET ?=
SIGNOZ_WEBHOOK_URL ?= http://host.docker.internal:4123/hooks/signoz
STUDIO_URL       ?= http://localhost:5173
REPLAY_ENGINE    ?= http://localhost:4123
HOST             ?= 127.0.0.1
HINDSIGHT_API_TOKEN ?=
HINDSIGHT_ALLOW_UNAUTHENTICATED_LOCALHOST ?= true
RUNNER_URL       ?= http://127.0.0.1:4124
TODO_URL         ?= http://localhost:4174
HINDSIGHT_TODO_PROVIDER ?= offline
OLLAMA_HOST       ?= http://127.0.0.1:11434
OLLAMA_MODEL      ?= gemma3:1b
HINDSIGHT_RUNNERS ?= {"research":{"url":"$(RUNNER_URL)","revision":"demo-research@1"},"support-triage":{"url":"$(RUNNER_URL)","revision":"demo-support-triage@1"},"codex":{"url":"$(RUNNER_URL)","revision":"codex-hindsight@ac879e5"},"todo-triage":{"url":"$(RUNNER_URL)","revision":"todo-triage@1"}}
LOG_DIR          ?= .hindsight-logs
SIGNOZ_COMPOSE   ?= pours/deployment/compose.yaml

# Cross-platform "open a URL" (macOS: open, Linux: xdg-open).
OPEN := $(shell command -v open >/dev/null 2>&1 && echo open || echo xdg-open)

.DEFAULT_GOAL := demo
.PHONY: demo signoz signoz-down env key doctor provision provision-dry-run up dev seed seed-codex down help

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---- SigNoz stack -----------------------------------------------------------
signoz: ## Start the vendored SigNoz stack and wait for it to answer
	docker compose -f $(SIGNOZ_COMPOSE) up -d
	@printf ">> Waiting for SigNoz at $(SIGNOZ_URL) (first run pulls images and migrates ClickHouse) "
	@attempt=0; \
	until curl --fail --silent --max-time 2 "$(SIGNOZ_URL)/api/v1/version" >/dev/null; do \
		attempt=$$((attempt + 1)); \
		if [ "$$attempt" -ge 300 ]; then \
			echo ""; \
			echo "Timed out waiting for $(SIGNOZ_URL). Check: docker compose -f $(SIGNOZ_COMPOSE) logs"; \
			exit 1; \
		fi; \
		printf "."; \
		sleep 2; \
	done
	@echo ""
	@echo ">> SigNoz ready at $(SIGNOZ_URL)"

signoz-down: ## Stop the vendored SigNoz stack (telemetry volumes are kept)
	docker compose -f $(SIGNOZ_COMPOSE) down

# ---- credentials ------------------------------------------------------------
# `env` is silent and non-interactive so `demo` can depend on it. `key` is the
# one step that needs a human, because SigNoz mints API keys only from its UI.
env: ## Create .env from the template and generate the webhook secret if unset
	@test -f .env || { cp .env.example .env; echo ">> Created .env from .env.example."; }
	@if ! grep -qE '^SIGNOZ_WEBHOOK_SECRET=.+' .env; then \
		secret=$$(openssl rand -hex 16); \
		grep -v '^SIGNOZ_WEBHOOK_SECRET=' .env > .env.tmp && mv .env.tmp .env; \
		echo "SIGNOZ_WEBHOOK_SECRET=$$secret" >> .env; \
		echo ">> Generated SIGNOZ_WEBHOOK_SECRET."; \
	fi

key: env ## Capture a SigNoz API key into .env (opens the UI, prompts for a paste)
	@if grep -qE '^SIGNOZ_API_KEY=.+' .env; then \
		echo ">> SIGNOZ_API_KEY is already set in .env."; \
	else \
		echo ""; \
		echo "  SigNoz mints API keys from its UI only. In $(SIGNOZ_URL):"; \
		echo "    1. Create the first account if this is a fresh install."; \
		echo "    2. Settings -> API Keys -> New Key (role: Admin)."; \
		echo "    3. Copy the key."; \
		echo ""; \
		$(OPEN) "$(SIGNOZ_URL)/settings/api-keys" >/dev/null 2>&1 || true; \
		printf "  Paste the SigNoz API key: "; \
		read -r pasted; \
		if [ -z "$$pasted" ]; then echo "  No key entered; .env unchanged."; exit 1; fi; \
		grep -v '^SIGNOZ_API_KEY=' .env > .env.tmp && mv .env.tmp .env; \
		echo "SIGNOZ_API_KEY=$$pasted" >> .env; \
		echo ">> Wrote SIGNOZ_API_KEY to .env."; \
	fi

# ---- the money target -------------------------------------------------------
# Goal: from zero to a live, seeded demo in under 5 minutes.
demo: env doctor provision up seed ## Validate, provision, build, start, seed, and open the demo (<5 min)
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

provision: ## Idempotently install SigNoz channels, rules, and dashboards
	pnpm provision:signoz -- --apply

provision-dry-run: ## Show missing SigNoz resources without changing them
	pnpm provision:signoz -- --dry-run

up: ## Install deps, build, and start replay-engine, studio, and Taskline
	@echo ">> Using SigNoz at $(SIGNOZ_URL) (start it with \`make signoz\` if it is not running)."
	pnpm install
	pnpm build
	@mkdir -p $(LOG_DIR)
	@echo ">> Starting reference runner on $(RUNNER_URL) ..."
	@nohup env OLLAMA_HOST='$(OLLAMA_HOST)' pnpm --filter @hindsight/demo-agents runner > $(LOG_DIR)/runner.log 2>&1 &
	@echo ">> Starting AI to-do demo on $(TODO_URL) ..."
	@nohup env HINDSIGHT_TODO_PROVIDER='$(HINDSIGHT_TODO_PROVIDER)' OLLAMA_HOST='$(OLLAMA_HOST)' OLLAMA_MODEL='$(OLLAMA_MODEL)' pnpm --filter @hindsight/demo-agents todo > $(LOG_DIR)/todo.log 2>&1 &
	@echo ">> Starting replay-engine on $(REPLAY_ENGINE) ..."
	@nohup env HOST='$(HOST)' HINDSIGHT_API_TOKEN='$(HINDSIGHT_API_TOKEN)' HINDSIGHT_ALLOW_UNAUTHENTICATED_LOCALHOST='$(HINDSIGHT_ALLOW_UNAUTHENTICATED_LOCALHOST)' SIGNOZ_API_KEY='$(SIGNOZ_API_KEY)' SIGNOZ_WEBHOOK_SECRET='$(SIGNOZ_WEBHOOK_SECRET)' HINDSIGHT_RUNNERS='$(HINDSIGHT_RUNNERS)' pnpm --filter @hindsight/replay-engine start > $(LOG_DIR)/replay-engine.log 2>&1 &
	@echo ">> Starting studio on $(STUDIO_URL) ..."
	@nohup pnpm --filter @hindsight/studio dev > $(LOG_DIR)/studio.log 2>&1 &
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
