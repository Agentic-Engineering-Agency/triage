# INFRA-02 — Better Auth Setup: Documentación de Implementación

**Branch:** `feature/db-auth`
**Worktree:** `~/hackathon/triage-feature-db-auth`
**Spec:** SPEC-20260409-001 (better-auth-drizzle-libsql-auth)
**Dependencia:** INFRA-01 (LibSQL container corriendo)

---

## 1. Qué se implementó

Autenticación con email/password para la app Triage usando Better Auth, con datos persistidos en LibSQL (el mismo container que usa Mastra para storage). El flujo es:

```text
Browser → Caddy (:3001/auth/*) → Mastra runtime (:4111) → Better Auth → LibSQL (:8080)
```

---

## 2. Archivos creados/modificados

### Archivos nuevos

| Archivo | Propósito |
|---------|-----------|
| `runtime/src/db/client.ts` | Singleton de Drizzle conectado a LibSQL |
| `runtime/src/db/schema.ts` | 4 tablas auth con Drizzle ORM (SQLite) |
| `runtime/src/auth/index.ts` | Instancia de Better Auth con toda la config |
| `runtime/src/lib/schemas/auth.ts` | Zod schemas derivados de las tablas Drizzle |
| `drizzle.config.ts` | Config de drizzle-kit (dialect: 'turso') |
| `tests/auth-backend.test.ts` | 34 tests (estructurales + integración) |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `runtime/src/mastra/index.ts` | Montaje de rutas `/auth/*` via `registerApiRoute` |
| `runtime/package.json` | Dependencias de auth agregadas |
| `runtime/package-lock.json` | Regenerado para incluir las nuevas deps |
| `.env.example` | `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` agregados |
| `Dockerfile.runtime` | `pnpm` instalado globalmente (requerido por `mastra build`) |
| `docker-compose.override.yml` | Dev mode corregido: `mastra dev` en vez de `tsx watch` |
| `Caddyfile` | Bloque `handle /auth/*` para reverse proxy (ya existía) |

---

## 3. Arquitectura: cómo encaja auth en el runtime

El runtime del proyecto es un proceso Mastra. Mastra es un framework de IA que internamente usa Hono como HTTP server. Es el único proceso HTTP en el container runtime, escuchando en el puerto 4111.

Better Auth es una librería de autenticación que necesita endpoints HTTP (`/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/get-session`, etc.). Como Mastra controla el HTTP listener, las rutas de auth se montan como "custom API routes" dentro de la config de Mastra:

```typescript
// runtime/src/mastra/index.ts
import { registerApiRoute } from '@mastra/core/server';
import { auth } from '../auth/index';

export const mastra = new Mastra({
  server: {
    apiRoutes: [
      chatRoute({ path: '/chat', agent: 'orchestrator' }),
      registerApiRoute('/auth/*', {
        method: 'ALL',
        handler: async (c) => auth.handler(c.req.raw),
      }),
    ],
  },
});
```

Esta línea le dice a Mastra: "cualquier request que llegue a `/auth/*`, pásalo directamente a Better Auth". Es un proxy de una línea.

---

## 4. Detalle de cada archivo

### 4.1 runtime/src/db/client.ts — Cliente Drizzle

```typescript
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

const libsqlUrl = process.env.LIBSQL_URL || 'http://libsql:8080';
const client = createClient({ url: libsqlUrl });
export const db = drizzle(client, {
  logger: process.env.NODE_ENV === 'development',
});
```

- Usa `@libsql/client` con protocolo HTTP (no WebSocket)
- Sin `authToken` porque LibSQL está self-hosted sin auth
- Default `http://libsql:8080` (nombre del servicio Docker)

### 4.2 runtime/src/db/schema.ts — Tablas auth

4 tablas con prefijo `auth_` para evitar conflicto con la tabla `account` de Mastra:

- `auth_user` — id, name, email (unique), email_verified, image, timestamps
- `auth_session` — id, user_id (FK cascade), expires_at, token (unique), ip, user_agent
- `auth_account` — id, user_id (FK cascade), provider fields (password, tokens, scope)
- `auth_verification` — id, identifier, value, expires_at, timestamps

Relations definidas: user→sessions/accounts, session→user, account→user.

### 4.3 runtime/src/auth/index.ts — Instancia Better Auth

Configuración clave:

```typescript
export const auth = betterAuth({
  basePath: '/auth',                    // NO el default '/api/auth'
  database: drizzleAdapter(db, {
    provider: 'sqlite',                 // NO 'turso' — es el provider del adapter
    schema: { user, session, account, verification },  // NO 'tables'
  }),
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7,       // 7 días fijo
    updateAge: 0,                        // sin sliding window
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',  // false en dev para HTTP
    },
  },
  trustedOrigins,                        // localhost:3001 en dev
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-...',
});
```

