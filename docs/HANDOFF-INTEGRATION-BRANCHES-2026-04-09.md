# Integration Branches Handoff

**Date:** 2026-04-09
**Author:** Fernando (Hermes Agent)
**Purpose:** Self-contained guide for teammates (Koki, or any agent) to finish
integrating the Slack, Jira, and Langfuse branches AFTER Lalo merges the
runtime + our DB layer.

---

## Prerequisites

Before starting ANY integration below, ensure:

1. **Lalo's branch `fe/linear-runtime-frontend-integration`** has:
   - Our DB layer merged (branch `hermes/hermes-cf826162`)
   - Lalo's uncommitted work committed and pushed
2. **Docker Compose running** — libsql + langfuse stack:
   ```bash
   docker compose up -d
   ```
3. **`.env` configured** with real API keys (see each section for specifics)
4. **Dependencies installed**:
   ```bash
   npm install        # root
   cd runtime && npm install  # runtime
   ```

---

## 1. SLACK INTEGRATION

**Branch:** `feature/slack-init`
**Worktree:** `/Users/agent/hackathon/triage-feature-slack-init`
**Status:** CODE COMPLETE — tools + schemas + tests written, barrel exports done,
NOT yet registered on orchestrator agent.

### Files to Merge

| File | Lines | Description |
|------|-------|-------------|
| `runtime/src/mastra/tools/slack.ts` | 290 | 3 tools: `sendSlackTicketNotification`, `sendSlackResolutionNotification`, `sendSlackMessage` |
| `runtime/src/mastra/tools/slack.test.ts` | 179 | Unit tests for all 3 tools |
| `runtime/src/lib/schemas/slack.ts` | 51 | 4 schemas: `slackTicketNotificationSchema`, `slackResolutionNotificationSchema`, `slackMessageSchema`, `slackResponseSchema` |
| `runtime/src/lib/config.ts` | (diff) | Adds `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_SIGNING_SECRET` to envSchema + config object |
| `runtime/src/lib/schemas/index.ts` | (diff) | Adds barrel exports for slack schemas + types |
| `runtime/src/mastra/tools/index.ts` | (diff) | Adds barrel exports for slack tools + aliases |
| `cloudflare-tunnel-slack.yml` | 7 | Cloudflare Tunnel config for Slack webhook exposure |

### Dependencies to Install

In **runtime/package.json** (already added on the branch):
```
"@chat-adapter/slack": "^4.24.0",
"@slack/web-api": "^7.15.0"
```

If merging manually:
```bash
cd runtime && npm install @chat-adapter/slack@^4.24.0 @slack/web-api@^7.15.0
```

### Env Vars Needed

Add to `.env`:
```bash
SLACK_BOT_TOKEN=xoxb-...          # From Slack app OAuth page
SLACK_CHANNEL_ID=C0ARS654F98      # Channel ID for #new-channel (or your target channel)
SLACK_SIGNING_SECRET=...           # From Slack app Basic Information page
```

### What's Already Done

- [x] 3 Mastra tools created with `createTool()` (slack.ts)
- [x] 4 Zod schemas (slack.ts)
- [x] Unit tests passing (slack.test.ts)
- [x] Config env vars added to config.ts (as `.optional()`)
- [x] Barrel exports in `tools/index.ts` (tools + aliases)
- [x] Barrel exports in `schemas/index.ts` (schemas + types)
- [x] Cloudflare Tunnel config file created

### Remaining Work (5 steps)

**Step 1 — Register slack tools on orchestrator agent:**
Edit `runtime/src/mastra/agents/orchestrator.ts` and add the slack tools
to the agent's `tools` array:
```typescript
import {
  sendSlackTicketNotificationTool,
  sendSlackResolutionNotificationTool,
  sendSlackMessageTool,
} from '../tools';

// In the agent definition, add to tools array:
tools: [
  // ... existing tools ...
  sendSlackTicketNotificationTool,
  sendSlackResolutionNotificationTool,
  sendSlackMessageTool,
],
```

**Step 2 — Register @chat-adapter/slack on orchestrator for webhook reception:**
In the Mastra instance or agent config, register the Slack channels adapter
so the orchestrator can receive inbound Slack messages via webhook:
```typescript
import { SlackAdapter } from '@chat-adapter/slack';

// In the Mastra config (runtime/src/mastra/index.ts):
channels: {
  slack: new SlackAdapter({
    signingSecret: config.SLACK_SIGNING_SECRET!,
    botToken: config.SLACK_BOT_TOKEN!,
  }),
},
```

**Step 3 — Start Cloudflare Tunnel:**
```bash
cloudflared tunnel run --config cloudflare-tunnel-slack.yml
```
Tunnel: `triage-hackathon` (ID: `83d0c50d`), hostname: `slack.agenticengineering.lat`
Routes to: `http://localhost:4111`

