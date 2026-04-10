# Quick Start Guide — Triage

> **Demo video:** [https://www.youtube.com/watch?v=xxEpYnM3TIk](https://www.youtube.com/watch?v=xxEpYnM3TIk) — #AgentXHackathon
> _Last updated: 2026-04-10_

Get the full Triage system running locally in about 5 minutes on a clean machine.

## Prerequisites

- Docker and Docker Compose v2+
- API keys for: OpenRouter, Linear, Resend

## Steps

### 1. Clone the Repository

```bash
git clone https://github.com/Agentic-Engineering-Agency/triage.git
cd triage
```

Already have a clone? Pull the latest:

```bash
git pull origin main
```

### 2. Copy the Environment File

```bash
cp .env.example .env
```

### 3. Fill in Mandatory Environment Variables

Open `.env` and set at minimum these four variables:

| Variable | Required | Where to Get It |
|----------|----------|-----------------|
| `OPENROUTER_API_KEY` | Yes | [openrouter.ai](https://openrouter.ai) → Keys |
| `LINEAR_API_KEY` | Yes | [linear.app](https://linear.app) → Settings → API |
| `RESEND_API_KEY` | Yes | [resend.com](https://resend.com) → API Keys |
| `BETTER_AUTH_SECRET` | Yes | Any random 32+ character string |
| `RESEND_FROM_EMAIL` | Recommended | A verified sender address on your Resend domain |
| `SLACK_BOT_TOKEN` | Recommended | [api.slack.com/apps](https://api.slack.com/apps) → OAuth & Permissions → Bot User OAuth Token (scope: `chat:write`) |
| `SLACK_CHANNEL_ID` | Recommended | Right-click a Slack channel → "View channel details" → copy the Channel ID |
| `CLOUDFLARE_TUNNEL_TOKEN` | Optional | Cloudflare Tunnel token for exposing Langfuse publicly. Get with: `cloudflared tunnel token triage-hackathon` |

The full `.env.example` documents all 58 variables with descriptions and defaults.

### 4. Start All Services

```bash
docker compose up --build
```

The first run pulls base images and builds both app containers — allow about 2 minutes. Subsequent starts are faster.

### 5. Open the App

- **Chat UI**: [http://localhost:3001](http://localhost:3001)
- **Langfuse Dashboard**: [http://localhost:3000](http://localhost:3000)

## You're Ready When...

- `docker compose ps` shows all 10 containers as healthy
- `http://localhost:3001/health` returns `OK`
- The chat UI loads at `http://localhost:3001/chat`

## Try It Out (recommended demo flow)

1. Go to `http://localhost:3001/register` to create an account, then log in.
2. **Connect the Solidus codebase first.** Navigate to `http://localhost:3001/projects`, click **New Project**, and enter:
   - **Repository URL:** `https://github.com/solidusio/solidus.git`
   - **Name:** `Solidus`
   - **Branch:** `main`
   - Click **Create & Generate Wiki**. The Wiki/RAG pipeline clones the repo, chunks source files, and generates ~3,740 embeddings via OpenRouter. Expect **5–10 minutes** on the first run and **~$0.029** of OpenRouter credit. The card flips to **Ready** when done.
3. In the chat (`/chat`), describe an incident, for example:
   > "We're seeing a reflected XSS on the Solidus checkout when the `notice` query parameter contains HTML. Repro: visit `/checkout?notice=<script>alert(1)</script>`."
4. The orchestrator queries the Solidus wiki, renders a **TriageCard** with severity, confidence, root cause, and affected file references.
5. Click **Create Ticket** to approve — the orchestrator creates a real Linear issue in the SOL team, assigns it, and sends email + Slack notifications.
6. Open `/board` to see the five-column Kanban (Backlog → Todo → In Progress → In Review → Done) fed live from Linear. Your new ticket appears in the appropriate column.

> **⚠️ Note:** The In Review evidence check is fully wired end-to-end in code but will not trigger for tickets created via the chat orchestrator path in this build. The chat path calls `createLinearIssueTool` directly and does not currently write to `local_tickets`, which the webhook handler uses to look up reporter email and project context. To exercise the evidence check end-to-end, use the workflow-driven ticket path or wait for a post-hackathon follow-up that unifies the two paths through a shared `persistLocalTicket` helper. Moving a chat-created ticket to In Review in Linear will still update the kanban board via the live Linear sync — it just won't fire the automated evidence check or notification bounce-back.

7. (Optional) When a fix ships, moving the Linear ticket to **In Review** triggers the evidence-check webhook (Use Case 5 in [AGENTS_USE.md](./AGENTS_USE.md)); moving to **Done** notifies the reporter. Both require a Cloudflare Tunnel pointing at the runtime and a one-time click of **Register Webhook** on the Settings page.

## Optional: Run Tests

```bash
pnpm test
```

To include live infrastructure smoke checks:

```bash
RUN_MANUAL_INFRA_TESTS=1 pnpm test
```

## OpenRouter Broadcast Setup (observability in 7 clicks)

Triage ships with **zero runtime code** for LLM tracing. Instead, it relies on OpenRouter's workspace-level **Broadcast** feature to forward every chat completion to our self-hosted Langfuse automatically.

To replicate the observability story, do this **once** in your OpenRouter dashboard:

1. Open [https://openrouter.ai/workspaces/default/observability](https://openrouter.ai/workspaces/default/observability)
2. Click **Add Destination** → pick **Langfuse**
3. **Public Key:** paste the value of `LANGFUSE_PUBLIC_KEY` from your `.env`
4. **Secret Key:** paste the value of `LANGFUSE_SECRET_KEY` from your `.env`
5. **Base URL:** `https://langfuse.agenticengineering.lat` (or your own Langfuse instance URL if self-hosting)
6. Set **Privacy Mode = OFF** and **Sampling Rate = 1** (100%), then **Save**
7. At the top of the page, toggle **Enable Broadcast** to ON

Every subsequent chat completion your OpenRouter workspace makes — from the Orchestrator, Triage Agent, Resolution Reviewer, or Code Review Agent — will now appear in Langfuse with full prompt / completion / token usage / latency / cost. No SDK code, no restart.

> **Known limitation:** OpenRouter Broadcast only covers **chat completions**, not embeddings. The wiki RAG ingestion pipeline consumes ~$0.029 of OpenRouter credit to embed the Solidus codebase (4,123 calls) but those calls will **not** appear in Langfuse. They are visible on the OpenRouter dashboard itself.

## Langfuse Dashboard — localhost caveat for the demo

The Triage sidebar has an **Observability** link. For the hackathon demo it points at **`http://localhost:3000`** — the local Langfuse container — instead of the public tunnel URL `https://langfuse.agenticengineering.lat`. That's deliberate.

Why: the Cloudflare Tunnel that publishes Langfuse rewrites the HTTP `Host` header to the internal service name, which breaks Auth.js interactive login on the Langfuse dashboard. Broadcast ingestion is unaffected because it uses bearer-token auth to `/api/public/ingestion`, not Auth.js.

**Fix for production:** set **HTTP Host Header = `langfuse.agenticengineering.lat`** on the tunnel's Public Hostname ingress rule in the Cloudflare Zero Trust dashboard. For a local `docker compose up` run, just use `http://localhost:3000` and log in there — on first load you will be prompted to create a local admin account.

## Optional: Database Studio

```bash
cd runtime && npx drizzle-kit studio
```

Connects to the LibSQL instance at `localhost:8080` for schema inspection and direct queries.

## Troubleshooting

**Port conflict on 3001 or 3000**
Change `CADDY_PORT` or `LANGFUSE_PORT` in `.env` before starting.

**Docker build fails**
Ensure Docker Desktop is running with at least 4 GB RAM allocated. On Linux, confirm the Docker daemon is active: `systemctl status docker`.

**A container is unhealthy or keeps restarting**
Check its logs: `docker compose logs -f <service-name>`. The most common cause is a missing or incorrect env var.

**`CHANGEME` values still in .env**
The runtime will refuse to start if required secrets are not set. Search your `.env` for `CHANGEME` and replace every occurrence.

**Database connection errors on first boot**
LibSQL takes a few seconds to initialize. Wait 10–15 seconds after all containers report healthy, then retry.

**Email not arriving**
Verify `RESEND_API_KEY` is valid and `RESEND_FROM_EMAIL` matches a verified sender domain in your Resend account.

**Linear ticket not created**
Check that `LINEAR_API_KEY` has write access and that `LINEAR_TEAM_ID` in `.env` matches an existing team. If Linear is unreachable, Triage falls back to storing tickets in the local `local_tickets` table — check the runtime logs for the fallback message.

**Slack notifications not appearing**
Verify `SLACK_BOT_TOKEN` is a valid Bot User OAuth Token (starts with `xoxb-`), the bot has been invited to the target channel, and `SLACK_CHANNEL_ID` matches the correct channel. Slack is optional — if not configured, the system silently skips Slack notifications and relies on email only.

**Wiki/RAG ingestion stuck on "processing"**
Check runtime logs: `docker compose logs -f runtime | grep wiki`. Common causes: the repository URL requires authentication (use public repos or configure git credentials), the repo is very large (>100k files), or the OpenRouter embedding API is rate-limited.
