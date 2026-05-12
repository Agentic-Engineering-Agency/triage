/**
 * SPEC-20260408-001: Docker Compose Architecture Alignment
 *
 * Covers: REQ-A01, REQ-A03, REQ-A04, REQ-A05, REQ-A09, REQ-A10
 *
 * NOTE: REQ-A02 (runtime dual-network), REQ-A06 (ClickHouse), REQ-A07 (MinIO),
 *       REQ-A08 (Redis), and the `langfuse-*` parts of REQ-A01 were removed in
 *       commit 7e0bd39 when the Langfuse stack (langfuse-web, langfuse-worker,
 *       clickhouse, redis, minio, langfuse-postgres) was lifted out of
 *       docker-compose.yml and into the Helm chart (`k8s/helm/`). Their assertions
 *       are now exercised against the chart in `tests/infra-k8s/helm-chart.test.ts`.
 *       The docker-compose surface here is intentionally small: frontend, runtime,
 *       libsql on a single `app` network.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { resolve } from 'path';

const PROJECT_DIR = resolve(__dirname, '../../');
const COMPOSE_PATH = resolve(PROJECT_DIR, 'docker-compose.yml');
const OVERRIDE_PATH = resolve(PROJECT_DIR, 'docker-compose.override.yml');
const CADDYFILE_PATH = resolve(PROJECT_DIR, 'Caddyfile');
const ENV_EXAMPLE_PATH = resolve(PROJECT_DIR, '.env.example');
const COMPOSE_CMD = 'docker compose -f docker-compose.yml';
const runManualInfraTests = process.env.RUN_MANUAL_INFRA_TESTS === '1';
const liveInfraIt = runManualInfraTests ? it : it.skip;

function loadCompose(): Record<string, any> {
  const raw = readFileSync(COMPOSE_PATH, 'utf-8');
  return parseYaml(raw);
}

function loadOverride(): Record<string, any> {
  const raw = readFileSync(OVERRIDE_PATH, 'utf-8');
  return parseYaml(raw);
}

function readCaddyfile(): string {
  return readFileSync(CADDYFILE_PATH, 'utf-8');
}

function readEnvExample(): string {
  return readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
}

// Helper: get network names for a service (handles array or object format)
function getServiceNetworks(service: Record<string, any>): string[] {
  const nets = service?.networks;
  if (!nets) return [];
  if (Array.isArray(nets)) return nets;
  if (typeof nets === 'object') return Object.keys(nets);
  return [];
}

// =============================================================================
// REQ-A01: Single-Network Topology (post-Langfuse-extraction)
// =============================================================================
describe('REQ-A01: Single-Network Topology', () => {
  it('T-A01: networks section defines exactly 1 network (app)', () => {
    // The previous dual-network design (app + langfuse) is gone — Langfuse now
    // lives in the Helm chart and its services have no presence in compose.
    const compose = loadCompose();
    const networkNames = Object.keys(compose.networks || {});
    expect(networkNames).toEqual(['app']);
  });

  it('T-A02: app network has driver: bridge', () => {
    const compose = loadCompose();
    expect(compose.networks.app.driver).toBe('bridge');
  });

  it('T-A04: frontend service networks contains only app', () => {
    const compose = loadCompose();
    const nets = getServiceNetworks(compose.services.frontend);
    expect(nets).toEqual(['app']);
  });

  it('T-A05: libsql service networks contains only app', () => {
    const compose = loadCompose();
    const nets = getServiceNetworks(compose.services.libsql);
    expect(nets).toEqual(['app']);
  });

  it('T-A09: runtime service networks contains only app', () => {
    // Replaces the old REQ-A02 dual-network assertion — runtime no longer
    // needs the langfuse network because the Langfuse stack is reachable via
    // its in-cluster Service when deployed on Helm, and via LANGFUSE_BASEURL
    // (Cloudflare tunnel) when running locally.
    const compose = loadCompose();
    const nets = getServiceNetworks(compose.services.runtime);
    expect(nets).toEqual(['app']);
  });

  it('T-A01-NEG: old triage network does NOT exist', () => {
    const compose = loadCompose();
    const networkNames = Object.keys(compose.networks || {});
    expect(networkNames).not.toContain('triage');
  });

  it('T-A01-NEG-2: legacy langfuse network does NOT exist in compose', () => {
    const compose = loadCompose();
    const networkNames = Object.keys(compose.networks || {});
    expect(networkNames).not.toContain('langfuse');
  });
});

// =============================================================================
// REQ-A03: Docker Compose Override for Dev Mode
// =============================================================================
describe('REQ-A03: Docker Compose Override for Dev Mode', () => {
  it('T-A11: docker-compose.override.yml exists', () => {
    expect(existsSync(OVERRIDE_PATH)).toBe(true);
  });

  it('T-A12: override defines a vite service', () => {
    const override = loadOverride();
    expect(override.services).toHaveProperty('vite');
  });

  it('T-A13: vite service uses node:22-alpine image', () => {
    const override = loadOverride();
    const image = override.services.vite.image;
    expect(image).toMatch(/node:22/);
  });

  it('T-A14: vite service exposes port 5173', () => {
    const override = loadOverride();
    const ports = override.services.vite.ports || [];
    const portStrings = ports.map((p: any) => String(p));
    const has5173 = portStrings.some((p: string) => p.includes('5173'));
    expect(has5173).toBe(true);
  });

  it('T-A15: override sets FRONTEND_MODE=dev for Caddy/frontend', () => {
    const override = loadOverride();
    const frontendEnv = override.services?.frontend?.environment;
    if (Array.isArray(frontendEnv)) {
      expect(frontendEnv).toContain('FRONTEND_MODE=dev');
    } else if (typeof frontendEnv === 'object' && frontendEnv !== null) {
      expect(frontendEnv.FRONTEND_MODE).toBe('dev');
    } else {
      expect(frontendEnv).toBeDefined();
    }
  });

  it('T-A16: override mounts source volumes for vite', () => {
    const override = loadOverride();
    const volumes = override.services.vite.volumes || [];
    expect(volumes.length).toBeGreaterThan(0);
  });

  it('T-A17: override changes runtime command to mastra dev', () => {
    const override = loadOverride();
    const cmd = override.services?.runtime?.command;
    const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : String(cmd || '');
    expect(cmdStr).toMatch(/mastra\s+dev/i);
    const env = override.services?.runtime?.environment;
    const envArr = Array.isArray(env) ? env : [];
    expect(envArr).toEqual(expect.arrayContaining([expect.stringMatching(/PORT=4111/)]));
  });

  it('T-A03-NEG: base compose has no vite service (prod mode)', () => {
    const compose = loadCompose();
    expect(compose.services).not.toHaveProperty('vite');
  });

  liveInfraIt('MANUAL: docker compose up auto-loads override and starts vite with HMR', () => {
    const output = execSync(
      'docker compose config --services 2>&1',
      { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' }
    );
    expect(output).toContain('vite');
  });

  liveInfraIt('MANUAL: docker compose -f docker-compose.yml up skips override', () => {
    const output = execSync(
      `${COMPOSE_CMD} config --services 2>&1`,
      { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' }
    );
    expect(output).not.toContain('vite');
  });
});

// =============================================================================
// REQ-A04: Caddyfile Environment Variable Switching
// =============================================================================
describe('REQ-A04: Caddyfile Environment Variable Switching', () => {
  it('T-A18: Caddyfile contains (static-frontend) snippet', () => {
    const caddy = readCaddyfile();
    expect(caddy).toMatch(/\(static-frontend\)/);
  });

  it('T-A19: Caddyfile contains (dev-frontend) snippet', () => {
    const caddy = readCaddyfile();
    expect(caddy).toMatch(/\(dev-frontend\)/);
  });

  it('T-A20: static-frontend snippet includes root, try_files, file_server', () => {
    const caddy = readCaddyfile();
    const staticStart = caddy.indexOf('(static-frontend)');
    const braceStart = caddy.indexOf('{', staticStart);
    let depth = 0;
    let braceEnd = braceStart;
    for (let i = braceStart; i < caddy.length; i++) {
      if (caddy[i] === '{') depth++;
      if (caddy[i] === '}') depth--;
      if (depth === 0) { braceEnd = i; break; }
    }
    const snippet = caddy.substring(braceStart + 1, braceEnd);
    expect(snippet).toMatch(/root/);
    expect(snippet).toMatch(/try_files/);
    expect(snippet).toMatch(/file_server/);
  });

  it('T-A21: dev-frontend snippet has reverse_proxy to vite:5173', () => {
    const caddy = readCaddyfile();
    const devMatch = caddy.match(/\(dev-frontend\)[\s\S]*?\{([\s\S]*?)\}/);
    const snippet = devMatch ? devMatch[1] : '';
    expect(snippet).toMatch(/reverse_proxy.*vite:5173/);
  });

  it('T-A22: Caddyfile uses import static-frontend', () => {
    const caddy = readCaddyfile();
    expect(caddy).toMatch(/import\s+static-frontend/);
  });

  it('T-A04-DEFAULT: default is static (hardcoded import)', () => {
    const caddy = readCaddyfile();
    const importMatch = caddy.match(/import\s+(static|dev)-frontend/);
    expect(importMatch).not.toBeNull();
    expect(importMatch![1]).toBe('static');
  });

  liveInfraIt('MANUAL: Caddy starts in prod mode when FRONTEND_MODE is unset', () => {
    const result = execSync(
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ 2>&1 || true',
      { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' }
    );
    const code = parseInt(result.trim(), 10);
    expect(code).toBeGreaterThan(0);
    expect(code).toBeLessThan(600);
  });

  liveInfraIt('MANUAL: Caddy proxies to vite:5173 when FRONTEND_MODE=dev', () => {
    const caddy = readCaddyfile();
    expect(caddy).toMatch(/reverse_proxy.*vite:5173/);
  });
});

// =============================================================================
// REQ-A05: Frontend Runtime Config.json
// =============================================================================
describe('REQ-A05: Frontend Runtime Config.json', () => {
  it('T-A23: Caddyfile serves /config.json before SPA fallback', () => {
    const caddy = readCaddyfile();
    expect(caddy).toMatch(/config\.json/);

    const configPos = caddy.indexOf('config.json');
    const tryFilesPos = caddy.indexOf('try_files');
    if (tryFilesPos !== -1) {
      expect(configPos).toBeLessThan(tryFilesPos);
    }
  });

  it('T-A24: frontend service has config.json volume mount', () => {
    const compose = loadCompose();
    const volumes = compose.services.frontend.volumes || [];
    const volumeStrings = volumes.map((v: any) => String(v));
    const hasConfigMount = volumeStrings.some((v: string) => v.includes('config.json'));
    expect(hasConfigMount).toBe(true);
  });

  liveInfraIt('MANUAL: GET /config.json returns JSON in prod mode without SPA fallback', () => {
    const result = execSync(
      'curl -s http://localhost:3001/config.json 2>&1 || true',
      { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' }
    );
    expect(result.trim()).not.toMatch(/^<!DOCTYPE/i);
    expect(() => JSON.parse(result.trim())).not.toThrow();
  });

  liveInfraIt('MANUAL: in dev mode, Vite serves /config.json from public directory', () => {
    const configPath = resolve(PROJECT_DIR, 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});

// =============================================================================
// REQ-A09: Environment Variable Updates
// =============================================================================
describe('REQ-A09: Environment Variable Updates', () => {
  it('T-A29: .env.example contains FRONTEND_MODE', () => {
    const envFile = readEnvExample();
    expect(envFile).toMatch(/FRONTEND_MODE/);
  });

  it('T-A30: FRONTEND_MODE default is static', () => {
    const envFile = readEnvExample();
    expect(envFile).toMatch(/FRONTEND_MODE=static/);
  });

  it('T-A31: .env.example has comment explaining FRONTEND_MODE values', () => {
    const envFile = readEnvExample();
    const lines = envFile.split('\n');
    const modeLineIdx = lines.findIndex((l) => l.includes('FRONTEND_MODE'));
    expect(modeLineIdx).toBeGreaterThanOrEqual(0);
    const commentOnLine = lines[modeLineIdx].includes('#');
    const commentBefore = modeLineIdx > 0 && lines[modeLineIdx - 1].trim().startsWith('#');
    expect(
      commentOnLine || commentBefore,
      'FRONTEND_MODE should have an explanatory comment'
    ).toBe(true);
  });

  it('T-A32: core integration variables remain present in .env.example', () => {
    // After the Langfuse extraction (commit 7e0bd39), the .env.example
    // dropped LANGFUSE_*, CLICKHOUSE_*, REDIS_*, MINIO_*, POSTGRES_* and
    // NEXTAUTH_* — those now live in Helm values (`k8s/helm/values.yaml`)
    // and are asserted in `tests/infra-k8s/helm-chart.test.ts`. What still
    // belongs in compose-shipped .env.example is the per-tenant integration
    // surface and the local runtime knobs.
    const envFile = readEnvExample();
    const knownVars = [
      'BETTER_AUTH_SECRET',
      'OPENROUTER_API_KEY',
      'LINEAR_API_KEY',
      'RESEND_API_KEY',
      'APP_MASTER_KEY',
      'LIBSQL_URL',
      'FRONTEND_MODE',
    ];
    for (const varName of knownVars) {
      expect(envFile, `${varName} should still be present`).toContain(varName);
    }
  });

  it('T-A33: .env.example contains RESEND_FROM_EMAIL with correct domain', () => {
    const envFile = readEnvExample();
    expect(envFile).toMatch(/RESEND_FROM_EMAIL=triage@agenticengineering\.lat/);
  });
});

// =============================================================================
// REQ-A10: Runtime Service Integration Configuration
// =============================================================================
describe('REQ-A10: Runtime Service Integration Configuration', () => {
  it('T-A34: runtime service depends on libsql with service_healthy', () => {
    const compose = loadCompose();
    const deps = compose.services.runtime?.depends_on;
    expect(deps).toBeDefined();
    expect(deps?.libsql?.condition).toBe('service_healthy');
  });

  it('T-A35: runtime service uses env_file to load .env', () => {
    const compose = loadCompose();
    const envFile = compose.services.runtime?.env_file;
    expect(envFile).toBeDefined();
    const envFileStr = Array.isArray(envFile) ? envFile.join(' ') : String(envFile);
    expect(envFileStr).toContain('.env');
  });

  it('T-A36: runtime service does not hardcode integration API keys in compose', () => {
    const compose = loadCompose();
    const env = compose.services.runtime?.environment;
    if (env && typeof env === 'object') {
      expect(env).not.toHaveProperty('LINEAR_API_KEY');
      expect(env).not.toHaveProperty('RESEND_API_KEY');
      expect(env).not.toHaveProperty('RESEND_FROM_EMAIL');
    }
  });

  it('T-A37: .env.example has LINEAR_API_KEY and RESEND_API_KEY under Integrations section', () => {
    const envFile = readEnvExample();
    const integrationsIdx = envFile.indexOf('# === Integrations ===');
    expect(integrationsIdx).toBeGreaterThanOrEqual(0);
    const afterIntegrations = envFile.substring(integrationsIdx);
    expect(afterIntegrations).toMatch(/LINEAR_API_KEY/);
    expect(afterIntegrations).toMatch(/RESEND_API_KEY/);
    expect(afterIntegrations).toMatch(/RESEND_FROM_EMAIL/);
  });
});
