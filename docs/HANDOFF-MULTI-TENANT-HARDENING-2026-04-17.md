# Handoff — Multi-tenant hardening & UX redesign

**Branch:** `fix/ui-cleanup-cycle-panel`
**Last commit:** `132454d fix(observability): crash + cost tracking + webhook test scripts`
**Date:** 2026-04-17

---

## Objetivo de la próxima sesión

El sistema de triage funciona end-to-end (chat → ticket Linear → email → Slack → webhook → resolución). Toca pasar de "funciona local con llaves en `.env`" a **multi-tenant con BYO-keys configurables desde la UI**.

Esto implica varios sub-objetivos, no todos son para una sola sesión. Ver la sección **"Priorización"** más abajo para escoger uno.

---

## Estado actual — qué funciona, qué está probado

Probado end-to-end esta semana:

- Chat → displayTriageTool (clasificación + assignee + ciclo + dueDate)
- Create Ticket → workflow crea issue en Linear en el ciclo correcto
- Email al assignee + notificación Slack
- Webhook simulado: issue → "Done" → resume workflow → email de resolución al reporter → mensaje "✅ resolved" en el chat thread
- Webhook simulado: issue → "In Review" sin evidencia → bot lo revierte a "In Progress" y nagea al assignee
- Observability dashboard: `llm_usage` table se llena via `onFinish` del chatRoute; pricing funciona con prefix-match para model IDs versionados de OpenRouter

No probado todavía:

- Wiki RAG end-to-end (generación + query) — existe el código pero no se validó esta semana
- Webhook real desde Linear (solo simulado vía `scripts/simulate-webhook.sh`)
- Producción / deployment (solo docker-compose local)

---

## Dominios del sistema

```
┌─ frontend/ ──────────────────────── React SPA (Vite + TanStack Router)
│  ├─ src/routes/chat.tsx            → chat UI + stream de workflow
│  ├─ src/routes/observability.*     → dashboard de costos + agent usage
│  ├─ src/routes/projects.*          → wiki generation UI
│  └─ src/components/triage-card.tsx → card con severity, assignee, ciclo, dueDate
│
├─ runtime/ ──────────────────────── Node.js + Mastra framework
│  ├─ src/mastra/index.ts            → Mastra instance + todas las API routes
│  │                                   (/chat, /webhooks/linear, /workflows/*/stream)
│  ├─ src/mastra/agents/
│  │  ├─ orchestrator.ts             → agente principal (Mercury-2 primary)
│  │  ├─ triage-agent.ts             → clasificación de severity
│  │  └─ resolution-reviewer.ts      → revisa evidencia de resolución
│  ├─ src/mastra/workflows/
│  │  └─ triage-workflow.ts          → intake → triage → dedup → ticket → notify → suspend
│  ├─ src/mastra/tools/              → linear, resend, slack, github, wiki, display
│  ├─ src/lib/
│  │  ├─ observability-routes.ts     → /observability/{stats,costs,agents,workflows,pricing}
│  │  ├─ usage-logger.ts             → logUsage() inserta en llm_usage
│  │  ├─ provider-pricing.ts         → MODEL_PRICING hardcoded + prefix match
│  │  ├─ webhook-routes.ts           → handlers de webhooks
│  │  ├─ project-routes.ts           → CRUD de proyectos
│  │  ├─ integration-routes.ts       → configs de integraciones (aquí va a vivir BYO-keys)
│  │  ├─ wiki-rag.ts                 → pipeline de generación de wiki
│  │  └─ config.ts                   → LINEAR_CONSTANTS (solo TEAM_ID queda hardcoded)
│  └─ src/lib/auth.ts                → better-auth setup
│
├─ scripts/
│  ├─ simulate-webhook.sh            → POST fake Linear webhook al runtime
│  ├─ setup-webhook-ngrok.sh         → ngrok + registra webhook en Linear
│  └─ check-env.sh                   → valida que no queden CHANGEME en .env
│
└─ Infra
   ├─ docker-compose.yml             → runtime + frontend + libsql
   └─ Dockerfile.{runtime,frontend}
```

