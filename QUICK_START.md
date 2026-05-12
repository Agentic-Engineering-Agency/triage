# Quick Start Guide — Development Environment Setup

## Overview

This project uses **Docker containers** to run all services locally. A new developer should be able to clone the repo, configure `.env`, and run `docker compose up` to have a fully functional incident triage system.

### What's Running

| Service | Purpose | Port | URL |
|---------|---------|------|-----|
| **Frontend** | Web UI (Vite dev server + Caddy) | 3001 | http://localhost:3001 |
| **Runtime** | Mastra orchestration + API | 4111 | http://localhost:4111 |
| **LibSQL** | SQLite database | 8080 | http://libsql:8080 |
| **Langfuse Web** | Observability UI | 3000 | http://localhost:3000 |
| **Langfuse Stack** | Postgres, ClickHouse, Redis, MinIO | (internal) | (internal) |
| **Cloudflare Tunnel** | Public HTTPS access | — | langfuse.agenticengineering.lat |

## 1. Clone & Setup

```bash
# Clone the repo
git clone <repo-url>
cd triage-dev

# Copy .env.example (if you don't have .env already)
cp .env.example .env

# Edit .env with your credentials (see section 2)
```

## 2. Configure .env

Your `.env` file should have all required credentials. Required variables:

### App Configuration
```env
PORT=4111
NODE_ENV=production
LIBSQL_URL=http://libsql:8080
```

### LLM & AI
```env
OPENROUTER_API_KEY=sk-or-...  # Get from https://openrouter.ai/keys
```

### Linear Integration (for ticket creation)
```env
LINEAR_API_KEY=lin_...          # Get from Linear → Settings → API
LINEAR_TEAM_ID=...              # Your Linear team UUID (or use default TRI team)
```

### Email Notifications
```env
RESEND_API_KEY=re_...           # Get from https://resend.com/api-keys
RESEND_FROM_EMAIL=your@email.com
```

### GitHub (for PR context)
```env
GITHUB_TOKEN=github_pat_...     # Get from GitHub → Settings → Developer settings → Personal access tokens
```

### Langfuse Observability
```env
LANGFUSE_PUBLIC_KEY=pk_...      # Auto-generated on first container start
LANGFUSE_SECRET_KEY=sk_...      # Auto-generated on first container start
LANGFUSE_BASEURL=https://langfuse.agenticengineering.lat
```

**Note:** All other Langfuse and infrastructure variables should already be in `.env`. Do not modify them unless instructed.

## 3. Start Containers

```bash
# Start all services
docker compose up -d

# Watch logs as services start (Ctrl+C to exit)
docker logs -f triage-runtime

# Check health of all services
docker compose ps

# Wait for health checks to pass (takes ~60s for Langfuse stack)
```

### Expected Service Status

```
CONTAINER              STATUS
triage-frontend        Up (healthy)
triage-runtime         Up (healthy)
libsql                 Up (healthy)
langfuse-web           Up (healthy)        ← Takes ~60s
langfuse-worker        Up (healthy)
clickhouse             Up (healthy)
redis                  Up (healthy)
minio                  Up (healthy)
langfuse-postgres      Up (healthy)
cloudflared            Up
```

If any container fails, check logs:
```bash
docker logs <container-name>
```

## 4. Verify Setup

### Check Runtime Health
```bash
curl http://localhost:4111/api/config/status
# Expected response:
# {"success":true,"data":{"linearConfigured":true,"openrouterConfigured":true}}
```

### Access Web UI
- Frontend: http://localhost:3001
- Langfuse: http://localhost:3000

### Check Database
```bash
curl http://localhost:4111/api/linear/issues
# Should return grouped issues (or empty list if no issues yet)
```

## 5. Complete Workflow Test

### Option A: Via Web UI

1. Go to http://localhost:3001
2. Click **Chat** tab
3. Submit an incident report:
   ```
   There is a critical bug in the auth module where user sessions are timing out unexpectedly after 10 minutes of inactivity
   ```
4. Watch runtime logs:
   ```bash
   docker logs -f triage-runtime
   ```
5. Expected flow:
   - `[intake]` — Receives incident
   - `[triage]` — Analyzes with LLM
   - `[dedup]` — Checks for duplicates
   - `[ticket]` — Creates Linear ticket
   - `[notify]` — Sends notifications
   - `[suspend]` — Waits for webhook

