# Triage Infrastructure Handoff Guide

## Quick Start

```bash
# Start all containers
docker compose up -d

# Check health
docker compose ps

# View logs
docker compose logs -f runtime
docker compose logs -f frontend
```

## Container Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER BROWSER (laptop)                     │
│                   http://localhost:3001                      │
└────────────────────────────┬────────────────────────────────┘
                             │ (SSH tunnel)
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    DOCKER COMPOSE HOST                       │
│  (Remote server: agent@100.89.94.39)                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  FRONTEND (Caddy on :3001)                           │   │
│  │  - Serves built React SPA from /srv                  │   │
│  │  - Reverse proxies /api/* to runtime:4111            │   │
│  │  - Reverse proxies /chat, /auth/*, /webhooks/*       │   │
│  │  - Static file server with SPA fallback              │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  RUNTIME (Node.js on :4111)                          │   │
│  │  - Mastra agent orchestration                         │   │
│  │  - Chat endpoint (/chat)                              │   │
│  │  - API endpoints (/api/*)                             │   │
│  │  - Webhook handlers (/webhooks/linear)                │   │
│  │  - Connects to: libsql, langfuse, linear, slack       │   │
│  └──────────────────────────────────────────────────────┘   │
│       ↓                ↓                ↓                    │
│  ┌─────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │  LibSQL │  │  Langfuse    │  │  Linear API    │          │
│  │ :8080   │  │  Web :3000   │  │ (external)     │          │
│  │ :5001   │  │  Worker      │  │                │          │
│  │(database)   │  :3030       │  │ Slack API      │          │
│  └─────────┘  │              │  │ (external)     │          │
│              │ Redis, Click- │  │                │          │
│              │ House, Minio  │  │ GitHub API     │          │
│              │ Postgres      │  │ (external)     │          │
│              └──────────────┘  └────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Key Containers

### Frontend (Caddy)
- **Port**: 3001 (localhost via Caddyfile)
- **Image**: `triage-dev-frontend` (built from Dockerfile.frontend)
- **Build**: `npm ci && tsc -b && vite build` → outputs to /srv
- **Mode**: Static file serving (FRONTEND_MODE=static in .env)
- **Critical Config**: Caddyfile (reverse proxy rules + security headers)
- **Health Check**: `wget --spider http://127.0.0.1:3001`

### Runtime (Node.js + Mastra)
- **Port**: 4111 (localhost)
- **Image**: `triage-dev-runtime` (built from Dockerfile.runtime)
- **Language**: TypeScript/Node
- **Database**: Connects to LibSQL on http://libsql:8080
- **Key Routes**:
  - `POST /chat` — Main chat endpoint
  - `GET /api/*` — API endpoints
  - `POST /webhooks/linear` — Linear webhook handler
  - `GET /health` — Health check
- **Health Check**: `wget --spider http://127.0.0.1:4111/health`
- **Env File**: Reads from .env (API keys, tokens, URLs)

### LibSQL (Database)
- **Port**: 8080 (HTTP), 5001 (gRPC)
- **Image**: `ghcr.io/tursodatabase/libsql-server:v0.24.32`
- **Data Volume**: `libsql_data:/var/lib/sqld`
- **Purpose**: Stores chat history, threads, team members, projects
- **Health Check**: TCP check on port 8080
- **No auth required** (internal only)

### Langfuse (Observability)
- **Web**: http://localhost:3000
- **Worker**: http://localhost:3030
- **Postgres Backend**: :5432
- **ClickHouse**: :8123, :9000
- **Redis**: :6379
- **MinIO (S3)**: :9090 (console), :9091 (API)
- **Purpose**: Logs all LLM calls, tool usage, reasoning steps
- **Credentials**: See .env (LANGFUSE_INIT_*)
- **External Access**: Via Cloudflare Tunnel to langfuse.agenticengineering.lat

## Environment Variables (.env)

**⚠️ CRITICAL: Never commit .env — always use .env.example as template**

### App Configuration
```
PORT=4111                                    # Runtime port
NODE_ENV=production                          # Always production in Docker
LIBSQL_URL=http://libsql:8080               # Database connection
BETTER_AUTH_SECRET=<hex32>                  # Auth encryption (generate: openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:3001       # Frontend URL for auth callbacks
```

### LLM / AI
```
OPENROUTER_API_KEY=sk-or-v1-...            # OpenRouter API key (for Claude, models)
```

### External Integrations (API Keys)
```
LINEAR_API_KEY=lin_api_...                 # Linear workspace API token
LINEAR_TEAM_ID=645a639b-39e2-4abe-...     # Triage team UUID
RESEND_API_KEY=re_...                      # Email service (for notifications)
RESEND_FROM_EMAIL=triage@...               # Verified sender email
GITHUB_TOKEN=github_pat_...                # GitHub PAT (for PR comments)
SLACK_BOT_TOKEN=xoxb-...                   # Slack bot token
SLACK_CHANNEL_ID=D0ARNRLHLVB               # Default Slack channel/DM
SLACK_SIGNING_SECRET=...                   # Webhook verification
```

### Slack User IDs (for @mentions)
```
SLACK_USER_FERNANDO=U0ARKPZ7Z7V
SLACK_USER_KOKI=U0AS531HKBK
SLACK_USER_CHENKO=U0ARS63RS2E
SLACK_USER_LALO=U0ARQ466E22
```

### Langfuse Core
```
ENCRYPTION_KEY=<hex32>                     # Generate: openssl rand -hex 32
SALT=<hex32>                                # Generate: openssl rand -hex 32
NEXTAUTH_SECRET=<hex32>                     # Generate: openssl rand -hex 32
NEXTAUTH_URL=http://localhost:3000
LANGFUSE_BASEURL=https://langfuse.agenticengineering.lat  # External URL via tunnel
LANGFUSE_PUBLIC_KEY=pk_...
LANGFUSE_SECRET_KEY=sk_...
```

### Langfuse Infrastructure
```
CLICKHOUSE_PASSWORD=<hex32>
REDIS_AUTH=<hex32>
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=<hex32>
LANGFUSE_S3_*_SECRET_ACCESS_KEY=<hex32>
```

### Postgres (Langfuse)
```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<hex32>
POSTGRES_DB=langfuse
```

### Frontend
```
FRONTEND_MODE=static                        # Options: static (production) or dev (Vite HMR)
                                            # ⚠️ MUST be static for SSH tunnel access
```

### Caddy
```
CADDY_PORT=3001
RUNTIME_HOST=runtime
RUNTIME_PORT=4111
```

### Cloudflare Tunnel
```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjo...         # Routes langfuse.agenticengineering.lat to langfuse-web:3000
```

## Common Operations

### View Logs
```bash
# Runtime (Mastra agent, API, webhooks)
docker compose logs -f runtime

# Frontend (Caddy reverse proxy)
docker compose logs -f frontend

# LibSQL (database)
docker compose logs -f libsql

# All services
docker compose logs -f
```

### Restart a Service
```bash
docker compose restart runtime
docker compose restart frontend
docker compose restart libsql
```

### Rebuild Frontend (after code changes)
```bash
docker image rm triage-dev-frontend
docker compose up -d frontend
```

### Rebuild Runtime (after code changes)
```bash
docker image rm triage-dev-runtime
docker compose up -d runtime
```

### Rebuild Everything
```bash
docker compose down
docker image rm triage-dev-frontend triage-dev-runtime
docker compose up -d
```

### Check Container Health
```bash
docker compose ps
# STATUS column: "Healthy" or "starting" or "unhealthy"
```

### Access Database (LibSQL)
```bash
# From runtime container, curl to http://libsql:8080
# Or use tursodatabase CLI on host
curl -X POST http://localhost:8080/execute -d "SELECT * FROM conversations"
```

### Access Langfuse Web UI
```bash
# Via tunnel: https://langfuse.agenticengineering.lat
# Or locally: http://localhost:3000
# Login: admin@example.com / Triagefb1a0cc61520d44eXz (from .env)
```

## Disk Storage Management ⚠️

**Container volumes can grow large. Check regularly:**

```bash
# See Docker disk usage
docker system df

# List volumes
docker volume ls

# Remove unused volumes (frees disk)
docker volume prune

# See size of specific volume
docker run --rm -v libsql_data:/data busybox du -sh /data
docker run --rm -v langfuse_postgres_data:/data busybox du -sh /data
```

**Common Culprits:**
- `libsql_data` — Database file grows with conversation history
- `langfuse_postgres_data` — Observability data (traces, spans, logs)
- `langfuse_clickhouse_data` — Time-series analytics

**If disk fills up (>85%):**
1. Check which volumes are largest: `docker system df -v`
2. Backup important data if needed
3. Remove old volumes: `docker volume rm <volume-name>`
4. Clean unused images: `docker image prune -a`
5. Clean build cache: `docker builder prune -a`

**To prevent issues:**
- Regularly review Langfuse data and clean old traces if needed
- Set up monitoring for disk usage on the host

## Networking

All containers are on the `app` network (bridge mode).

**Container-to-Container Communication:**
- Frontend → Runtime: `http://runtime:4111`
- Runtime → LibSQL: `http://libsql:8080`
- Runtime → Langfuse: `http://langfuse-web:3000` (for trace export)
- External integrations: Via internet (Linear, GitHub, Slack APIs)

**Host-to-Container (from laptop via SSH tunnel):**
```bash
# User's laptop setup
ssh -L 3001:localhost:3001 agent@100.89.94.39
# Then: http://localhost:3001 → tunnel → frontend:3001
```

**Caddy Reverse Proxy Rules (Caddyfile):**
```
:3001 {
  /api/*          → runtime:4111  (Mastra API)
  /chat (POST)    → runtime:4111  (Chat endpoint)
  /auth/*         → runtime:4111  (Authentication)
  /health         → runtime:4111  (Health check)
  /webhooks/*     → runtime:4111  (Webhook handlers)
  /projects       → runtime:4111  (Only for XHR/Accept: application/json)
  /* (else)       → /srv          (Static SPA)
}
```

## Troubleshooting

### Frontend shows blank page
- **Check**: `docker compose logs -f frontend`
- **Likely cause**: FRONTEND_MODE not set to `static`, or Caddy can't reach runtime
- **Fix**: Rebuild: `docker image rm triage-dev-frontend && docker compose up -d frontend`

### Runtime can't connect to database
- **Check**: `docker compose logs -f runtime` (look for "connection refused")
- **Verify**: `docker compose ps` (is libsql healthy?)
- **Fix**: `docker compose restart libsql && docker compose restart runtime`

### 404 on /api/projects
- **Expected** if no projects registered yet
- **Check**: Projects UI in Settings > Projects
- **Debug**: `docker compose logs runtime | grep projects`

### Webhook not triggering from Linear
- **Check**: Webhook URL registered in Linear (https://linear.agenticengineering.lat/api/webhooks/linear)
- **Verify**: Settings > Webhook page shows success status
- **Debug**: `docker compose logs runtime | grep webhook`
- **Network**: Confirm cloudflare tunnel is active: `cloudflared tunnel info triage-hackathon`

### Langfuse not receiving traces
- **Check**: `docker compose logs -f langfuse-web`
- **Verify**: LANGFUSE_BASEURL in .env points to correct URL
- **Debug**: Check runtime logs for trace export errors
- **Tokens**: Confirm LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY match Langfuse project settings

### "Container doesn't have a healthcheck"
- **Not critical** — just means `docker ps` won't show health status for that service
- **Verify manually**: `curl http://localhost:PORT/health` or `docker compose logs SERVICE`

## Important Files

```
.env                           # ⚠️ SECRETS — never commit
.env.example                   # Template — safe to commit
Caddyfile                      # Reverse proxy + security headers
docker-compose.yml             # Service definitions + networking
Dockerfile.frontend            # Frontend build (Node → Caddy)
Dockerfile.runtime             # Runtime build (TypeScript → Node)
frontend/src/routes/*.tsx      # Frontend routes
runtime/src/**/*.ts            # Backend/agent code
```

## Quick Reference: Working on Features

### After modifying frontend code:
```bash
docker image rm triage-dev-frontend
docker compose up -d frontend
# Wait ~30s for build and startup
curl -s http://localhost:3001 | head -20  # Verify it's serving
```

### After modifying runtime code:
```bash
docker image rm triage-dev-runtime
docker compose up -d runtime
# Wait ~10s for startup
curl -s http://localhost:4111/health   # Verify it's responding
```

### After changing .env:
```bash
# Option 1: Restart containers (safest)
docker compose restart

# Option 2: Recreate with new env (if env vars change)
docker compose down
docker compose up -d
```

## Remote Access

**SSH to server:**
```bash
ssh agent@100.89.94.39
# Then run: docker compose ps, docker compose logs, etc.
```

**Port forwarding to localhost:**
```bash
# From your laptop
ssh -L 3001:localhost:3001 agent@100.89.94.39
ssh -L 4111:localhost:4111 agent@100.89.94.39   # (optional, for direct runtime access)
ssh -L 3000:localhost:3000 agent@100.89.94.39   # (optional, for Langfuse UI)
```

**External URLs (via Cloudflare Tunnel):**
- Frontend: https://triage.agenticengineering.lat (if configured)
- Langfuse: https://langfuse.agenticengineering.lat
- Webhooks: https://triage.agenticengineering.lat/api/webhooks/linear

---

**Last Updated**: 2026-04-10  
**Status**: All containers healthy, frontend fixed with auth guard, testing in progress