**Storage:** libsql (sqld) en contenedor propio. Tablas clave:
- `llm_usage` — tokens y costo por call (filled via onFinish)
- `workflow_runs` — runId ↔ threadId ↔ issueId mapping
- `local_tickets` — cache de tickets creados por el sistema (para reporter_email lookup en webhook)
- `card_states` — estado persistido de cada triage card (confirmed/error/linearUrl)
- `projects` + `wiki_documents` + `wiki_chunks` — wiki RAG
- `auth_*` — better-auth tables

---

## Priorización del trabajo pendiente

Orden recomendado. Cada uno puede ser una sesión propia:

### 1. Webhook signature verification ✅ DONE (2026-04-17)
`/api/webhooks/linear` valida HMAC-SHA256 + replay window ±60s vía `LinearWebhookClient.parseData` del SDK oficial. Fail-closed: sin secret registrado responde 503; firma inválida o ausente responde 401.
- Helper: `runtime/src/lib/verify-linear-signature.ts` (6 unit tests)
- Storage: tabla `webhook_secrets(provider PK, webhook_id, secret, created_at, updated_at)` + helper `runtime/src/lib/webhook-secrets.ts` (4 unit tests)
- `POST /api/linear/webhook/setup` captura el `secret` que Linear devuelve al crear el webhook y hace UPSERT en la tabla
- `scripts/simulate-webhook.sh` firma payloads (HMAC vía openssl) leyendo el secret de la DB, o de `WEBHOOK_SECRET` si se exporta
- **Para multi-tenant (#3-5)**: el secret actualmente es global (un row); cuando vivamos per-project, la tabla crece a `(project_id, provider)` como composite PK y el handler lee el secret del project al que pertenece el webhook.

### 2. Verificar flujo de wiki end-to-end
- Ir a `/projects`, crear uno, pegar un repo de GitHub público
- Ver que `wiki_documents` y `wiki_chunks` se llenan
- Probar `queryWikiTool` desde el chat
- Si está roto, revisar `runtime/src/lib/wiki-rag.ts` y los embeddings

### 3. Schema de per-tenant keys + encryption (sin UI todavía)
- Nueva tabla `project_integrations` con columnas: `project_id, provider, encrypted_key, meta JSON, status, last_tested_at`
- Master key en `.env` (`APP_MASTER_KEY`) usada para envelope encryption con `node:crypto`
- Resolver: `getIntegrationKey(projectId, provider)` → desencripta on-demand
- No afecta nada todavía — solo infra

### 4. Refactor de tools para leer keys del tenant context
El grande. Los tools actualmente hacen `process.env.OPENROUTER_API_KEY` en instanciación:
- `runtime/src/mastra/agents/orchestrator.ts:25` — createOpenRouter
- `runtime/src/mastra/tools/linear.ts` — LinearClient con API_KEY de env
- `runtime/src/mastra/tools/resend.ts` — Resend con env key
- `runtime/src/mastra/tools/slack.ts` — Slack webhook url de env

Hay que inyectar el `projectId` en el `requestContext` y resolver la key per-tenant al momento de la llamada.

### 5. UI de configuración por dominio (BYO keys)
Rediseño de `/integrations` en frontend. Por dominio:
- **Ticketing** (Linear) — paste key → auto-fetch org + teams → seleccionar team
- **Communication** (Resend + Slack) — paste key → test connection → seleccionar canal/sender
- **Code** (GitHub) — OAuth preferido, pero PAT como fallback
- **LLM** (OpenRouter o directo Anthropic/OpenAI) — paste key → test con `/v1/models` → seleccionar modelos

Cada card: toggle "enabled", estado de conexión (verde/rojo/amarillo), botón "Test", botón "Save".

### 6. Test-connection buttons + onboarding wizard
- Endpoint `POST /integrations/:provider/test` con la key provisional, sin persistir
- Wizard de primer uso: "antes de usar Triage necesitas configurar: [✓ Linear] [✗ Email] [✗ Slack] [✓ LLM]"

### Postergable
- RBAC intra-tenant (al principio basta con project owner)
- Billing / límites de uso (trackeo en `llm_usage` ya, enforcement después)
- SSO / SAML
- Rate limiting en `/chat` (necesario antes de producción pública, no antes de multi-tenant)
- Migraciones de DB propias (actualmente `init-db.ts` hace ALTER IF NOT EXISTS; va a doler eventualmente)

---

## Gotchas conocidos (leer antes de tocar código)

- **Docker `.env` reload**: `docker compose restart <svc>` NO re-lee `env_file`. Usar `docker compose up -d --force-recreate <svc>` cuando cambias secretos. Verificar con `docker exec <svc> printenv <VAR>`.
- **Mastra v1.4 tool invocation**: llamar `tool.execute({context:{...}})` directo retorna `{success:false}` silencioso. Usar el helper `callTool(tool, args)` del workflow que pasa ambas shapes + runtimeContext `{}`.
- **OpenRouter version-pinned IDs**: retorna modelos como `inception/mercury-2-20260304`. `MODEL_PRICING` usa prefix match en `provider-pricing.ts`. Si agregas modelo nuevo, solo necesitas la key base.
- **Rules of Hooks**: `frontend/src/routes/chat.tsx` tiene early returns por `authLoading` y `currentProjectId` — **deben ir después** de todos los hooks. Un refactor descuidado reintroduce el bug de hooks.
- **Memory storage per-agent**: `orchestrator.ts` usa su propio `LibSQLStore` (`memory-store`). Mastra top-level storage es separado (`triage-main`). Para leer mensajes del thread usar `agent.getMemory()?.recall()` — el endpoint `/memory/threads/:threadId/messages` ya lo hace.
- **`include_reasoning: true` en OpenRouter** reserva el full output budget → 402 spurious aunque haya saldo. Está removido, no lo re-agregues sin verificar.

---

## Comandos de desarrollo

```bash
# Levantar todo
cd /home/riislly/triage && docker compose up -d

# Ver logs
docker compose logs -f runtime
docker compose logs -f frontend

# Reiniciar runtime después de cambios (código tiene hot-reload;
# para cambios en .env usar --force-recreate)
docker compose restart runtime
docker compose up -d --force-recreate runtime  # si cambiaste .env

# Testear webhook sin mover ticket en Linear (ahora firma el payload con HMAC-SHA256)
./scripts/simulate-webhook.sh <issueId> done
./scripts/simulate-webhook.sh <issueId> in-review
# El script lee el secret de webhook_secrets; si no hay, exportar WEBHOOK_SECRET=<valor>

# Inspeccionar libsql
docker exec triage-runtime-1 node -e "
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: 'http://libsql:8080' });
  db.execute('SELECT * FROM llm_usage ORDER BY created_at DESC LIMIT 5').then(r =>
    console.log(JSON.stringify(r.rows, null, 2))
  );
"

# Frontend: http://localhost:3001
# Runtime API: http://localhost:4111 (health: /health, API: /api/*)
```

---

## Dónde consultar

- **Memoria persistente:** `/home/riislly/.claude/projects/-home-riislly-triage/memory/MEMORY.md` — entradas sobre docker env reload, webhook scripts, y llm_usage wiring.
- **Infra handoff:** `HANDOFF.md` en root — diagrama de contenedores + puertos.
- **Arquitectura general:** `ARCHITECTURE.md` en root.
- **Docs de Mastra:** usar MCP `mastra` tools (`searchMastraDocs`, `readMastraDocs`) para verificar API signatures; están cambiando rápido (v1.4).
- **Git log reciente:**
  - `132454d` — observability crash fix + pricing prefix match + webhook scripts
  - `62fb05f` — callTool helper para sendResolutionNotification (email de resolución)
  - `2d1cfa9` — verify resolution email result + OpenRouter reserve fix
  - `c3e5b84` — route issues al ciclo correcto según dueDate
  - `9b58f46` — fix Rules of Hooks en ChatPage

---

## Qué decirle al próximo agente al arrancar

> "Estamos en `fix/ui-cleanup-cycle-panel`. El sistema funciona end-to-end local. Lee `docs/HANDOFF-MULTI-TENANT-HARDENING-2026-04-17.md` antes de empezar. Quiero trabajar en [#1 webhook signature / #2 wiki / #3 schema de keys / etc — escoger uno]. No toques `.env` ni hagas commits sin que te lo pida."