### Option B: Via API

```bash
curl -X POST http://localhost:4111/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "There is a critical bug in the auth module where user sessions are timing out unexpectedly after 10 minutes of inactivity"
    }]
  }'
```

### Option C: Direct Workflow Trigger

```bash
curl -X POST http://localhost:4111/api/workflows/triage-workflow/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test incident: auth timeout bug",
    "reporterEmail": "test@example.com",
    "repository": "org/repo"
  }'
```

## 6. Monitoring & Debugging

### View Logs
```bash
# Runtime API logs
docker logs -f triage-runtime

# Frontend logs
docker logs -f triage-frontend

# Langfuse logs
docker logs -f langfuse-web

# All logs at once
docker compose logs -f
```

### Check Service Connectivity
```bash
# Is runtime connecting to database?
curl http://localhost:4111/health

# Can runtime reach Linear?
curl http://localhost:4111/api/linear/members

# Can runtime reach Langfuse?
# Check logs for initialization messages
docker logs triage-runtime | grep -i langfuse
```

### Clear State
```bash
# Restart runtime (clears in-memory caches)
docker restart triage-runtime

# Reset database
docker exec triage-libsql sqlite3 /data/triage.db "DELETE FROM projects;"

# Restart everything
docker compose restart
```

## 7. Langfuse Observability

Once containers start, you can access Langfuse at http://localhost:3000.

**Initial login:**
- Email: `admin@example.com`
- Password: `Triagefb1a0cc61520d44eXz`

This organization, project, and user are created automatically when the Langfuse containers start (from env vars in `.env`).

**To capture runtime observability:**
- Ensure `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are in `.env`
- Runtime will automatically send traces and spans to Langfuse
- View them in the Langfuse dashboard under "Projects" → "My Project" → "Traces"

## 8. Troubleshooting

### "No LINEAR_API_KEY configured" Error

**Solution:** Add `LINEAR_API_KEY` to `.env` and restart runtime:
```bash
docker restart triage-runtime
```

### "Webhook not resuming workflow" 

**Steps:**
1. Ensure Cloudflare tunnel is running: `docker logs cloudflared`
2. Register webhook: `curl -X POST http://localhost:4111/api/linear/webhook/setup -d '{"url":"https://langfuse.agenticengineering.lat/api/webhooks/linear"}'`
3. Move ticket to DONE in Linear
4. Check runtime logs for resume signal

### "Langfuse containers not starting"

**Debug:**
```bash
docker logs langfuse-postgres
docker logs clickhouse
docker logs redis
docker logs minio
```

Common issues:
- PostgreSQL password mismatch: check `POSTGRES_PASSWORD` in `.env`
- ClickHouse memory: ensure Docker has >2GB available
- MinIO permissions: check `/data` volume is writable

### "Frontend won't compile"

**Solution:**
```bash
# Rebuild frontend container
docker compose build frontend
docker compose up -d frontend

# Or manually install dependencies
cd frontend && npm install
```

## 9. Next Steps

Once the complete flow works end-to-end:

1. **Test with your Linear workspace** — Update `LINEAR_TEAM_ID` to your workspace
2. **Configure Slack notifications** — Add `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`
3. **Setup wiki generation** — Trigger `/api/wiki/generate` for RAG
4. **Monitor in production** — Use Langfuse dashboard for observability
5. **Configure GitHub webhooks** — Link PRs to tickets for full automation

## 10. Architecture Reference

**Container dependencies:**
```
frontend → runtime → libsql
           ↓
       langfuse-web ← langfuse-postgres
       langfuse-worker    ← clickhouse, redis, minio
           ↓
        cloudflared (Tunnel)
```

**Key directories:**
- `./frontend/` — React UI (Vite)
- `./runtime/src/` — Mastra agents, workflows, tools
- `./docker-compose.yml` — Container orchestration
- `./.env` — Environment configuration
- `./TESTING.md` — Detailed testing guide
- `./CLAUDE.md` — Project instructions

## 11. Resetting Everything

If you need a completely fresh start:

```bash
# Stop and remove all containers, volumes, networks
docker compose down -v

# Remove built images
docker compose down -v --rmi all

# Start fresh
docker compose up -d

# Wait ~2 minutes for Langfuse to initialize
docker compose ps
```

---

**Need help?** Check `TESTING.md` for detailed testing scenarios, or review the `runtime/src/` directory for implementation details.