### 4.4 drizzle.config.ts

```typescript
export default {
  schema: './runtime/src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',           // drizzle-kit usa 'turso' para LibSQL
  dbCredentials: {
    url: process.env.LIBSQL_URL || 'http://libsql:8080',
  },
} satisfies Config;
```

**Importante:** `dialect: 'turso'` es para drizzle-kit (la herramienta CLI). `provider: 'sqlite'` es para el adapter de Better Auth. Son cosas diferentes que se configuran en archivos diferentes.

### 4.5 runtime/src/lib/schemas/auth.ts — Zod schemas

```typescript
import { createSelectSchema, createInsertSchema } from 'drizzle-orm/zod';
```

Usa `drizzle-orm/zod` (NO el paquete deprecado `drizzle-zod`). Exporta schemas select/insert para las 4 tablas + aliases cortos (`userSchema`, `sessionSchema`, etc.).

---

## 5. Dependencias agregadas

En `runtime/package.json`:

```text
better-auth: ^1.0.0
@better-auth/drizzle-adapter: ^1.0.0
drizzle-kit: ^0.30.0
drizzle-orm: ^0.38.0
@libsql/client: ^0.14.0
@opentelemetry/api            ← peer dependency de better-auth
```

---

## 6. Docker: cómo corre todo

### Producción (docker-compose.yml)

El `Dockerfile.runtime` tiene 2 stages:
1. **builder**: `npm ci` + `npx mastra build` → genera bundle en `.mastra/output/`
2. **production**: `node index.mjs` — ejecuta el bundle compilado

### Dev mode (docker-compose.override.yml)

El override usa el stage `builder` directamente con hot-reload:

```yaml
runtime:
  target: builder              # usa el stage con source code
  working_dir: /app/runtime
  command: npx mastra dev      # hot-reload, no build
  volumes:
    - ./runtime/src:/app/runtime/src   # monta source para edición en vivo
```

`mastra dev` es el equivalente a `vite dev` pero para el runtime de Mastra. Detecta cambios en `src/` y recarga automáticamente.

### Aplicar schema a LibSQL

Las tablas auth se crean con `drizzle-kit push` (sin archivos de migración):

```bash
cd <project-root>
LIBSQL_URL=http://localhost:8080 runtime/node_modules/.bin/drizzle-kit push --config drizzle.config.ts --force
```

O manualmente con SQL directo al API HTTP de LibSQL si drizzle-kit da problemas con tablas de Mastra preexistentes:

```bash
curl -X POST http://localhost:8080 -H 'Content-Type: application/json' -d '{
  "statements": [
    "CREATE TABLE IF NOT EXISTS auth_user (...)",
    "CREATE TABLE IF NOT EXISTS auth_session (...)",
    "CREATE TABLE IF NOT EXISTS auth_account (...)",
    "CREATE TABLE IF NOT EXISTS auth_verification (...)"
  ]
}'
```

---

## 7. Endpoints disponibles

| Método | Path | Descripción |
|--------|------|-------------|
| POST | `/auth/sign-up/email` | Registro con email/password |
| POST | `/auth/sign-in/email` | Login, devuelve session cookie |
| GET | `/auth/get-session` | Devuelve session actual o null |
| POST | `/auth/sign-out` | Cierra sesión (requiere Content-Type: application/json) |
| GET | `/auth/ok` | Health check de Better Auth |

Todos accesibles via Caddy en `:3001/auth/*` o directamente al runtime en `:4111/auth/*`.

---

## 8. Problemas encontrados y cómo se resolvieron

### 8.1 Route mounting: Hono wrapper vs registerApiRoute

**Problema:** La implementación original creaba una instancia separada de `new Hono()` como authRouter y la pasaba como handler en `apiRoutes`. Mastra no acepta apps Hono como handlers — espera una función `(c: Context) => Response`.

**Además**, el authRouter hacía un fetch circular a `http://localhost:4111/auth/*` (el runtime llamándose a sí mismo), lo cual no tiene sentido.

**Solución:** Usar `registerApiRoute` de `@mastra/core/server` (la API oficial) y pasar el request raw directamente a Better Auth:

```typescript
registerApiRoute('/auth/*', {
  method: 'ALL',
  handler: async (c) => auth.handler(c.req.raw),
})
```

### 8.2 basePath: Better Auth default es /api/auth, no /auth

**Problema:** Después de corregir el routing, GET a `/auth/get-session` devolvía `null` (bien) pero POST a `/auth/sign-up/email` daba 404. Better Auth por defecto espera que sus rutas estén bajo `/api/auth/*`.

**Solución:** Agregar `basePath: '/auth'` en la config de `betterAuth()`.

