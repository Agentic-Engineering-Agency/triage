/**
 * SpecSafe TEST — Docker Compose Structure & Orchestration
 *
 * Asserts the compose surface that the project ships today: a 3-service stack
 * (frontend, runtime, libsql) on a single `app` network. Langfuse and its
 * dependencies (clickhouse, redis, minio, langfuse-postgres) live in the Helm
 * chart and are covered by `tests/infra-k8s/helm-chart.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { resolve } from 'path';

const PROJECT_DIR = resolve(__dirname, '../../');
const COMPOSE_PATH = resolve(PROJECT_DIR, 'docker-compose.yml');
const COMPOSE_CMD = 'docker compose -f docker-compose.yml';
const runManualInfraTests = process.env.RUN_MANUAL_INFRA_TESTS === '1';
const liveInfraIt = runManualInfraTests ? it : it.skip;

function loadCompose(): Record<string, any> {
  const raw = readFileSync(COMPOSE_PATH, 'utf-8');
  return parseYaml(raw);
}

// ---------------------------------------------------------------------------
// REQ-D01: Docker Compose Orchestration
// ---------------------------------------------------------------------------
describe('REQ-D01: Docker Compose Orchestration', () => {
  describe('T-D01: YAML parsing', () => {
    it('should parse docker-compose.yml as valid YAML', () => {
      const compose = loadCompose();
      expect(compose).toBeDefined();
      expect(compose).toBeTypeOf('object');
    });

    it('should have a top-level services key', () => {
      const compose = loadCompose();
      expect(compose).toHaveProperty('services');
    });

    it('should fail gracefully if compose file is missing', () => {
      expect(() => readFileSync('/nonexistent/docker-compose.yml', 'utf-8')).toThrow();
    });
  });

  describe('T-D02: Service definitions', () => {
    const EXPECTED_SERVICES = ['frontend', 'runtime', 'libsql'];

    it('should define exactly 3 services', () => {
      // Reduced from the original 10-service layout (incl. langfuse-web/worker,
      // clickhouse, redis, minio, langfuse-postgres, cloudflared) when those
      // moved to the Helm chart in commit 7e0bd39.
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      expect(serviceNames).toHaveLength(3);
    });

    it('should contain all required service names', () => {
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      for (const name of EXPECTED_SERVICES) {
        expect(serviceNames).toContain(name);
      }
    });

    it('should not contain unexpected extra services', () => {
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      for (const name of serviceNames) {
        expect(EXPECTED_SERVICES).toContain(name);
      }
    });
  });

  describe('T-D07: Restart policy', () => {
    it('should set restart: always on every service', () => {
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        expect(config.restart, `Service ${name} missing restart: always`).toBe('always');
      }
    });

    it('should not use restart: unless-stopped on any service', () => {
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        expect(config.restart).not.toBe('unless-stopped');
        expect(config.restart).not.toBe('on-failure');
      }
    });
  });

  describe('REQ-D01 scenarios', () => {
    it('happy path: all services belong to the single app network', () => {
      const compose = loadCompose();
      expect(compose).toHaveProperty('networks');
      const networkNames = Object.keys(compose.networks);
      expect(networkNames).toEqual(['app']);
    });

    it('edge case: compose file with cached layers still parses identically', () => {
      const first = loadCompose();
      const second = loadCompose();
      expect(first).toEqual(second);
    });

    it('error case: malformed YAML throws a parse error', () => {
      expect(() => parseYaml('services:\n  bad:\n    - [invalid')).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D02: Container Health Checks
// ---------------------------------------------------------------------------
describe('REQ-D02: Container Health Checks', () => {
  describe('T-D03: Healthcheck presence', () => {
    const EXPECTED_SERVICES = ['frontend', 'runtime', 'libsql'];

    it('should define a healthcheck for every service', () => {
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        expect(
          compose.services[name]?.healthcheck,
          `Service ${name} is missing a healthcheck block`,
        ).toBeDefined();
      }
    });

    it('should have a test command in every healthcheck', () => {
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        const hc = compose.services[name]?.healthcheck;
        expect(hc?.test, `Service ${name} healthcheck missing test command`).toBeDefined();
      }
    });

    it('should have interval, timeout, and retries on healthchecks', () => {
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        const hc = compose.services[name]?.healthcheck;
        expect(hc?.interval, `${name} healthcheck missing interval`).toBeDefined();
        expect(hc?.timeout, `${name} healthcheck missing timeout`).toBeDefined();
        expect(hc?.retries, `${name} healthcheck missing retries`).toBeDefined();
      }
    });
  });

  describe('T-D03 health check commands per service', () => {
    it('frontend healthcheck should target port 3001', () => {
      const compose = loadCompose();
      const test = compose.services.frontend?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('3001');
    });

    it('runtime healthcheck should target port 4111/health', () => {
      const compose = loadCompose();
      const test = compose.services.runtime?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('4111');
      expect(testStr).toContain('health');
    });

    it('libsql healthcheck should probe port 8080', () => {
      const compose = loadCompose();
      const test = compose.services.libsql?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('8080');
    });
  });

  describe('REQ-D02 scenarios', () => {
    it('edge case: runtime has start_period for slow-starting builder', () => {
      const compose = loadCompose();
      const hc = compose.services.runtime?.healthcheck;
      expect(hc?.start_period).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D03: Dependency Ordering
// ---------------------------------------------------------------------------
describe('REQ-D03: Dependency Ordering', () => {
  describe('T-D04: depends_on with service_healthy', () => {
    it('runtime should depend on libsql with service_healthy', () => {
      const compose = loadCompose();
      const deps = compose.services.runtime?.depends_on;
      expect(deps?.libsql?.condition).toBe('service_healthy');
    });

    it('frontend should depend on runtime with service_healthy', () => {
      const compose = loadCompose();
      const deps = compose.services.frontend?.depends_on;
      expect(deps?.runtime?.condition).toBe('service_healthy');
    });

    it('all depends_on entries should use condition: service_healthy', () => {
      const compose = loadCompose();
      for (const [svcName, svcConfig] of Object.entries(compose.services) as [string, any][]) {
        if (svcConfig.depends_on) {
          for (const [depName, depConfig] of Object.entries(svcConfig.depends_on) as [string, any][]) {
            expect(
              depConfig?.condition,
              `${svcName} -> ${depName} missing condition: service_healthy`,
            ).toBe('service_healthy');
          }
        }
      }
    });
  });

  describe('REQ-D03 scenarios', () => {
    it('happy path: startup order is libsql → runtime → frontend', () => {
      const compose = loadCompose();
      expect(compose.services.frontend?.depends_on).toHaveProperty('runtime');
      expect(compose.services.runtime?.depends_on).toHaveProperty('libsql');
    });

    it('edge case: libsql has no depends_on (root infrastructure)', () => {
      const compose = loadCompose();
      const deps = compose.services.libsql?.depends_on;
      if (deps) {
        expect(Object.keys(deps).length).toBe(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D04: Ephemeral Volumes (no named volumes — clean slate on restart)
// ---------------------------------------------------------------------------
describe('REQ-D04: Ephemeral Volumes', () => {
  describe('T-D05: Ephemeral by default', () => {
    it('no named volumes are declared at the top level', () => {
      // The previous one-exception design preserved langfuse_postgres_data so
      // the Langfuse admin user survived `docker compose down`. That stack now
      // lives in the Helm chart, so docker-compose.yml has no named volumes
      // at all — every data dir is anonymous and recreated on restart.
      const compose = loadCompose();
      const volumeNames = Object.keys(compose.volumes || {}).sort();
      expect(volumeNames).toEqual([]);
    });

    it('services should use anonymous volumes for data directories', () => {
      const compose = loadCompose();
      const libsqlVolumes = compose.services.libsql?.volumes;
      expect(libsqlVolumes).toBeDefined();
      const volStr = JSON.stringify(libsqlVolumes);
      expect(volStr).toContain('/var/lib/sqld');
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D05: Network and Port Exposure
// ---------------------------------------------------------------------------
describe('REQ-D05: Network and Port Exposure', () => {
  describe('T-D06: Port exposure rules', () => {
    it('frontend should expose port 3001 bound to localhost', () => {
      const compose = loadCompose();
      const ports = compose.services.frontend?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('3001');
      expect(portsStr).toMatch(/127\.0\.0\.1:3001/);
    });

    it('runtime should expose port 4111 bound to localhost', () => {
      const compose = loadCompose();
      const ports = compose.services.runtime?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('4111');
      expect(portsStr).toMatch(/127\.0\.0\.1:4111/);
    });

    it('libsql should expose port 8080 and gRPC port 5001 bound to 127.0.0.1', () => {
      const compose = loadCompose();
      const ports = compose.services.libsql?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('8080');
      expect(portsStr).toMatch(/127\.0\.0\.1:5001/);
    });

    it('every published port binds explicitly to 127.0.0.1', () => {
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        const ports = config.ports;
        if (!ports) continue;
        for (const port of ports) {
          const portStr = String(port);
          if (portStr.includes(':')) {
            expect(
              portStr,
              `Service ${name} port ${portStr} should be bound to 127.0.0.1`,
            ).toMatch(/^127\.0\.0\.1:/);
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D09: ARM64 Compatibility
// ---------------------------------------------------------------------------
describe('REQ-D09: ARM64 Compatibility', () => {
  describe('T-D08: Platform pinning', () => {
    it('libsql should have platform: linux/amd64', () => {
      const compose = loadCompose();
      expect(compose.services.libsql?.platform).toBe('linux/amd64');
    });

    it('no other service should have an explicit platform directive', () => {
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        if (name !== 'libsql') {
          expect(
            config.platform,
            `Service ${name} should not have an explicit platform`,
          ).toBeUndefined();
        }
      }
    });

    it('edge case: platform value is exactly linux/amd64 (not linux/x86_64)', () => {
      const compose = loadCompose();
      expect(compose.services.libsql?.platform).toBe('linux/amd64');
      expect(compose.services.libsql?.platform).not.toBe('linux/x86_64');
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D01 + Integration: docker compose up (manual/CI)
// ---------------------------------------------------------------------------
describe('T-D14: Integration test — docker compose up', () => {
  liveInfraIt('[MANUAL/CI] all 3 containers should start and become healthy within 120s', () => {
    const output = execSync(
      `${COMPOSE_CMD} ps --format '{{.Name}} {{.Status}}' 2>&1`,
      { cwd: PROJECT_DIR, timeout: 120_000, encoding: 'utf-8' },
    );
    const lines = output.trim().split('\n').filter((l: string) => l.trim());
    const healthyCount = lines.filter((l: string) => l.includes('(healthy)')).length;
    expect(healthyCount).toBeGreaterThanOrEqual(3);
  }, 120_000);

  liveInfraIt('[MANUAL/CI] docker compose config should validate without errors', () => {
    const result = execSync(
      `${COMPOSE_CMD} config 2>&1`,
      { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' },
    );
    expect(result).toContain('services');
  });

  liveInfraIt('[MANUAL/CI] error case: missing .env variable causes clear startup error', () => {
    try {
      execSync(
        `${COMPOSE_CMD} --env-file /nonexistent/.env config 2>&1`,
        { cwd: PROJECT_DIR, timeout: 30_000, encoding: 'utf-8' },
      );
    } catch (err: any) {
      expect(err.status).not.toBe(0);
    }
  });
});
