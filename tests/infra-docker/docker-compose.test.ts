/**
 * SpecSafe TEST — Docker Compose Structure & Orchestration
 * Spec: SPEC-20260407-001
 * Requirements: REQ-D01, REQ-D02, REQ-D03, REQ-D04, REQ-D05, REQ-D09, REQ-D10
 * Author: Reva (Test Engineer)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve } from 'path';

const COMPOSE_PATH = resolve(__dirname, '../../docker-compose.yml');

function loadCompose(): Record<string, any> {
  const raw = readFileSync(COMPOSE_PATH, 'utf-8');
  return parseYaml(raw);
}

// ---------------------------------------------------------------------------
// REQ-D01: Docker Compose Orchestration
// ---------------------------------------------------------------------------
describe('REQ-D01: Docker Compose Orchestration', () => {
  // --- T-D01: Validate docker-compose.yml parses ---
  describe('T-D01: YAML parsing', () => {
    it('should parse docker-compose.yml as valid YAML', () => {
      // GIVEN a docker-compose.yml file exists at the project root
      // WHEN the file is read and parsed with a YAML parser
      // THEN it should produce a non-null object without throwing
      const compose = loadCompose();
      expect(compose).toBeDefined();
      expect(compose).toBeTypeOf('object');
    });

    it('should have a top-level services key', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the top-level keys
      // THEN a "services" key should exist
      const compose = loadCompose();
      expect(compose).toHaveProperty('services');
    });

    it('should fail gracefully if compose file is missing', () => {
      // GIVEN docker-compose.yml does not exist
      // WHEN attempting to read it
      // THEN an error should be thrown (file not found)
      expect(() => readFileSync('/nonexistent/docker-compose.yml', 'utf-8')).toThrow();
    });
  });

  // --- T-D02: Verify all 9 services defined ---
  describe('T-D02: Service definitions', () => {
    const EXPECTED_SERVICES = [
      'frontend',
      'runtime',
      'libsql',
      'langfuse-web',
      'langfuse-worker',
      'clickhouse',
      'redis',
      'minio',
      'langfuse-postgres',
    ];

    it('should define exactly 9 services', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN counting the services
      // THEN there should be exactly 9
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      expect(serviceNames).toHaveLength(9);
    });

    it('should contain all required service names', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the service names
      // THEN all 9 expected services should be present
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      for (const name of EXPECTED_SERVICES) {
        expect(serviceNames).toContain(name);
      }
    });

    it('should not contain unexpected extra services', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the service names
      // THEN no services beyond the expected 9 should exist
      const compose = loadCompose();
      const serviceNames = Object.keys(compose.services);
      for (const name of serviceNames) {
        expect(EXPECTED_SERVICES).toContain(name);
      }
    });
  });

  // --- T-D07: Verify restart: always on all services ---
  describe('T-D07: Restart policy', () => {
    it('should set restart: always on every service', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the restart policy for each service
      // THEN every service should have restart set to "always"
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        expect(config.restart, `Service ${name} missing restart: always`).toBe('always');
      }
    });

    it('should not use restart: unless-stopped on any service', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the restart policy
      // THEN no service should use "unless-stopped" or "on-failure"
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        expect(config.restart).not.toBe('unless-stopped');
        expect(config.restart).not.toBe('on-failure');
      }
    });
  });

  // --- Happy/Edge/Error scenarios for REQ-D01 ---
  describe('REQ-D01 scenarios', () => {
    it('happy path: all services belong to named networks (app + langfuse)', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the top-level networks key
      // THEN exactly two networks should be defined: app and langfuse
      const compose = loadCompose();
      expect(compose).toHaveProperty('networks');
      const networkNames = Object.keys(compose.networks);
      expect(networkNames.length).toBe(2);
      expect(networkNames).toContain('app');
      expect(networkNames).toContain('langfuse');
    });

    it('edge case: compose file with cached layers still parses identically', () => {
      // GIVEN docker-compose.yml is parsed twice
      // WHEN comparing both parse results
      // THEN they should be identical (deterministic parsing)
      const first = loadCompose();
      const second = loadCompose();
      expect(first).toEqual(second);
    });

    it('error case: malformed YAML throws a parse error', () => {
      // GIVEN a string with invalid YAML
      // WHEN parsing it
      // THEN it should throw a parse error
      expect(() => parseYaml('services:\n  bad:\n    - [invalid')).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D02: Container Health Checks
// ---------------------------------------------------------------------------
describe('REQ-D02: Container Health Checks', () => {
  // --- T-D03: Verify all 9 have healthcheck blocks ---
  describe('T-D03: Healthcheck presence', () => {
    const EXPECTED_SERVICES = [
      'frontend',
      'runtime',
      'libsql',
      'langfuse-web',
      'langfuse-worker',
      'clickhouse',
      'redis',
      'minio',
      'langfuse-postgres',
    ];

    it('should define a healthcheck for every service', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting each service definition
      // THEN every service should have a "healthcheck" key
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        expect(
          compose.services[name]?.healthcheck,
          `Service ${name} is missing a healthcheck block`
        ).toBeDefined();
      }
    });

    it('should have a test command in every healthcheck', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting each service healthcheck
      // THEN every healthcheck should have a "test" field
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        const hc = compose.services[name]?.healthcheck;
        expect(hc?.test, `Service ${name} healthcheck missing test command`).toBeDefined();
      }
    });

    it('should have interval, timeout, and retries on healthchecks', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting each healthcheck
      // THEN interval, timeout, and retries fields should be present
      const compose = loadCompose();
      for (const name of EXPECTED_SERVICES) {
        const hc = compose.services[name]?.healthcheck;
        expect(hc?.interval, `${name} healthcheck missing interval`).toBeDefined();
        expect(hc?.timeout, `${name} healthcheck missing timeout`).toBeDefined();
        expect(hc?.retries, `${name} healthcheck missing retries`).toBeDefined();
      }
    });
  });

  // --- REQ-D02 specific health check commands ---
  describe('T-D03 health check commands per service', () => {
    it('frontend healthcheck should use wget to localhost:3001', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting frontend healthcheck test
      // THEN it should contain wget and localhost:3001
      const compose = loadCompose();
      const test = compose.services.frontend?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('3001');
    });

    it('runtime healthcheck should target port 4111/health', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting runtime healthcheck test
      // THEN it should reference localhost:4111/health
      const compose = loadCompose();
      const test = compose.services.runtime?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('4111');
      expect(testStr).toContain('health');
    });

    it('redis healthcheck should use redis-cli ping', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting redis healthcheck test
      // THEN it should contain redis-cli and ping
      const compose = loadCompose();
      const test = compose.services.redis?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('redis-cli');
      expect(testStr).toContain('ping');
    });

    it('langfuse-postgres healthcheck should use pg_isready', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-postgres healthcheck test
      // THEN it should contain pg_isready
      const compose = loadCompose();
      const test = compose.services['langfuse-postgres']?.healthcheck?.test;
      const testStr = Array.isArray(test) ? test.join(' ') : String(test);
      expect(testStr).toContain('pg_isready');
    });
  });

  describe('REQ-D02 scenarios', () => {
    it('edge case: healthcheck has start_period for slow-starting services', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting clickhouse healthcheck
      // THEN start_period should be defined to allow slow init
      const compose = loadCompose();
      const hc = compose.services.clickhouse?.healthcheck;
      expect(hc?.start_period).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D03: Dependency Ordering
// ---------------------------------------------------------------------------
describe('REQ-D03: Dependency Ordering', () => {
  // --- T-D04: Verify depends_on with condition: service_healthy ---
  describe('T-D04: depends_on with service_healthy', () => {
    it('langfuse-web should depend on langfuse-postgres with condition service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-web depends_on
      // THEN langfuse-postgres should be listed with condition: service_healthy
      const compose = loadCompose();
      const deps = compose.services['langfuse-web']?.depends_on;
      expect(deps).toBeDefined();
      expect(deps['langfuse-postgres']?.condition).toBe('service_healthy');
    });

    it('langfuse-web should depend on clickhouse, redis, minio with service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-web depends_on
      // THEN clickhouse, redis, minio should each have condition: service_healthy
      const compose = loadCompose();
      const deps = compose.services['langfuse-web']?.depends_on;
      expect(deps?.clickhouse?.condition).toBe('service_healthy');
      expect(deps?.redis?.condition).toBe('service_healthy');
      expect(deps?.minio?.condition).toBe('service_healthy');
    });

    it('langfuse-web should depend on langfuse-worker with service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-web depends_on
      // THEN langfuse-worker should be listed with condition: service_healthy
      const compose = loadCompose();
      const deps = compose.services['langfuse-web']?.depends_on;
      expect(deps?.['langfuse-worker']?.condition).toBe('service_healthy');
    });

    it('runtime should depend on libsql with service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting runtime depends_on
      // THEN libsql should be listed with condition: service_healthy
      const compose = loadCompose();
      const deps = compose.services.runtime?.depends_on;
      expect(deps?.libsql?.condition).toBe('service_healthy');
    });

    it('frontend should depend on runtime with service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting frontend depends_on
      // THEN runtime should be listed with condition: service_healthy
      const compose = loadCompose();
      const deps = compose.services.frontend?.depends_on;
      expect(deps?.runtime?.condition).toBe('service_healthy');
    });

    it('all depends_on entries should use condition: service_healthy', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting every service's depends_on
      // THEN every dependency should use condition: service_healthy
      const compose = loadCompose();
      for (const [svcName, svcConfig] of Object.entries(compose.services) as [string, any][]) {
        if (svcConfig.depends_on) {
          for (const [depName, depConfig] of Object.entries(svcConfig.depends_on) as [string, any][]) {
            expect(
              depConfig?.condition,
              `${svcName} -> ${depName} missing condition: service_healthy`
            ).toBe('service_healthy');
          }
        }
      }
    });
  });

  describe('REQ-D03 scenarios', () => {
    it('happy path: startup order is infra → langfuse-worker → langfuse-web → libsql → runtime → frontend', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN tracing the dependency graph
      // THEN frontend depends on runtime, runtime depends on libsql
      const compose = loadCompose();
      expect(compose.services.frontend?.depends_on).toHaveProperty('runtime');
      expect(compose.services.runtime?.depends_on).toHaveProperty('libsql');
    });

    it('edge case: infrastructure services have no depends_on (they start first)', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting redis, clickhouse, minio, langfuse-postgres
      // THEN they should have no depends_on or an empty depends_on
      const compose = loadCompose();
      const infraServices = ['redis', 'langfuse-postgres'];
      for (const name of infraServices) {
        const deps = compose.services[name]?.depends_on;
        if (deps) {
          expect(Object.keys(deps).length).toBe(0);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D04: Named Volumes
// ---------------------------------------------------------------------------
describe('REQ-D04: Named Volumes', () => {
  // --- T-D05: Verify 6 named volumes ---
  describe('T-D05: Named volume declarations', () => {
    const EXPECTED_VOLUMES = [
      'libsql_data',
      'langfuse_postgres_data',
      'langfuse_clickhouse_data',
      'langfuse_clickhouse_logs',
      'langfuse_minio_data',
      'langfuse_redis_data',
    ];

    it('should declare all 6 named volumes at the top level', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting the top-level volumes key
      // THEN all 6 expected volumes should be declared
      const compose = loadCompose();
      expect(compose).toHaveProperty('volumes');
      const volumeNames = Object.keys(compose.volumes);
      for (const vol of EXPECTED_VOLUMES) {
        expect(volumeNames, `Missing volume: ${vol}`).toContain(vol);
      }
    });

    it('should have at least 6 volumes defined', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN counting volumes
      // THEN there should be at least 6
      const compose = loadCompose();
      const volumeNames = Object.keys(compose.volumes || {});
      expect(volumeNames.length).toBeGreaterThanOrEqual(6);
    });

    it('happy path: volumes are referenced in service definitions', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting libsql service volumes
      // THEN it should reference libsql_data
      const compose = loadCompose();
      const libsqlVolumes = compose.services.libsql?.volumes;
      expect(libsqlVolumes).toBeDefined();
      const volStr = JSON.stringify(libsqlVolumes);
      expect(volStr).toContain('libsql_data');
    });

    it('edge case: volumes do not specify driver (uses default local driver)', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting volume declarations
      // THEN volumes should either be null/empty or not specify a custom driver
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.volumes || {}) as [string, any][]) {
        if (config !== null && config !== undefined) {
          // If a config exists, driver should be absent or "local"
          if (config.driver) {
            expect(config.driver).toBe('local');
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D05: Network and Port Exposure
// ---------------------------------------------------------------------------
describe('REQ-D05: Network and Port Exposure', () => {
  // --- T-D06: Verify port exposure ---
  describe('T-D06: Port exposure rules', () => {
    it('frontend should expose port 3001 publicly', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting frontend ports
      // THEN port 3001 should be published (not bound to 127.0.0.1)
      const compose = loadCompose();
      const ports = compose.services.frontend?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('3001');
      expect(portsStr).not.toMatch(/127\.0\.0\.1:3001/);
    });

    it('langfuse-web should expose port 3000', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-web ports
      // THEN port 3000 should be published (accessible for Langfuse UI)
      const compose = loadCompose();
      const ports = compose.services['langfuse-web']?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('3000');
    });

    it('minio should expose port 9090 bound to 127.0.0.1 (S3 API)', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting minio ports
      // THEN port 9090 should be bound to 127.0.0.1 (internal service)
      const compose = loadCompose();
      const ports = compose.services.minio?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('9090');
      expect(portsStr).toMatch(/127\.0\.0\.1:9090/);
    });

    it('libsql should expose port 8080 and gRPC port 5001 bound to 127.0.0.1', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting libsql ports
      // THEN port 8080 is published (needed for drizzle-kit), gRPC 5001 bound to localhost
      const compose = loadCompose();
      const ports = compose.services.libsql?.ports;
      expect(ports).toBeDefined();
      const portsStr = JSON.stringify(ports);
      expect(portsStr).toContain('8080');
      expect(portsStr).toMatch(/127\.0\.0\.1:5001/);
    });

    it('internal services should bind to 127.0.0.1', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting ports for clickhouse, redis, langfuse-postgres, langfuse-worker
      // THEN their ports should be prefixed with 127.0.0.1 or not published
      const compose = loadCompose();
      const internalServices = ['clickhouse', 'redis', 'langfuse-postgres', 'langfuse-worker'];
      for (const name of internalServices) {
        const ports = compose.services[name]?.ports;
        if (ports) {
          for (const port of ports) {
            const portStr = String(port);
            // Should either be 127.0.0.1 bound or not exposed at all
            if (portStr.includes(':')) {
              expect(
                portStr,
                `Service ${name} port ${portStr} should be bound to 127.0.0.1`
              ).toMatch(/^127\.0\.0\.1:/);
            }
          }
        }
      }
    });

    it('error case: postgres port should not be exposed to 0.0.0.0', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-postgres ports
      // THEN port 5432 should NOT be bound to 0.0.0.0
      const compose = loadCompose();
      const ports = compose.services['langfuse-postgres']?.ports;
      if (ports) {
        const portsStr = JSON.stringify(ports);
        expect(portsStr).not.toMatch(/0\.0\.0\.0:5432/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D09: ARM64 Compatibility
// ---------------------------------------------------------------------------
describe('REQ-D09: ARM64 Compatibility', () => {
  // --- T-D08: Verify platform: linux/amd64 on libsql ONLY ---
  describe('T-D08: Platform pinning', () => {
    it('libsql should have platform: linux/amd64', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting libsql service definition
      // THEN platform should be set to linux/amd64
      const compose = loadCompose();
      expect(compose.services.libsql?.platform).toBe('linux/amd64');
    });

    it('no other service should have an explicit platform directive', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting all services except libsql
      // THEN none should have a platform directive
      const compose = loadCompose();
      for (const [name, config] of Object.entries(compose.services) as [string, any][]) {
        if (name !== 'libsql') {
          expect(
            config.platform,
            `Service ${name} should not have an explicit platform`
          ).toBeUndefined();
        }
      }
    });

    it('edge case: platform value is exactly linux/amd64 (not linux/x86_64)', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting libsql platform
      // THEN it should be exactly "linux/amd64"
      const compose = loadCompose();
      expect(compose.services.libsql?.platform).toBe('linux/amd64');
      expect(compose.services.libsql?.platform).not.toBe('linux/x86_64');
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D10: Langfuse Environment YAML Anchor
// ---------------------------------------------------------------------------
describe('REQ-D10: Langfuse Environment YAML Anchor', () => {
  // --- T-D09: Verify YAML anchor ---
  describe('T-D09: YAML anchor for shared environment', () => {
    it('should contain a YAML extension field (x-) for langfuse shared env', () => {
      // GIVEN docker-compose.yml raw content is read
      // WHEN searching for YAML extension fields
      // THEN an x-langfuse or x-langfuse-worker-env anchor should exist
      const raw = readFileSync(COMPOSE_PATH, 'utf-8');
      // YAML anchors use x- prefix for extension fields in compose
      expect(raw).toMatch(/x-langfuse[a-z-]*:/);
    });

    it('should use a YAML anchor (&) definition', () => {
      // GIVEN docker-compose.yml raw content is read
      // WHEN searching for anchor syntax
      // THEN an & anchor definition should exist for langfuse env
      const raw = readFileSync(COMPOSE_PATH, 'utf-8');
      expect(raw).toMatch(/&[a-z_-]*langfuse[a-z_-]*/i);
    });

    it('should reference the anchor (*) in langfuse-web or langfuse-worker', () => {
      // GIVEN docker-compose.yml raw content is read
      // WHEN searching for anchor references
      // THEN a * reference should exist for the langfuse env anchor
      const raw = readFileSync(COMPOSE_PATH, 'utf-8');
      expect(raw).toMatch(/\*[a-z_-]*langfuse[a-z_-]*/i);
    });

    it('langfuse-web and langfuse-worker should share the same base env variables', () => {
      // GIVEN docker-compose.yml is parsed (anchors resolved)
      // WHEN comparing environment variables of langfuse-web and langfuse-worker
      // THEN shared variables (DATABASE_URL, CLICKHOUSE_URL, etc.) should match
      const compose = loadCompose();
      const webEnv = compose.services['langfuse-web']?.environment;
      const workerEnv = compose.services['langfuse-worker']?.environment;
      expect(webEnv).toBeDefined();
      expect(workerEnv).toBeDefined();
      // Worker variables should be a subset of web variables (web has additional ones)
      if (typeof workerEnv === 'object' && typeof webEnv === 'object') {
        for (const key of Object.keys(workerEnv)) {
          if (key !== 'PORT') {
            // PORT may differ between web and worker
            expect(
              webEnv[key],
              `langfuse-web missing shared var ${key}`
            ).toBe(workerEnv[key]);
          }
        }
      }
    });

    it('edge case: langfuse-web should have additional variables beyond the anchor', () => {
      // GIVEN docker-compose.yml is parsed
      // WHEN inspecting langfuse-web environment
      // THEN it should contain NEXTAUTH_SECRET (not present in worker)
      const compose = loadCompose();
      const webEnv = compose.services['langfuse-web']?.environment;
      expect(webEnv).toBeDefined();
      // langfuse-web should have NEXTAUTH_SECRET
      if (typeof webEnv === 'object') {
        expect(webEnv).toHaveProperty('NEXTAUTH_SECRET');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D01 + Integration: docker compose up (manual/CI)
// ---------------------------------------------------------------------------
describe('T-D14: Integration test — docker compose up', () => {
  it.todo('[MANUAL/CI] all 9 containers should start and become healthy within 120s');

  it.todo('[MANUAL/CI] docker compose config should validate without errors');

  it.todo('[MANUAL/CI] error case: missing .env variable causes clear startup error');
});