### 8.3 drizzleAdapter: `tables` no existe, es `schema`

**Problema:** La config original usaba `tables: { user: authUser, ... }` pero el tipo `DrizzleAdapterConfig` solo acepta `schema`. Better Auth respondía con error 500: "The model 'user' was not found in the schema object".

**Solución:** Cambiar `tables:` por `schema:` — mismo contenido, diferente key.

### 8.4 docker-compose.override: comando incorrecto para dev

**Problema:** El override usaba `command: npx tsx watch src/index.ts` pero:
- No existe `src/index.ts` — el entry point de Mastra es `src/mastra/index.ts`
- El volume mount `./runtime/src:/app/src` no coincidía con la estructura real del builder stage (`/app/runtime/src/`)

**Solución:** 
- Cambiar command a `npx mastra dev`
- Agregar `working_dir: /app/runtime`
- Corregir volume a `./runtime/src:/app/runtime/src`

### 8.5 Dockerfile: mastra build necesita pnpm

**Problema:** `npx mastra build` internamente usa `pnpm` para instalar dependencias del bundle. La imagen `node:22-alpine` no incluye pnpm.

**Solución:** Agregar `RUN npm install -g pnpm` antes del build step.

### 8.6 package-lock.json desincronizado

**Problema:** Las dependencias de auth se agregaron a `package.json` pero nunca se regeneró el lockfile. Docker build fallaba con `npm ci` porque encontraba paquetes faltantes.

**Solución:** Correr `npm install` localmente para regenerar `package-lock.json`.

### 8.7 @opentelemetry/api missing

**Problema:** `better-auth` tiene una peer dependency en `@opentelemetry/api` que no se instaló. El runtime crasheaba al importar `better-auth/core`.

**Solución:** `npm install @opentelemetry/api` en runtime.

### 8.8 Wildcard routing depth en Mastra

**Problema:** `registerApiRoute('/auth/:path*', ...)` solo matcheaba rutas de un nivel (`/auth/ok`) pero no de dos (`/auth/sign-up/email`).

**Solución:** Cambiar el pattern a `/auth/*` que en Hono sí captura cualquier profundidad.

---

## 9. Cosas a tener en cuenta para el frontend (FE-03)

El frontend necesita crear un auth client de Better Auth. Referencia en `frontend/src/hooks/use-auth.ts` (actualmente stub):

```typescript
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  baseURL: "http://localhost:3001",  // Caddy, no el runtime directo
  basePath: "/auth",                 // debe coincidir con el backend
});
```

Las cookies son HttpOnly, así que el frontend NO puede leer el token directamente. La forma de verificar la sesión es llamar a `GET /auth/get-session` — si devuelve `null`, no hay sesión activa.

---

## 10. Variables de entorno

| Variable | Valor dev | Descripción |
|----------|-----------|-------------|
| `LIBSQL_URL` | `http://libsql:8080` | URL del container LibSQL |
| `BETTER_AUTH_SECRET` | (mínimo 32 chars) | Signing secret para session tokens |
| `BETTER_AUTH_URL` | `http://localhost:3001` | Origin del browser (para trustedOrigins) |

---

## 11. Tests

34 tests en `tests/auth-backend.test.ts`:

- **5 tests estructurales** (pasan siempre): verifican que los archivos existen con el contenido correcto
- **31 tests de integración** (necesitan Docker stack): verifican tablas en LibSQL, drizzle-kit push, endpoints HTTP

Correr solo los estructurales:
```bash
npx vitest run tests/auth-backend.test.ts
```

Correr todos (requiere `docker compose up`):
```bash
RUN_INFRA_TESTS=1 npx vitest run tests/auth-backend.test.ts
```

---

## 12. Decisiones de diseño clave

1. **Prefijo `auth_` en tablas** — Mastra ya tiene una tabla `account`. Sin prefijo habría conflicto.

2. **`dialect: 'turso'` vs `provider: 'sqlite'`** — Son para herramientas diferentes. drizzle-kit (CLI) usa `turso` para conectarse a LibSQL. El adapter de Better Auth usa `sqlite` porque libsql es wire-compatible con SQLite.

3. **`drizzle-kit push` en vez de migrations** — Para hackathon, push directo es más rápido. No genera archivos `.sql` de migración. Es idempotente.

4. **Auth FUERA del directorio `mastra/`** — El código auth vive en `runtime/src/auth/`, no en `runtime/src/mastra/`. Mastra es el framework de IA, auth es infraestructura de la app web. Se conectan en un solo punto: la línea de `registerApiRoute`.

5. **Sin CORS dedicado** — Como todo pasa por Caddy (same origin `:3001`), no se necesita config de CORS. El browser habla con Caddy, Caddy proxy a runtime. No hay cross-origin.
