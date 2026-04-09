# Prompt: Investigación de Arquitectura de DB + Documentación Drizzle para Triage

> Prompt autocontenido. Enviar tal cual a otro agente de Hermes para reproducir los mismos resultados.

---

## CONTEXTO DEL PROYECTO

El proyecto **Triage** es un agente SRE (Site Reliability Engineering) para hackathon.
Repositorio en: `/Users/agent/triage` (rama `main` es read-only, ramas feature tienen trabajo en progreso).

Stack de base de datos:
- **LibSQL dentro de Turso Self-Hosted** — el daemon `sqld` (v0.24.32) corriendo en Docker (`ghcr.io/tursodatabase/libsql-server:v0.24.32`). NO es Turso Cloud. No hay cuenta Turso, no hay Turso CLI, no hay authToken.
- **Drizzle ORM** (`drizzle-orm/libsql`) como ORM con `@libsql/client` como driver
- **drizzle-kit push** (sin archivos de migración, push directo al schema)
- **Better Auth** con Drizzle adapter (provider: 'sqlite') para autenticación
- **DiskANN** con `F32_BLOB(1536)` para vector search (embeddings de `text-embedding-3-small` vía OpenRouter)
- **Zod** para validación de schemas
- **Langfuse** (stack separado con PostgreSQL, ClickHouse, Redis, MinIO) para observabilidad

LibSQL = fork open-source de SQLite creado por Turso, con features adicionales: vector search nativo (DiskANN), acceso HTTP/WebSocket, soporte de replicación.
sqld = el daemon servidor que expone una base de datos LibSQL por HTTP/gRPC.

Conexión: `http://libsql:8080` (Docker DNS) o `http://localhost:8080` (desde el host para drizzle-kit studio).

---

## TAREA 1: Investigar la arquitectura de base de datos en TODAS las capas

Inspecciona el codebase en `/Users/agent/triage` y produce una explicación completa de la arquitectura de DB en todas las capas:

1. **Capa de motores de BD (Infra)**: Qué motores de DB corren, en qué redes Docker, qué puertos, qué volúmenes. Incluir tanto LibSQL (app) como el stack de Langfuse (PostgreSQL, ClickHouse, Redis, MinIO).

2. **Capa de schema de tablas (Drizzle ORM)**: Todos los dominios de datos y sus tablas — Auth (Better Auth managed: user, session, account, verification), Wiki (wiki_documents, wiki_chunks con embeddings), Tickets locales (fallback), Workflow state (Mastra managed).

3. **Capa de conexión (Client/ORM)**: Singleton de conexión, drizzle.config.ts, estrategia de migración (push directo).

4. **Capa de schemas de validación (Zod)**: Schemas en `runtime/src/lib/schemas/` por dominio (triage, ticket, wiki).

5. **Capa de acceso a datos (Tools/Queries)**: Cómo los Mastra tools son el boundary de acceso a datos (wiki-query, wiki-generate, linear).

6. **Capa de API → Frontend**: Cómo el frontend consume datos (useChat SSE para chat, TanStack Query REST para data, Better Auth client para auth). Frontend NUNCA habla directo con la DB.

7. **Capa de observabilidad (Langfuse)**: Stack separado en red langfuse con sus propias bases de datos.

Archivos clave a inspeccionar:
- `docker-compose.yml` — contenedores, redes, volúmenes
- `.env.example` — variables de entorno
- `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md` — decisiones de data
- `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md` — estructura completa, data boundaries, data flow
- `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md` — naming patterns, structure patterns
- `_bmad-output/planning-artifacts/prd/functional-requirements.md` — requerimientos funcionales
- `frontend/src/lib/api.ts` — cómo frontend consume APIs
- `frontend/src/hooks/use-auth.ts` — hook de autenticación
- `frontend/src/lib/chat-draft.ts` — draft persistence