**Step 4 — Configure Slack Event Subscriptions:**
In the Slack app dashboard (https://api.slack.com/apps):
- Go to "Event Subscriptions" → Enable
- Set Request URL to:
  ```
  https://slack.agenticengineering.lat/api/agents/orchestrator/channels/slack/webhook
  ```
- Subscribe to bot events: `message.channels`, `message.im`, `app_mention`

**Step 5 — Test end-to-end:**
```bash
# Run unit tests first
cd runtime && npx vitest run src/mastra/tools/slack.test.ts

# Then integration test:
# 1. Send a message in Slack mentioning the bot
# 2. Verify orchestrator receives the message
# 3. Verify orchestrator responds in Slack
```

### Reference

- Bot name: `triagehackathon` (Bot ID: `B0AS552T60Z`)
- Tunnel ID: `83d0c50d-48e5-4685-aaf9-229466be97d3`
- Credentials file: `/Users/agent/.cloudflared/83d0c50d-48e5-4685-aaf9-229466be97d3.json`

---

## 2. JIRA INTEGRATION

**Branch:** `feature/jira-connection`
**Worktree:** `/Users/agent/hackathon/triage-feature-jira-connection`
**Status:** CODE COMPLETE — tools + schemas + tests + ADF helper written,
barrel exports for tools done, schemas NOT exported, NOT registered on orchestrator.

### Files to Merge

| File | Lines | Description |
|------|-------|-------------|
| `runtime/src/mastra/tools/jira.ts` | 366 | 6 tools: `createJiraIssue`, `getJiraIssue`, `updateJiraIssue`, `transitionJiraIssue`, `addJiraComment`, `searchJiraIssues` |
| `runtime/src/mastra/tools/jira.test.ts` | 686 | 38 unit tests |
| `runtime/src/lib/schemas/jira.ts` | 117 | `JIRA_CONSTANTS` + 6 input schemas |
| `runtime/src/lib/adf.ts` | 75 | Atlassian Document Format converter (markdown → ADF) |
| `runtime/src/lib/adf.test.ts` | 74 | ADF converter tests |
| `runtime/src/lib/config.ts` | (diff) | Adds `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` to envSchema + config |
| `runtime/src/mastra/tools/index.ts` | (diff) | Adds barrel exports for jira tools + aliases |

### Dependencies to Install

**IMPORTANT:** `jira.js` is currently in the **root** `package.json`, but it
should be in `runtime/package.json`. Fix during merge:
```bash
# Remove from root
npm uninstall jira.js

# Add to runtime
cd runtime && npm install jira.js@^5.3.1
```

### Env Vars Needed

Add to `.env`:
```bash
JIRA_BASE_URL=https://agenticengineering.atlassian.net
JIRA_EMAIL=fernando@agenticengineering.agency
JIRA_API_TOKEN=...    # Generate at https://id.atlassian.com/manage-profile/security/api-tokens
```

### What's Already Done

- [x] 6 Mastra tools created with `createTool()` (jira.ts)
- [x] 6 Zod schemas + JIRA_CONSTANTS (schemas/jira.ts)
- [x] ADF converter utility (adf.ts + adf.test.ts)
- [x] 38 unit tests (jira.test.ts)
- [x] Config env vars added to config.ts (as `.optional()`)
- [x] Barrel exports in `tools/index.ts` (tools + aliases)
- [ ] Barrel exports in `schemas/index.ts` — **NOT DONE, must add manually**

### Tools with `requireApproval: true`

Three tools require human approval before execution:
1. `create-jira-issue` — creates new issues
2. `update-jira-issue` — modifies existing issues
3. `transition-jira-issue` — changes issue status/workflow

### Remaining Work (5 steps)

**Step 1 — Export Jira schemas from schemas/index.ts:**
Edit `runtime/src/lib/schemas/index.ts` and add:
```typescript
// Jira schemas and types
export {
  JIRA_CONSTANTS,
  jiraIssueCreateSchema,
  jiraIssueUpdateSchema,
  jiraIssueKeySchema,
  jiraTransitionSchema,
  jiraCommentSchema,
  jiraSearchSchema,
} from './jira';
```

**Step 2 — Move jira.js dependency from root to runtime:**
```bash
npm uninstall jira.js        # from root
cd runtime && npm install jira.js@^5.3.1
```

**Step 3 — Register Jira tools on orchestrator agent:**
Edit `runtime/src/mastra/agents/orchestrator.ts`:
```typescript
import {
  createJiraIssueTool,
  getJiraIssueTool,
  updateJiraIssueTool,
  transitionJiraIssueTool,
  addJiraCommentTool,
  searchJiraIssuesTool,
} from '../tools';

// In the agent definition, add to tools array:
tools: [
  // ... existing tools ...
  createJiraIssueTool,        // requireApproval: true
  getJiraIssueTool,
  updateJiraIssueTool,        // requireApproval: true
  transitionJiraIssueTool,    // requireApproval: true
  addJiraCommentTool,
  searchJiraIssuesTool,
],
```

**Step 4 — Run tests:**
```bash
cd runtime
npx vitest run src/mastra/tools/jira.test.ts
npx vitest run src/lib/adf.test.ts
```

**Step 5 — Integration test:**
```bash
# Via the agent, ask it to create a Jira issue:
# "Create a bug in Jira project KAN titled 'Test issue from agent'"
# Verify in Jira dashboard: https://agenticengineering.atlassian.net/jira/software/projects/KAN/board
```

### Reference

- Jira Project: `KAN` (Solidus) on `agenticengineering.atlassian.net`
- Issue Types: Epic, Subtask, Task, Feature, Request, Bug
- API Version: Jira Cloud REST API v3 (via jira.js v5)

---

## 3. LANGFUSE OBSERVABILITY

**Branch:** `feature/observability-init` (remote only, already merged into main)
**Worktree:** NOT local — code is already in docker-compose.yml
**Status:** INFRA DEPLOYED but UNHEALTHY — credentials have placeholder values
**Spec:** `SPEC-20260408-003`
**Detailed handoff:** `docs/handoff-LANGFUSE-OBSERVABILITY-2026-04-09.md` (on feature/observability-init branch, 244 lines)

### Docker Services (already in docker-compose.yml)

| Service | Image | Port(s) | Status |
|---------|-------|---------|--------|
| `langfuse-web` | `langfuse/langfuse:3.22.0` | 3000 | ❌ UNHEALTHY |
| `langfuse-worker` | `langfuse/langfuse-worker:3.22.0` | 3030 | ❌ UNHEALTHY |
| `langfuse-postgres` | `postgres:17.2-alpine` | 5432 | ✅ healthy |
| `clickhouse` | `clickhouse/clickhouse-server:24.8.6` | 8123, 9000 | ✅ healthy |
| `redis` | `redis:7.4-alpine` | 6379 | ✅ healthy |
| `minio` | `minio/minio:2024-11-07` | 9090, 9091 | ✅ healthy |

**No npm dependencies needed** — uses OpenRouter Broadcast (zero-code observability).

### Blockers to Resolve (6 steps)

**Step 1 — Generate real credentials:**
```bash
# Generate Langfuse API keys
python3 -c "import secrets; print(f'pk-lf-{secrets.token_hex(16)}'); print(f'sk-lf-{secrets.token_hex(16)}')"

# Generate other secrets
python3 -c "import secrets; print(secrets.token_hex(32))"  # ENCRYPTION_KEY (64 hex chars)
python3 -c "import secrets; print(secrets.token_hex(16))"  # SALT
python3 -c "import secrets; print(secrets.token_hex(32))"  # NEXTAUTH_SECRET
python3 -c "import secrets; print(secrets.token_hex(16))"  # passwords (CLICKHOUSE, REDIS, MINIO, POSTGRES)
```

**Step 2 — Update `.env` with real values:**
Replace ALL `CHANGEME` placeholders:
```bash
# Langfuse init credentials
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-<generated>
LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-<generated>
LANGFUSE_INIT_USER_EMAIL=fernando@agenticengineering.agency
LANGFUSE_INIT_USER_PASSWORD=<strong-password>

# Infrastructure secrets
ENCRYPTION_KEY=<64-hex-chars>
SALT=<32-hex-chars>
NEXTAUTH_SECRET=<64-hex-chars>

# Service passwords
CLICKHOUSE_PASSWORD=<generated>
REDIS_AUTH=<generated>
MINIO_ROOT_PASSWORD=<generated>
POSTGRES_PASSWORD=<generated>
```

**Step 3 — Reset Langfuse database (required after changing init credentials):**
```bash
# Stop Langfuse services and wipe the postgres volume
docker compose down langfuse-web langfuse-worker langfuse-postgres

# Find and remove the volume (name depends on project directory)
docker volume ls | grep langfuse_postgres
docker volume rm <project>_langfuse_postgres_data

# Restart — init container will re-seed with real credentials
docker compose up -d langfuse-web langfuse-worker langfuse-postgres
```

**Step 4 — Verify Langfuse is healthy:**
```bash
# Check container health
docker compose ps | grep langfuse

# Should show both langfuse-web and langfuse-worker as "healthy"
# Web UI: http://localhost:3000
# Login with LANGFUSE_INIT_USER_EMAIL / LANGFUSE_INIT_USER_PASSWORD
```

**Step 5 — Configure OpenRouter Broadcast (zero-code tracing):**
1. Go to https://openrouter.ai/settings/integrations (or dashboard)
2. Add a Langfuse callback URL:
   ```
   https://langfuse.agenticengineering.lat/api/public/otel/v1/traces
   ```
3. This requires the Cloudflare Tunnel to be running (see Step 6)
4. Alternatively, for local-only: use `http://localhost:3000/api/public/otel/v1/traces`

**Step 6 — Start Cloudflare Tunnel for Langfuse (if exposing externally):**
Create `cloudflare-tunnel-langfuse.yml` if not exists:
```yaml
tunnel: <tunnel-id>
credentials-file: /Users/agent/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: langfuse.agenticengineering.lat
    service: http://localhost:3000
  - service: http_status:404
```
Then:
```bash
cloudflared tunnel run --config cloudflare-tunnel-langfuse.yml
```

### Verification Checklist

- [ ] `docker compose ps` shows langfuse-web + langfuse-worker as healthy
- [ ] Can login at http://localhost:3000 with init credentials
- [ ] Dashboard shows the init project
- [ ] Send a test LLM request through the runtime
- [ ] Traces appear in Langfuse dashboard under the project

---

## Merge Order

```
1. Lalo commits + pushes fe/linear-runtime-frontend-integration
         ↓
2. Our DB branch (hermes/hermes-cf826162) merges into Lalo's
         ↓
3. Integration branches (no cross-dependencies, any order):
   ├── git merge feature/slack-init
   ├── git merge feature/jira-connection
   └── Langfuse — already in docker-compose.yml, just fix credentials
```

### Merge Commands

```bash
# From Lalo's branch (after DB merge):
git checkout fe/linear-runtime-frontend-integration

# Slack
git merge feature/slack-init --no-ff -m "feat: integrate Slack tools + schemas"

# Jira
git merge feature/jira-connection --no-ff -m "feat: integrate Jira tools + schemas + ADF"

# Langfuse is already in compose — no git merge needed
```

---

## Known Conflict Points

When merging Slack + Jira together, these files will have conflicts. Here's
how to resolve each:

### `runtime/src/lib/config.ts`
Both branches add env vars. **Resolution:** Include all vars from both branches.
The final envSchema should have:
- `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_SIGNING_SECRET` (from Slack)
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (from Jira)

All are `.optional()` so they won't break if not set.

### `runtime/src/mastra/agents/orchestrator.ts`
Both branches add tools. **Resolution:** Register ALL tools from both branches
in the `tools` array.

### `runtime/src/mastra/tools/index.ts`
Both branches add exports. **Resolution:** Keep both export blocks:
- Slack exports: `sendSlackTicketNotification`, `sendSlackResolutionNotification`, `sendSlackMessage` + aliases
- Jira exports: `createJiraIssue`, `getJiraIssue`, `updateJiraIssue`, `transitionJiraIssue`, `addJiraComment`, `searchJiraIssues` + aliases

### `runtime/src/lib/schemas/index.ts`
Slack branch already exports slack schemas. Jira branch does NOT export jira
schemas. **Resolution:** After merging both, manually add jira schema exports
(see Jira Step 1 above).

---

## Quick Reference: All New Env Vars

```bash
# === Slack ===
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C0ARS654F98
SLACK_SIGNING_SECRET=...

# === Jira ===
JIRA_BASE_URL=https://agenticengineering.atlassian.net
JIRA_EMAIL=fernando@agenticengineering.agency
JIRA_API_TOKEN=...

# === Langfuse (already in .env, replace CHANGEME) ===
LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-...
LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-...
LANGFUSE_INIT_USER_EMAIL=fernando@agenticengineering.agency
LANGFUSE_INIT_USER_PASSWORD=...
ENCRYPTION_KEY=...
SALT=...
NEXTAUTH_SECRET=...
CLICKHOUSE_PASSWORD=...
REDIS_AUTH=...
MINIO_ROOT_PASSWORD=...
POSTGRES_PASSWORD=...
```

---

## Quick Reference: All New Dependencies

```bash
# Runtime (cd runtime first)
npm install @chat-adapter/slack@^4.24.0 @slack/web-api@^7.15.0 jira.js@^5.3.1

# Root — remove misplaced jira.js
npm uninstall jira.js
```

---

## File Inventory Summary

| Integration | New Files | Modified Files | Test Files | Total Lines |
|-------------|-----------|----------------|------------|-------------|
| Slack | 3 (tools, schemas, tunnel config) | 3 (config, tools/index, schemas/index) | 1 (179 lines) | ~520 |
| Jira | 4 (tools, schemas, adf, adf.test) | 2 (config, tools/index) | 1 (686 lines) | ~1318 |
| Langfuse | 0 (all in docker-compose) | 1 (.env) | 0 | — |

---

*End of handoff. Questions → Fernando or check the branch READMEs.*
