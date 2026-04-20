# Handoff — Multi-tenant hardening & UX redesign

**Branch:** `fix/ui-cleanup-cycle-panel`
**Last commit:** `4ec307a chore(types): fix pre-existing tsc drift (schema + pricing)` (2026-04-20); **#4a work staged uncommitted** on same branch (2026-04-20)
**Date:** 2026-04-17 (original), 2026-04-20 (#3 committed + #4a staged)

---

## Objetivo de la próxima sesión

**Siguiente natural: #4b — Agents' `model:` dynamic para OpenRouter key per-tenant.**

Estado del branch: 5 commits pusheables + #4a staged (sin commitear). TSC 0 errores. Test baseline estable (106 fallos pre-existing, 516 passing sobre 669). `project-routes.test.ts` tiene 15 fallos pre-existing en el bloque CRUD (auth 401 en el mock) — son ruido previo.

El sistema corre end-to-end (smoke test #4a: TRI-49 creado con `source=env` en los 3 tools refactorizados). #1-#3 + #4a cerrados. Falta #4b (agents) + #5 (UI BYO-keys) para cerrar el arco.

Ver la sección **"Priorización"** más abajo para el detalle.

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

### 2. Verificar flujo de wiki end-to-end ✅ DONE (2026-04-17)
Pipeline validado con `sindresorhus/slugify` (8 files / 29 chunks / ready). El orchestrator llama `queryWikiTool` correctamente y aterriza las respuestas en el código real cuando el usuario pregunta por el proyecto.

Fixes que aterrizaron en esta pasada:
- **Symlinks rotos mataban el scan**: `scanFiles` en `wiki-rag.ts` usaba `statSync` que tira ENOENT cuando el repo contiene symlinks cuyos targets no existen tras el `git clone --depth 1` (ej. `skills/mastra` en este mismo repo apunta a `../.agents/...`). Switched a `lstatSync` + try/catch — los symlinks se saltan silenciosamente.
- **Columna `projects.error` faltaba en DBs upgradeadas**: el `CREATE TABLE IF NOT EXISTS` tenía la columna pero no había `ALTER TABLE ADD COLUMN` para upgrade. Agregado a `init-db.mjs`. Sin esto, cualquier fallo del pipeline era swallowed por el `.catch(()=>{})` del error handler.
- **`queryWiki` idempotente**: short-circuits a `{ results: [], totalResults: 0 }` si el índice `wiki_vectors` no existe, en lugar de hacer embedding y tirar "no such table". El índice lo crea `LibSQLVector.createIndex` dentro de `generateWiki` on-demand.
- **Triage workflow skip cuando no hay wiki**: `triage-workflow.ts:147` ahora hace un `SELECT status, chunks_count FROM projects` antes de llamar `queryWiki`; si no está ready o tiene 0 chunks, lo brinca y deja el heurístico solo.

**Project-aware orchestrator** (patrón canónico de Mastra — RequestContext + dynamic instructions, ver `runtime/node_modules/@mastra/core/dist/docs/references/docs-server-request-context.md`):
1. Middleware server (`mastra/index.ts`) lee `x-project-id` header y lo pone en `requestContext`
2. Frontend manda el header via `DefaultChatTransport.headers()`
3. Orchestrator usa `instructions: async ({ requestContext })` que consulta `projects` y arma un prompt con "Active Project: name=... id=... status=..." + guía de cuándo llamar `queryWikiTool`
4. `queryWikiTool` lee `ctx.requestContext.get('projectId')` como fallback si el LLM no lo pasa explícito

**Mejora UX frontend**: `projects.lazy.tsx` ahora hace `queryClient.setQueryData` optimista con el response del POST, así el card aparece inmediato en vez de esperar al refetch del invalidateQueries.

**Followup que salió de este arco** (no bloqueante):
- Duplicated wiki-status state: `projects.wiki_status` (usada por `scoped-routes.ts`) y `projects.status` (usada por `wiki-rag.ts` + `project-routes.ts` + UI) son dos fuentes de verdad. Consolidar en un solo path cuando se refactoree para multi-tenant (#3-5).
- `local_tickets.project_id NOT NULL` constraint: el workflow no pasa `projectId` al crear la row, por eso está vacía. No bloqueante (webhook handler usa `workflow_runs` para el resume). Relacionado con multi-tenant.

### 3. Schema de per-tenant keys + encryption ✅ DONE (2026-04-20) — committed
Infra lista y probada — sin tools/agents/UI wired todavía. Commits: `74e05f2 feat(integrations)` + `4ec307a chore(types)` (fix de TS drift en zod-schemas.ts + provider-pricing.ts). TSC limpio (0 errores). Archivos:
- `runtime/src/lib/crypto-envelope.ts` — AES-256-GCM con DEK per-row wrappeado bajo `APP_MASTER_KEY`. Versión byte bindeada como AAD → downgrade falla auth. Tagged unions para loadMasterKey/decrypt (no `any`). 19 unit tests.
- `runtime/src/lib/integration-keys.ts` — `setIntegrationKey`, `getIntegrationKey`, `listIntegrations`, `deleteIntegrationKey`, `markTested`. Cache LRU in-memory con TTL 60s, invalidada en set/delete/markTested. List nunca expone plaintext ni ciphertext. 17 unit tests cubren round-trip, tamper, wrong master key, missing key, cache hit/expiry, aislamiento entre proyectos.
- `runtime/src/lib/schemas/integrations.ts` — `integrationProviderSchema` (enum cerrado `linear|resend|slack|github|openrouter`), `integrationStatusSchema` (`active|disabled|invalid`), `integrationMetaSchema` (`z.record(z.string(), z.string())` — cada provider parsea contra su schema rico en el boundary si necesita).
- `runtime/src/db/schema.ts` — tabla `projectIntegrations` con composite PK `(project_id, provider)`, BLOB `encrypted_key`, JSON `meta`. Relation `projectIntegrationsRelations` + `projects.integrations: many()`.
- `runtime/src/db/zod-schemas.ts` — `projectIntegrationsSelect/InsertSchema` via drizzle-zod + `.extend()`. Nota: drizzle-zod 0.8 compone su output contra tipos de `zod/v4`, así que el overlay importa `zod/v4` aunque el resto del codebase use el root `zod` (v3.25, con subpath v4). Compatible en runtime, distinto a nivel de tipo.
- `runtime/init-db.mjs` — `CREATE TABLE IF NOT EXISTS project_integrations` + `idx_project_integrations_project_id`.
- `.env.example` — `APP_MASTER_KEY` con nota de generación (`openssl rand -base64 32`). **No se tocó `.env`** — cuando se necesite ejercer integration-keys hay que generar la key y setearla.

**Para multi-tenant (#4-5)**: el secret de Linear webhook (tabla `webhook_secrets`) todavía es global (un row); cuando los tools lean del tenant context, esa tabla también se refactorea a `(project_id, provider)` como composite PK.

**Gotcha de type-level zod v3 vs v4**: si agregas otro createSelectSchema/Insert con `.extend()`, usa `zod/v4` para el overlay. Para zod solo a nivel de parse/validate, el root `zod` (v3) está bien.

### 4a. Refactor de tools (Linear/Resend/Slack/GitHub) ✅ DONE (2026-04-20)
Partido en 4a (tools) + 4b (agents' `model:`) para reducir blast radius. 4a cerrado con los tools downstream de proveedores; los agentes LLM siguen leyendo `OPENROUTER_API_KEY` de env (esos son 4b).

**Helper nuevo — `runtime/src/lib/tenant-keys.ts`**:
- `resolveKey(provider, projectId?, opts?)` devuelve `{ key: string | null, source: 'tenant' | 'env' | 'none' }`
- Flujo: si hay `projectId` → `getIntegrationKey` → si `ok` devuelve tenant; si `not_found` | `master_key_missing` | sin projectId → fallback a `process.env.<VAR>`. `decrypt_failed` **no** cae a env (es tampering real, mejor fallar que usar una key equivocada).
- Mapping: `linear→LINEAR_API_KEY`, `resend→RESEND_API_KEY`, `slack→SLACK_BOT_TOKEN`, `github→GITHUB_TOKEN`, `openrouter→OPENROUTER_API_KEY`
- Log one-liner `[tenant-keys] project=<id> provider=<p> source=<s>` solo en cambio de fuente por pair (no spam)
- Flag `envFallback:false` para strict-mode futuro
- 13 unit tests en `tenant-keys.test.ts`

**Workflow pattern — `callTool` sintético**:
`runtime/src/mastra/workflows/triage-workflow.ts:callTool(tool, input, ctx?)` acepta `{ projectId }` opcional y arma un `runtimeContext = { requestContext: { get: k => k==='projectId' ? ctx.projectId : undefined } }` que se pasa como segundo arg a `tool.execute`. Esto replica lo que el middleware HTTP (`x-project-id`) hace para el agent path, pero desde dentro del workflow que no pasa por el middleware. **Sin esto, los tools invocados desde el workflow nunca verían el projectId**, aunque el agent path sí.

**`projectId` propagado por el chain de steps**: `ticketStep → notifyStep → suspendStep → verifyStep → notifyResolutionStep` — agregado como `z.string().optional()` en cada schema. Crítico que esté en `suspendStep.inputSchema` porque Mastra preserva ese snapshot durante el suspend/resume del webhook, así los tools post-webhook también resuelven per-tenant.

**Tools refactorizados** (singleton module-level removido, cliente nuevo per-call):
- `linear.ts` — 7 tools, construye `LinearClient` per-call via `resolveLinearClient(toolCtx)`
- `resend.ts` — 2 tools, `resolveResend(toolCtx)` → `{ client, from }`. FROM email: env `RESEND_FROM_EMAIL` → fallback literal. (Hook para `meta.fromEmail` cuando UI de #5 lo guarde.)
- `slack.ts` — 3 tools, `resolveSlack(toolCtx)`. Channel: `ctx.channel` → `metaChannel` (futuro) → `config.SLACK_CHANNEL_ID` → skip
- `github.ts` — 2 tools, swap directo de `process.env.GITHUB_TOKEN` por `resolveKey('github', projectId)`. `scrubToken(msg, token?)` ahora recibe el token explícitamente

**Workflow consumers** que antes pasaban `config.LINEAR_API_KEY` a helpers — migrados a `resolveKey('linear', inputData.projectId)` upfront por step:
- `resolveStateId('TODO'|'BACKLOG'|'IN_REVIEW', linearApiKey)` (3 call-sites en ticketStep + verifyStep)
- `resolveLabelId('CRITICAL'|'HIGH'|...|'BUG', linearApiKey)` (2 call-sites en ticketStep)

**Out-of-scope explícitamente** (requieren commits separados):
- `mastra/index.ts:42` — `LinearClient` global para `linear-sync` cron (system-level, no per-request)
- `mastra/index.ts:471,479` — `process.env.GITHUB_TOKEN` para repo lookup en una route admin
- `webhook_secrets` table — aún global, refactor a `(project_id, provider)` cuando haya UI
- Agents LLM (`createOpenRouter` en los 5 agentes + `attachments.ts` + `wiki-rag.ts`) → **#4b**

**Tests**:
- `linear.test.ts`: 2 tests actualizados al nuevo contrato (S11 singleton → "constructs fresh client per call"; S2 dynamic-import → `vi.doMock('./../../lib/tenant-keys')` en vez de `config`)
- `resend.test.ts`: mismo patrón (el singleton test verifica via `mockEmailsSend` para evitar rebinding con `vi.resetModules()`)
- `slack.test.ts`: sin flip — ya usaba `execute!({...})` directo, no chequeaba singleton
- `vitest.config.ts`: agregado `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `GITHUB_TOKEN` al env (antes venían por `vi.mock('config')`)

**Smoke test validado (runId `5bfd1fe0-...` → TRI-49 real)**: con `.env` actual y SIN `project_integrations` seedeado, los 3 tools loggean `source=env` y el workflow corre hasta notify+suspend. Linear + Slack OK. Resend devolvió "Unable to fetch data" pero eso es un issue de network/key pre-existing ajeno al refactor.

**Para #4b (agents)**:
Usar `model: async ({ requestContext }) => createOpenRouter({ apiKey: await resolveKeyValue('openrouter', requestContext.get('projectId')) })(...)` — patrón canónico Mastra de dynamic model. Blast radius alto porque toca cada stream de chat; probar con un solo agent primero (recomiendo `slack-notification-agent` que se invoca desde el workflow con un proyecto activo en context).

### 4b. Refactor de agentes (`model:` dynamic para OpenRouter key)
Pendiente. 5 agentes a migrar:
- `agents/orchestrator.ts:25`
- `agents/triage-agent.ts:7`
- `agents/resolution-reviewer.ts:7`
- `agents/code-review-agent.ts:7`
- `agents/slack-notification-agent.ts:7`
- `mastra/tools/attachments.ts:7,55` (usa createOpenRouter para vision)
- `lib/wiki-rag.ts:223,331` (embeddings — estos corren en background, `projectId` viene en la llamada `generateWiki(id, ...)`, no via requestContext)

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
- **Workflow tools y `requestContext`**: los tools invocados desde el workflow via `callTool()` NO pasan por el middleware HTTP que pone `projectId` en `requestContext`. El workflow tiene que construir un runtimeContext sintético manualmente: `callTool(tool, input, { projectId: inputData.projectId })`. Sin eso, los tools siempre ven `projectId=undefined` y caen a env-fallback. Esto significa que `projectId` **debe** propagarse por las schemas del workflow chain (ticketStep→notifyStep→suspendStep→verifyStep→notifyResolutionStep) como `z.string().optional()`. Crítico que esté en `suspendStep.inputSchema` para sobrevivir el suspend/resume snapshot.
- **`vi.doMock` + `vi.resetModules` leak**: si un test hace `vi.doMock('../../lib/tenant-keys')` y después `vi.resetModules()`, el mock queda activo para tests subsiguientes en el mismo file. Tests que checquean `(Resend as any).mock.calls.length` después de `await import('resend')` van a ver un mock rebindeado en vez del original. Preferir verificar via `mockEmailsSend.toHaveBeenCalledTimes(n)` (la call chain del mock original) en vez de contar constructor calls.
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
- **Git log reciente (branch, sin pushear):**
  - `4ec307a` — chore(types): fix pre-existing tsc drift (schema + pricing) — TSC limpio
  - `74e05f2` — feat(integrations): envelope-encrypted per-tenant keys schema (#3)
  - `6dcc311` — feat(wiki): project-aware orchestrator + pipeline fixes (#2)
  - `63b13e6` — feat(webhooks): verify Linear signatures con HMAC-SHA256 + secret persistence (#1)
  - `fd73700` — fix(frontend): restore static Caddy mode + clear TS build errors
  - `132454d` — observability crash fix + pricing prefix match + webhook scripts
  - `62fb05f` — callTool helper para sendResolutionNotification

---

## Qué decirle al próximo agente al arrancar

> "Estamos en `fix/ui-cleanup-cycle-panel` (5 commits sin pushear + #4a staged). El sistema funciona end-to-end (smoke test reciente creó TRI-49). Lee `docs/HANDOFF-MULTI-TENANT-HARDENING-2026-04-17.md` antes de empezar. #1-#3 + #4a del arco multi-tenant están cerrados; el siguiente es #4b — hacer dynamic el `model:` de los 5 agentes para que OpenRouter use la key per-tenant (ver sección 4b del handoff). TSC está limpio. No toques `.env` ni hagas commits sin que te lo pida."