NOTA: El directorio `runtime/src/` aún NO está implementado en código — solo existe como plan en la arquitectura. Las ramas (feature/db-auth, feature/mastra-runtime, 19/impl) tienen stubs. Verifica con `git ls-tree -r --name-only <branch> | grep runtime/src` en las ramas de feature.

Convenciones de naming a documentar:
- DB Tables: snake_case, plural (wiki_documents, local_tickets)
- DB Columns: snake_case (project_id, file_path)
- Foreign Keys: {tabla_singular}_id (document_id, user_id)
- Indexes: idx_{tabla}_{col} (idx_wiki_chunks_document_id)
- API JSON: camelCase (projectId, filePath)
- Zod schemas: camelCase + Schema (triageOutputSchema)
- Null: null (nunca undefined en API responses)
- Dates: ISO 8601

---

## TAREA 2: Extraer documentación de Drizzle ORM relevante para nuestro stack

Extraer contenido COMPLETO (no resúmenes) de las siguientes páginas de documentación. Usar `web_extract` y `web_search`. Paralelizar con `delegate_task` si es posible.

### Grupo A — Setup LibSQL/Turso + Push + Studio
1. https://orm.drizzle.team/llms.txt — índice general
2. https://orm.drizzle.team/llms-full.txt — documentación completa resumida
3. https://orm.drizzle.team/docs/get-started/turso-existing — setup con DB existente
4. https://orm.drizzle.team/docs/get-started/turso-new — setup nuevo proyecto
5. https://orm.drizzle.team/docs/column-types/sqlite — todos los tipos de columna SQLite
6. https://orm.drizzle.team/docs/drizzle-kit-push — comando push (sin migration files)
7. https://orm.drizzle.team/docs/drizzle-kit-studio — browser visual de DB

### Grupo B — Zod + SQL Operator + Batch + Transactions + Indexes
1. https://orm.drizzle.team/docs/zod — integración Zod (OJO: drizzle-zod está deprecado, ahora es drizzle-orm/zod)
2. https://orm.drizzle.team/docs/sql — sql template operator
3. https://orm.drizzle.team/docs/batch-api — batch API (LibSQL lo soporta)
4. https://orm.drizzle.team/docs/transactions — transacciones
5. https://orm.drizzle.team/docs/indexes-constraints — indexes y constraints

### Grupo C — Config + Migrations + Relations + Custom Types
1. https://orm.drizzle.team/docs/drizzle-config-file — configuración de drizzle-kit (NOTE: la URL /docs/kit-config da 404, la correcta es /docs/drizzle-config-file)
2. https://orm.drizzle.team/docs/migrations — fundamentals de migraciones
3. https://orm.drizzle.team/docs/relations — relaciones v1 (estable)
4. https://orm.drizzle.team/docs/extensions/sqlite — extensiones SQLite (está vacía actualmente)
5. https://orm.drizzle.team/docs/custom-types — tipos custom (NECESARIO para F32_BLOB)

### Grupo D — Better Auth + Vector Search
1. https://www.better-auth.com/docs/adapters/drizzle — Drizzle adapter
2. https://www.better-auth.com/docs/installation — instalación Better Auth
3. https://docs.turso.tech/features/ai-and-embeddings — DiskANN, F32_BLOB, vector_top_k
4. https://docs.turso.tech/local-development — desarrollo local con sqld
5. https://docs.turso.tech/sdk/ts/orm/drizzle — integración oficial Turso + Drizzle (incluye vector embeddings)

### Grupo E — Conexión + Tutorial + Issues conocidos
1. https://orm.drizzle.team/docs/connect-turso — conexión Drizzle <> Turso/LibSQL
2. https://orm.drizzle.team/docs/tutorials/drizzle-with-turso — tutorial completo
3. https://github.com/drizzle-team/drizzle-orm/issues/5489 — bug de push con turso dialect (fixed en beta.19)
4. https://github.com/drizzle-team/drizzle-orm/issues/3421 — bug de dialect sqlite vs turso con @libsql/client instalado
5. https://hubertlin.me/posts/2024/11/self-hosting-turso-libsql/ — guía de self-hosting sqld

