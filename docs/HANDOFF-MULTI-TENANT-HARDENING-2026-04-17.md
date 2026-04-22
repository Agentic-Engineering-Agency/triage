# Handoff — Multi-tenant hardening & UX redesign

**Branch:** `fix/ui-cleanup-cycle-panel` — 14 commits pusheados al origin.
**Last commit:** `4a350be feat(ui): Slack/Resend/GitHub cards + account-email reporter (#5c)` (2026-04-22)
**Uncommitted at time of write:** ninguno — working tree limpio.
**Date:** 2026-04-17 (original), 2026-04-20 (#3 + #4a), 2026-04-21 (#4b + #5a), 2026-04-22 (#5b Linear + #5c Slack/Resend/GitHub)

---

## Objetivo de la próxima sesión

**Siguiente natural: #5d — GitHub/wiki unification + private repo detection (Pattern C).**

#1–#5c cerrados: webhook verif, wiki, per-tenant schema, tools + agents per-tenant, 5 integration cards (OpenRouter + Linear + Slack + Resend + GitHub) + scoped-routes flip + ownership fix + generic `Picker<T>` + account-email reporter. Todo pusheado.

Baseline al cierre de #5c: TSC runtime 5 errores estable (3 scoped-routes Cycle casts + 2 sendSlackMessage.execute possibly-undefined — pre-existing). TSC frontend limpio. Tests: 106 failing baseline estable, +12 nuevos passing en #5c (+10 `integration-routes.test.ts` para los 3 providers nuevos, +1 `tenant-keys.test.ts` meta propagation, +1 `resend.test.ts` meta.fromEmail override). 0 regresiones netas.

Smoke #5c validado end-to-end el 2026-04-22:
- Resend card (PAT + fromEmail manual) → Test & Save → card "From: ..."
- Slack card con token minimal-scope (`chat:write` only) → `auth.test` pasa, `conversations.list` falla con `missing_scope` → UI cae a input manual de channelId con hint sobre scopes. Confirma que el mismo token del `.env` (que sólo tiene chat:write) funciona via manual input.
- GitHub card → picker de repos → Save → card "Repo: owner/name". Funcionó aislado, pero destapa el dual-source-of-truth con `projects.repo_url` — lo resuelve #5d.

Ver la sección **"Priorización"** más abajo para el detalle de #5d.

---

## Estado actual — qué funciona, qué está probado

Probado end-to-end esta semana:

- Chat → displayTriageTool (clasificación + assignee + ciclo + dueDate)
- Create Ticket → workflow crea issue en Linear en el ciclo correcto
- Email al assignee + notificación Slack
- Webhook simulado: issue → "Done" → resume workflow → email de resolución al reporter → mensaje "✅ resolved" en el chat thread
- Webhook simulado: issue → "In Review" sin evidencia → bot lo revierte a "In Progress" y nagea al assignee
- Observability dashboard: `llm_usage` table se llena via `onFinish` del chatRoute; pricing funciona con prefix-match para model IDs versionados de OpenRouter
- `/integrations` end-to-end con los 5 providers: OpenRouter (test+save directo), Linear (picker de teams), Slack (picker cuando hay scopes, input manual cuando falta `channels:read`), Resend (PAT + fromEmail manual), GitHub (picker de repos — a unificar en #5d)
- Reporter email en `chat.tsx` viene de `useAuth().user.email` en vez de localStorage (key `reporter_email` muerta)

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

### 4b. Refactor de agentes (`model:` dynamic para OpenRouter key) ✅ DONE (2026-04-21) — `124f29a`

Todos los OpenRouter clients construidos module-level fueron reemplazados por resolución per-call. Helper nuevo + 5 agentes + 1 tool + 1 lib + 5 workflow call sites migrados.

**Helper — `runtime/src/lib/tenant-openrouter.ts`**:
- `resolveOpenRouterFromContext({ requestContext })` para agentes (lee `projectId` del contexto)
- `resolveOpenRouterFromProjectId(projectId)` para wiki-rag/attachments donde `projectId` ya viene como arg
- Ambos devuelven la factory `createOpenRouter(...)` (cliente fresco por call, ningún estado compartido)
- Si nada resuelve, `apiKey: undefined` → OpenRouter tira 401 limpio en vez de silenciar
- 6 unit tests en `tenant-openrouter.test.ts`

**Agentes** — todos con `model: async ({ requestContext }) => ...`:
- `agents/orchestrator.ts` — preserva extraBody con fallback chain + max_tokens 4000
- `agents/triage-agent.ts` — mercury plain
- `agents/resolution-reviewer.ts` — mercury plain
- `agents/code-review-agent.ts` — mercury plain
- `agents/slack-notification-agent.ts` — preserva extraBody con fallback chain + max_tokens 800

**Tool — `mastra/tools/attachments.ts`**:
- Ambos paths resuelven per-tenant: AI SDK vision (imagen) + raw fetch a `openrouter.ai/api/v1/chat/completions` (PDF)
- Lee `projectId` desde `toolCtx.requestContext.get('projectId')`
- Input shape cambió de `(input)` directo a `(input, toolCtx?)` con manejo dual `{ context } | direct` (mismo patrón que resend.ts)

**Lib — `lib/wiki-rag.ts`**:
- `generateWiki(projectId, ...)` y `queryWiki(query, projectId?, ...)` resuelven via helper
- Query-side con projectId undefined → cae al env (preserva comportamiento pre-tenant)

**Workflow — `mastra/workflows/triage-workflow.ts`**:
Los 5 call sites de `.generate()` necesitan `requestContext` sintético porque no pasan por el middleware HTTP. Agregado helper `tenantContext(projectId)` que construye `new RequestContext([['projectId', ...]])`:
- `notifyStep:701` — `slackNotificationAgent.generate(msg, { requestContext })`
- `verifyStep:858` — `resolutionReviewer.generate(msg, { requestContext })` (ramo sin PR)
- `verifyStep:879` — `resolutionReviewer.generate(msg, { requestContext })` (ramo con PR, Promise.all)
- `verifyStep:882` — `codeReviewAgent.generate(msg, { requestContext })`
- `notifyResolutionStep:1022` — `slackNotificationAgent.generate(msg, { requestContext })`

**Admin route `/api/test/slack-agent`** (`mastra/index.ts`):
Ahora acepta `projectId` opcional en el body y lo propaga vía `new RequestContext` al agent. Útil para smoke manual sin correr el workflow completo.

**Smoke validado (2026-04-21)**:
- `POST /api/test/slack-agent` con `projectId=11111111-...` → logs `[tenant-keys] project=<id> provider=openrouter source=env` + `provider=slack source=env`. Mensaje en Slack OK.
- `POST /chat` con header `x-project-id=b6892f6b-...` (slugify-test) → logs `[tenant-keys] project=<id> provider=openrouter source=env`. Stream respondió "OK".

**Gotchas**:
- `DynamicArgument<T>` de Mastra acepta `T | (({ requestContext, mastra }) => T | Promise<T>)` — la signatura exacta del agent `model:` está en `@mastra/core/dist/types/dynamic-argument.d.ts`.
- Workflow agents bypasseaan el middleware HTTP. Sin `new RequestContext([['projectId', ...]])` como segundo arg de `.generate()`, el agent ve un contexto vacío y cae al env aunque el projectId exista en `inputData`.
- `attachments.ts`: si agregas un proveedor que use OpenRouter con un endpoint raw (como el file-parser plugin), resolver la key vía `resolveKey('openrouter', projectId)` en vez de `process.env` directo — si no, el branch raw tendría comportamiento diferente al AI SDK.

**Para #5 (UI BYO keys)**:
Backend de integrations ya listo: tabla `project_integrations` + `crypto-envelope` + `integration-routes.ts`. Falta solo UI — rediseño de `/integrations` con cards por dominio (ver siguiente sección).

### 5a. UI BYO keys — OpenRouter slice ✅ CODE COMPLETE (2026-04-21)

Primer slice de la UI de integrations, solo OpenRouter activa. Cierra el round-trip encrypt → decrypt → agent stream con un tenant key seedeado desde la UI.

**Archivos**:
- `runtime/src/lib/auth-helpers.ts` (nuevo) — `extractSessionToken` + `getUserIdFromRequest`. 10 unit tests. Reemplaza las 3 copias inline en `project-routes.ts` y `mastra/index.ts`.
- `runtime/src/lib/integration-routes.ts` (rewrite completo) — 4 routes contra `project_integrations` encriptado: `GET`, `PUT`, `DELETE`, `POST /test`. Ownership check vía `projects.user_id = userId`. Drop del path plaintext viejo que escribía a `projects.linear_token / github_token / slack_*`.
- `runtime/src/lib/integration-routes.test.ts` (nuevo) — 15 tests: auth/ownership, PUT/DELETE, OpenRouter test mock (200/401/network), round-trip `resolveKey` devuelve `source=tenant` + aislamiento entre projects.
- `frontend/src/routes/integrations.lazy.tsx` (nuevo) — Página `/integrations` con 4 cards por dominio. Solo OpenRouter activa (input password + "Test & Save" + badge status + delete con confirm); las otras 3 son stubs "Coming soon".
- `frontend/src/routes/__root.tsx` — agregado nav entry `Integrations` con ícono `KeyRound` entre Projects y Settings.
- `frontend/src/routeTree.gen.ts` — incluye `/integrations` (regenera en build).
- `runtime/src/lib/project-routes.test.ts` — removido el `describe('integration-routes', ...)` viejo (215 líneas) y la única data-isolation test que tocaba `testLinearTokenRoute`. Helper `loadIntegrationRoutes` limpiado.

**API shape**:
```
GET    /projects/:projectId/integrations                        → IntegrationSummary[]
PUT    /projects/:projectId/integrations/:provider              → { apiKey, meta? } → IntegrationSummary
DELETE /projects/:projectId/integrations/:provider              → { deleted: true }
POST   /projects/:projectId/integrations/:provider/test         → { apiKey, meta? } | (sin body) → { valid, reason?, integration? }
```

`test` endpoint sólo persiste + `markTested(true)` cuando la key valida. Bogus/network errors NO persisten. Si no se pasa body, reusa la stored key (útil para "retest sin re-pegar").

**Gotcha del endpoint OpenRouter**: el handoff inicial decía usar `/v1/models` para validar. ❌ Ese endpoint es público y devuelve 200 incluso sin token. Cambiado a **`/api/v1/auth/key`** que 401s para bogus y 200s con metadata para real.

**Gotcha del router plugin**: `@tanstack/router-plugin` no regeneró `routeTree.gen.ts` al correr `vite build` standalone — el `.tanstack/tmp` estaba root-owned y el plugin no pudo escribir. Workaround: editar el file manualmente siguiendo el pattern (el build del Docker image lo regenera correctamente porque el container user sí tiene permisos).

**APP_MASTER_KEY setup** (prerequisito de smoke):
El `.env` actual **no contiene** `APP_MASTER_KEY` (el handoff anterior afirmaba que sí, pero `grep '^APP_MASTER_KEY' .env` retorna vacío). Antes de smokear:
```bash
echo "APP_MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d --force-recreate runtime  # restart NO re-lee env_file
```

**Status del smoke** (parcial — faltan los pasos UI):
- ✅ `GET /projects/:id/integrations` sin cookie → 401
- ✅ `GET /projects/:id/integrations` con cookie válida → 200, data `[]`
- ✅ `GET /projects/ghost/integrations` con cookie → 404 (no existence leak)
- ⏳ `POST .../openrouter/test` con bogus key → pendiente (bloqueado por APP_MASTER_KEY)
- ⏳ `POST .../openrouter/test` con real key → persist + `resolveKey` source=tenant
- ⏳ DELETE → `resolveKey` vuelve a env
- ⏳ UI walkthrough: abrir `/integrations`, pegar key, ver green "Saved", ver nav-switch a otro project → card independiente

**Baselines**: TSC runtime 14 errores (baja 12 vs 26 baseline porque el rewrite eliminó el código viejo que los tenía). TSC frontend limpio. Tests: +25 nuevos passing (10 auth-helpers + 15 integration-routes), 106 failing estable (sin regresiones).

**Followups para #5b**:
- Cards activas para **Linear** (paste key → `/api/v1/viewer` test → auto-fetch teams → guardar `teamId` en meta), **Resend** (paste key → send probe email → guardar `fromEmail` en meta), **Slack** (paste bot token → `auth.test` → guardar `channelId` en meta), **GitHub** (paste PAT → `/user` test → guardar `owner/repo` en meta).
- **`scoped-routes.ts` flip al encriptado**: los 3 endpoints `/projects/:id/linear/{issues,cycle,members}` hoy leen `project.linear_token` directo. Cuando la card de Linear aterrice en #5b, flipiar a `resolveKey('linear', projectId)` para que la UI pueda verificar que la key seedeada funciona end-to-end.
- **`webhook_secrets` table refactor**: todavía global (un row, PK=provider). Cuando la card de Linear registre webhooks per-tenant, mover a `(project_id, provider)` composite PK.
- **Ownership check en `scoped-routes.ts`**: hoy cualquier cookie-authed user puede leer los Linear issues de cualquier project. Replicar el pattern de `assertProjectOwnership` al hacer el flip.
- **Drop de columnas plaintext**: `projects.linear_token / linear_team_id / linear_webhook_id / linear_webhook_url / github_token / github_repo_owner / github_repo_name / slack_enabled / slack_channel_id / slack_webhook_url / resend_api_key`. Dejarlas nullable hasta que todos los readers hayan migrado; dropearlas en migration posterior.
- **Out of scope permanente**: `mastra/index.ts:43` LinearClient singleton (linear-sync cron es system-level, no per-tenant).

### 5b. UI BYO keys — Linear slice ✅ DONE (2026-04-22)

Aterrizó la card de Linear + cleanup del `/settings` legacy + flip del `scoped-routes.ts` al path encriptado + ownership gate en todas las rutas `/projects/:id/*`. Aún faltan Resend / Slack / GitHub cards (ahora #5c).

**Qué shipped:**
- **Backend — `testLinearKey` en `runProviderTest`**: GraphQL `{ viewer { id } teams(first:100) { nodes { id name key } } }`. Auth header es raw PAT, sin `Bearer` (ver gotcha abajo). Retorna `{ valid: true, preview: { teams: [...] } }`.
- **`TestResult.preview` — contrato nuevo**: la valid-arm ahora tiene un campo opcional `preview`. Cuando está presente, `POST /integrations/:provider/test` valida pero **no persiste** — el cliente hace el save con `PUT /integrations/:provider` una vez el usuario eligió su meta. OpenRouter no tiene preview → sigue persistiendo en `/test` como atajo. Mismo shape reusable para Slack (channels) / GitHub (repos) cuando aterricen.
- **Frontend — `LinearCard` en `/integrations`**: paste PAT → Test → dropdown de teams del response → Save (PUT con `meta.teamId/teamName/teamKey`). Estado configured muestra "Team: X (KEY)" + Change + Trash con `ConfirmDialog`. Mismo styling/shape que `OpenRouterCard`.
- **`scoped-routes.ts` flipped**: los 3 handlers Linear (`/issues`, `/cycle`, `/members`) ya no leen `project.linear_token`. Resuelven via `getIntegrationKey(projectId, 'linear')` con fallback a env + legacy `projects.linear_team_id`. Helper nuevo: `resolveLinearContext(projectId, project)` retorna `{apiKey, teamId, source}` o error `no_key`/`no_team`.
- **Ownership gate en las 5 rutas scoped**: `assertProjectOwnership` extraído de `integration-routes.ts` a `auth-helpers.ts` y aplicado a `/linear/{issues,cycle,members}` + `/wiki/{generate,status}`. Antes cualquier cookie-authed user leía data de cualquier project — bug de seguridad pre-existing cerrado.
- **`/settings` deprecado**: sacado del sidebar (`__root.tsx`). La ruta `/settings` sigue viva con un banner "Moved to /integrations" para no 404 a bookmarks. Los endpoints runtime (`/api/config/status`, `/api/linear/members` global, `/api/linear/webhook/setup`) quedan en pie — se borran en el slice cleanup final, después de que Resend/Slack/GitHub cards migren su flow.
- **Tests**: `scoped-routes.test.ts` nuevo (13 passing, ownership + tenant/env resolución + regression guard contra lectura de `linear_token` plaintext). `integration-routes.test.ts` +6 (testLinearKey + preview no-persist + PUT con meta + raw header contract). El bloque scoped-routes de `project-routes.test.ts` quedó `describe.skip` — lo reemplaza el file nuevo con mejor wiring.

**Baselines**: TSC runtime 5 errores (baja 9 vs 14 baseline — el flip eliminó los `projectId: string | undefined → getProject(projectId)` legacy). TSC frontend limpio. Tests: +19 nuevos passing, 106 failing estable (sin regresiones; los 13 tests que antes cubrían scoped-routes en project-routes.test.ts están skipped porque los reemplaza scoped-routes.test.ts).

**Gotchas nuevos:**
- **Linear PAT header**: `Authorization: <key>` raw, SIN `Bearer`. OAuth tokens sí usan `Bearer`, pero los usuarios pegan PATs (`lin_api_...`) en la UI. Confirmado contra docs oficiales.
- **Linear 200 con GraphQL errors**: un PAT inválido puede devolver 200 HTTP con `errors: [{extensions: {code: "AUTHENTICATION_ERROR"}}]` en vez de 401 HTTP directo. `testLinearKey` inspecciona ambos paths.
- **Caddy strip `/api` prefix**: `registerApiRoute('/x', ...)` se sirve en `/x` (sin `/api`). Caddy strippea el prefix en `@projects_api_prefixed`, `@obs_api`, `@integrations_api`. Al testear con curl directo a `localhost:4111`, usar la path sin `/api`. Via frontend (`localhost:3001` o browser) sí va con `/api`.
- **`project-routes.test.ts` cookie format**: usa `cookie: 'session=test-session-token'` (broken, no matchea el regex `better-auth.session_token=...` de `auth-helpers.extractSessionToken`). Los tests CRUD del file siguen rotos por eso — son parte del baseline. No es regresión de este slice.

**Followups para #5c (próximo):**
- **Resend card**: `fromEmail` como input manual (la API no tiene `/me`); test probando `GET /domains`. Meta = `{ fromEmail }`. Migrar `reporter_email` de `localStorage` (hoy en `chat.tsx:352,498,515`) a `meta.defaultReporterEmail`.
- **Slack card**: `auth.test` + `conversations.list` → picker de channel → guardar `channelId` + `channelName` en meta.
- **GitHub card**: `GET /user` + owner/repo como 2do paso (picker tipo GitHub App, o input manual con validación contra `GET /repos/:owner/:repo`).
- **Borrar endpoints legacy del runtime**: `/api/config/status`, `/api/linear/members` (global), `/api/linear/webhook/setup` + la ruta `/settings` completa + los imports en `mastra/index.ts`. Hacerlo después de los 3 cards arriba.
- **`webhook_secrets` refactor a PK compuesta**: sigue global. Cuando Linear card agregue "Register webhook" (dentro de #5c o slice dedicado), migrar a `(project_id, provider)` con `setWebhookSecret(projectId, provider, secret)`. Incluye cambio en el handler `/webhooks/linear` para lookup por project.
- **Drop columnas plaintext en `projects`**: `linear_token`, `linear_webhook_id/url`, `github_token`, `github_repo_owner/name`, `slack_enabled`, `slack_channel_id`, `slack_webhook_url`, `resend_api_key`, `linear_team_id` (leído solo por env-fallback hoy; una vez que todos los projects migren, se puede dropear). Después del cleanup de endpoints.

### 5c. UI BYO keys — Slack/Resend/GitHub ✅ DONE (2026-04-22)

Cerró el bucle de 5 providers en `/integrations`. 2 commits: `d3d9c7c` (backend) + `4a350be` (frontend).

**Qué shipped:**
- **Backend — `resolveKey` shape change**: ahora retorna `{key, meta, source}` en vez de `{key, source}`. Meta se propaga desde la row tenant en `getIntegrationKey`. Callers que solo necesitan `key` siguen funcionando (additive). Tool consumers que leen meta: `resolveResend` (meta.fromEmail precedence meta > env > fallback) y `resolveSlack` (metaChannel de la row, salda el TODO de slack.ts:31-35).
- **Backend — 3 dispatchers nuevos en `integration-routes.ts`**:
  - `testSlackKey`: POST `auth.test` (valida token) + GET `conversations.list?types=public_channel,private_channel&limit=200` → `preview.channels`. **Tolerante a missing_scope**: si auth.test pasa pero la list falla (ej. token con solo `chat:write`), retorna `valid:true` con `preview.channels: []`. UI cae a input manual.
  - `testResendKey`: GET `/domains` → `valid:true`/`invalid_key` binario. Sin preview → persiste con `meta.fromEmail` del body (atajo tipo OpenRouter).
  - `testGithubKey`: GET `/user` + GET `/user/repos?per_page=100&sort=updated` → `preview.repos`. Headers: Bearer + `X-GitHub-Api-Version: 2022-11-28`.
- **Frontend — `components/picker.tsx` nuevo**: `Picker<T>` genérico con `items/value/getValue/getLabel/onChange/placeholder`. Outside-click + Escape. `TeamPicker` borrado — `LinearCard` migrado al shared. Rule-of-three cumplido: Linear teams + Slack channels + GitHub repos.
- **Frontend — 3 cards nuevas en `integrations.lazy.tsx`**:
  - `SlackCard`: `tokenValidated` state separa "token ok" de "enumeration ok". Si channels está vacío → input manual de channelId con hint de scopes (`channels:read`, `groups:read`). Meta guardada: `{channelId, channelName?}` — channelName solo si pickeado del picker.
  - `ResendCard`: 2 inputs (PAT + fromEmail) + validación client-side de email con regex. Un solo botón "Test & Save". Meta: `{fromEmail}`.
  - `GitHubCard`: flujo tipo Linear (PAT → Test → picker → Save). Meta: `{owner, repo, repoFullName}`. **Nota**: este picker queda redundante con `projects.repo_url` — se simplifica a "verify access" en #5d.
  - Los 3 `StubCard` borrados.
- **Frontend — `chat.tsx` reporter_email migration**: los 3 callsites (`handleCreateTicket`, `handleUpdateExisting`, `handleCreateNew`) leen `user?.email` de `useAuth()` en vez de `localStorage.getItem('reporter_email')`. Early-return si no hay user (chat está detrás de auth). La key `reporter_email` en localStorage quedó muerta — verificado sin writers restantes.
- **Tests**: `integration-routes.test.ts` +10 (Slack preview/missing_scope/invalid_auth/network/PUT con channelId, Resend persist+meta/401, GitHub preview/401/headers). `tenant-keys.test.ts` +1 meta propagation. `resend.test.ts` +1 meta.fromEmail override via dynamic re-import (patrón ya usado en el file, cuidado con el leak flag de vi.doMock+resetModules). `integration-routes.test.ts` -1 (borrado el test `not_implemented` ahora obsoleto — los 5 providers tienen dispatcher).

**Baselines al cierre**: runtime TSC 5 errores estable, frontend TSC limpio, tests 106 failing baseline, +12 nuevos passing, 0 regresiones.

**Gotchas nuevos:**
- **lucide-react pineado ^1.7.0**: no exporta `Github` icon — usé `Code2` para la GitHubCard (mismo icono que tenía el StubCard). Si alguien quiere el logo real eventualmente, es slice aparte (bump de lucide).
- **Slack missing_scope no es fatal**: tokens con solo `chat:write` (lo típico de un bot minimal) no pueden listar canales. Mi dispatcher lo trata como "token valid, UI lo resuelve". Si en el futuro agregamos un warning textual en la response, extender `TestResult` con campo `warning`.
- **Resend preview shortcut**: a diferencia de Slack/Linear/GitHub, Resend persiste en `/test` sin preview (como OpenRouter) porque `fromEmail` viene del body del request — no hay nada que pickear. El cliente manda `{apiKey, meta: {fromEmail}}` directo al `/test` y backend hace set+markTested en un call.

**Followups (abiertos para #5d y posteriores):**
- **`GitHubCard` → PAT + "Verify access to {project.repoFullName}"**: sin picker de repos. El repo del proyecto es source of truth. Si el PAT no tiene acceso → error claro.
- **Private repo detection al crear proyecto** (#5d Pattern C — ver abajo).
- **`wiki_status='needs_auth'`** como nuevo estado, con UI prompt para conectar GitHub.
- **Clone autenticado en wiki-rag.ts**: inyectar PAT `https://x-access-token:<pat>@github.com/...` cuando hay integration GitHub para el proyecto.
- **`webhook_secrets` refactor a PK compuesta** (pendiente de #5b): seguirá global hasta que se agregue "Register webhook" button.
- **Drop columnas plaintext en `projects`**: sin cambio desde #5b. Requiere migrar los callers primero.
- **Legacy endpoints runtime**: `/api/config/status`, global `/api/linear/members`, `/settings` route con banner — todos siguen vivos. Cleanup en slice aparte (no crítico).

### 5d. GitHub/wiki unification + private repo detection (próximo)

**Objetivo:** resolver el dual-source-of-truth entre `projects.repo_url` (wiki clone) y `integration_meta.repoFullName` (GitHub API tools), y habilitar repos privados.

**Decisión UX aprobada (2026-04-22):** Pattern C progressive — detectar privacy al crear proyecto, dejar `wiki_status='needs_auth'` si aplica, UI contextual para conectar GitHub.

**Decisión UX aprobada (2026-04-22):** un proyecto = un repo. GitHub card pasa de picker a "verify access to {project.repoFullName}". Si el usuario quiere otro repo, crea proyecto nuevo.

**Scope backend:**
- **`POST /projects`**: parsear `repo_url` → extraer owner/repo → probe `GET api.github.com/repos/:o/:r` sin token, con timeout corto (~2s). Outcomes:
  - **200** → proyecto creado, wiki arranca clone público normal
  - **404/403** → proyecto creado con `wiki_status='needs_auth'`, no se dispara wiki
  - **Timeout/network error** → proceder como si fuera público (no bloquear creación por GitHub flaky)
- **`wiki-rag.ts`**: al clonar, leer `resolveKey('github', projectId)`. Si hay PAT, inyectar en URL: `https://x-access-token:<pat>@github.com/owner/repo.git`. Si `wiki_status='needs_auth'` y sigue sin PAT, no-op.
- **`PUT /projects/:id/integrations/github`**: cambia contrato — en vez de esperar meta del picker, valida que el PAT tenga acceso al `projects.repo_url` del proyecto (`GET /repos/:owner/:repo` con Bearer). Si OK: auto-setea `meta = {owner, repo, repoFullName}` matching projects + si `wiki_status='needs_auth'`, dispara wiki-retry. Si el PAT no tiene acceso → error `repo_access_denied` con mensaje claro.
- **Remover `testGithubKey` preview de repos**: ya no hace `GET /user/repos`. Solo `GET /user` para validar el PAT; el `/test` endpoint queda como "PAT valid yes/no".

**Scope frontend:**
- **`GitHubCard` simplificado**: sin picker, sin estado de repos. Input de PAT + botón "Verify access to {projects.repoFullName}". Después de verify+save, card muestra "Repo: X ✓".
- **Nueva card en `/projects/:id`** (o en el header del projects view) que aparece cuando `wiki_status='needs_auth'`: "Private repo detected — Connect GitHub to enable vectorization" con link directo a `/integrations` o modal inline.
- **`IntegrationSummary.meta.repoFullName`** deja de mostrarse como campo independiente — ahora siempre debería coincidir con el repo del proyecto.

**Scope tests:**
- Nuevo test en `project-routes.test.ts` (o su reemplazo) para el probe de GitHub con 200/404/timeout.
- Test en `wiki-rag.test.ts` verificando que el clone URL lleva el PAT inyectado cuando hay integration row.
- Update a `integration-routes.test.ts` GitHub sección — borrar preview/repos tests, agregar repo_access_denied path.

**Fuera de scope de #5d (explícito):**
- Onboarding wizard (#6)
- RBAC
- `webhook_secrets` refactor
- Rate limiting

**Estimación**: 4-6 horas sanas. Tocar `project-routes.ts`, `wiki-rag.ts`, `integration-routes.ts`, `integrations.lazy.tsx`, wiki status UI. Probar con un repo privado real (crear uno de prueba en GitHub si no hay).

### 6. Test-connection buttons + onboarding wizard
- Endpoint `POST /integrations/:provider/test` con la key provisional, sin persistir — **DONE en #5a-#5c para los 5 providers**. Falta el wizard.
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
- **Slack minimal-scope tokens**: un bot con solo `chat:write` autentica en `auth.test` pero falla en `conversations.list` con `missing_scope`. El dispatcher lo trata como "valid, preview vacío" y el UI cae a input manual de channelId. Si en el futuro agregamos un indicador textual en la response, extender `TestResult` con campo opcional `warning`. No es un bug — es reflejo de cómo está configurado el bot en `.env`.
- **`resolveKey` retorna `meta`**: desde #5c el shape es `{key, meta, source}`. Mocks viejos que retornan `{key: null, source: 'none'}` sin meta pasan hoy porque nada lee `meta` en esos paths, pero si agregás código nuevo que lea meta (ej. el github clone auth de #5d) acordate de actualizar los mocks.
- **lucide-react ^1.7.0**: versión pineada pre-rebranding, no tiene brand icons como `Github`. Usar `Code2` o `FolderGit2` como proxy. Bump aparte si querés el logo real.

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
- **Git log reciente (todo pusheado a origin):**
  - `4a350be` — feat(ui): Slack/Resend/GitHub cards + account-email reporter (#5c)
  - `d3d9c7c` — feat(integrations): Slack/Resend/GitHub test dispatchers + tenant meta (#5c)
  - `4c518bf` — feat(ui): Linear card + agent project clarification (#5b)
  - `38fc56e` — feat(integrations): Linear tenant key + scoped-routes ownership (#5b)
  - `6206218` — docs: handoff update for #5a slice closure + #5b followups
  - `1caef24` — feat(ui): /integrations page with OpenRouter card + confirm dialog (#5a)
  - `82713c2` — refactor(integrations): rewrite integration-routes against encrypted path + auth-helpers (#5a)
  - `124f29a` — feat(integrations): resolve OpenRouter keys per-tenant for agents/tools (#4b)
  - `54de998` — feat(integrations): resolve API keys per-tenant in tools (#4a)
  - `74e05f2` — feat(integrations): envelope-encrypted per-tenant keys schema (#3)
  - `6dcc311` — feat(wiki): project-aware orchestrator + pipeline fixes (#2)
  - `63b13e6` — feat(webhooks): verify Linear signatures con HMAC-SHA256 + secret persistence (#1)

---

## Qué decirle al próximo agente al arrancar

> "Estamos en `fix/ui-cleanup-cycle-panel`, todo pusheado a origin (tip: `4a350be`). Arco multi-tenant #1-#5c cerrado: webhook verif, wiki, per-tenant schema, tools + agents per-tenant, y las 5 cards de integración (OpenRouter/Linear/Slack/Resend/GitHub) en `/integrations`. Lee `docs/HANDOFF-MULTI-TENANT-HARDENING-2026-04-17.md` **sección 5c + 5d** antes de tocar código — #5c cerró con un dual-source-of-truth entre `projects.repo_url` y el meta de GitHub integration, y #5d es el plan concreto para unificar eso + detectar repos privados (Pattern C aprobado). Decisiones UX ya lockeadas: un proyecto = un repo; GitHub card pasa a 'verify access' sin picker; clone con PAT inyectado `https://x-access-token:<pat>@github.com/...`. No toques `.env` ni hagas commits sin que te lo pida. Si ves algo raro en el estado del repo (stash, archivos untracked, ramas nuevas), preguntame antes de accionar."