---

## TAREA 3: Compilar documento de referencia

Con toda la información de Tarea 1 y Tarea 2, generar UN documento de referencia en `docs/drizzle-libsql-reference.md` con las siguientes secciones:

1. **Connection Setup** — cómo crear el client, import paths, tabla comparativa Turso Self-Hosted vs Turso Cloud
2. **Drizzle Config** — drizzle.config.ts con dialect 'turso', explicar POR QUÉ 'turso' y no 'sqlite' para sqld local
3. **SQLite Column Types** — integer (number/boolean/timestamp/timestamp_ms), real, text (plain/enum/json), blob, numeric, modifiers
4. **Schema Declaration** — ejemplo completo con las tablas del proyecto, reusable timestamp pattern
5. **Custom Types (F32_BLOB)** — customType para vectores, bug de double-wrap, inserción correcta
6. **Indexes & Constraints** — constraints, foreign keys, indexes, self-reference
7. **Relations** — one-to-one, one-to-many, many-to-many, disambiguación, querying
8. **CRUD Operations** — select, insert, update, delete con todos los patterns
9. **SQL Template Operator** — sql tagged template, raw, join, mapWith, as
10. **Batch API** — db.batch() para LibSQL, tipos soportados
11. **Transactions** — básica, return value, rollback, nested (savepoints), SQLite behavior
12. **Zod Integration** — createSelectSchema/createInsertSchema/createUpdateSchema, refinements, factory, type mapping SQLite→Zod. NOTA: drizzle-zod DEPRECADO, usar drizzle-orm/zod
13. **drizzle-kit push** — qué hace, cuándo usar, config, flags, filtering
14. **drizzle-kit studio** — browser visual, puertos, notas Safari/Brave
15. **Better Auth + Drizzle Adapter** — setup, tablas auto-generadas, provider 'sqlite', route mounting, client side
16. **LibSQL Vector Search (DiskANN)** — tipos de vector, funciones, AMBAS sintaxis de index (libsql_vector_idx Y USING vector_cosine), parámetros DiskANN, queries en Drizzle con raw SQL, optimización de espacio
17. **Type Inference** — $inferSelect, $inferInsert
18. **Error Handling Patterns** — tool-level error boundary, transaction errors
19. **Quick Reference Card** — resumen compacto de todo el stack

### PUNTOS CRÍTICOS A DESTACAR EN EL DOCUMENTO:

- **Es Turso Self-Hosted (sqld en Docker), NO Turso Cloud** — sin authToken, sin Turso CLI, sin cuenta Turso
- **LibSQL** = fork de SQLite por Turso. **sqld** = daemon que lo expone por HTTP
- **dialect DEBE ser 'turso'** incluso para sqld local (no 'sqlite')
- **Better Auth adapter provider DEBE ser 'sqlite'** (no 'turso')
- **drizzle-zod está DEPRECADO** → usar drizzle-orm/zod
- **F32_BLOB requiere customType** — Drizzle no tiene tipo nativo
- **NO hacer double-wrap** de vectores con sql`vector32(...)` — el customType toDriver ya lo maneja
- **Dos sintaxis de vector index** existen en la documentación — documentar ambas
- **drizzle-kit push en dialect turso** tenía bug de transacciones HTTP — fixed en beta.19
- **text({ mode: 'json' }) > blob({ mode: 'json' })** para campos JSON (soporta funciones JSON de SQLite)
- **compress_neighbors=float8** ahorra 3x espacio con resultados idénticos para <1000 chunks

---

## OUTPUT ESPERADO

1. Explicación textual completa de la arquitectura de DB en todas las capas (puede ser en la respuesta directa o como archivo separado)
2. Archivo `docs/drizzle-libsql-reference.md` (~40KB, 18-19 secciones) con toda la documentación compilada y filtrada para nuestro stack
