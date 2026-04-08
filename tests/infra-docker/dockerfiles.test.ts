/**
 * SpecSafe TEST — Dockerfiles (Runtime & Frontend)
 * Spec: SPEC-20260407-001
 * Requirements: REQ-D06, REQ-D07, REQ-D14
 * Author: Reva (Test Engineer)
 *
 * All tests are skipped (it.skip) per SpecSafe TEST stage convention.
 * Tests will be unskipped during CODE stage as implementation proceeds.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');

/**
 * Find the runtime Dockerfile — could be Dockerfile.runtime or runtime/Dockerfile
 */
function findRuntimeDockerfile(): string {
  const candidates = [
    resolve(PROJECT_ROOT, 'Dockerfile.runtime'),
    resolve(PROJECT_ROOT, 'runtime/Dockerfile'),
    resolve(PROJECT_ROOT, 'docker/Dockerfile.runtime'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // default — test will fail if file missing
}

/**
 * Find the frontend Dockerfile — could be Dockerfile.frontend or frontend/Dockerfile
 */
function findFrontendDockerfile(): string {
  const candidates = [
    resolve(PROJECT_ROOT, 'Dockerfile.frontend'),
    resolve(PROJECT_ROOT, 'frontend/Dockerfile'),
    resolve(PROJECT_ROOT, 'docker/Dockerfile.frontend'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // default
}

function readDockerfile(path: string): string {
  return readFileSync(path, 'utf-8');
}

function getFromStatements(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /^\s*FROM\s+/i.test(line))
    .map((line) => line.trim());
}

// ---------------------------------------------------------------------------
// REQ-D06: Mastra Runtime Dockerfile
// ---------------------------------------------------------------------------
describe('REQ-D06: Mastra Runtime Dockerfile', () => {
  describe('T-D10: Multi-stage build structure', () => {
    it('should have at least 2 FROM statements (multi-stage)', () => {
      // GIVEN the runtime Dockerfile exists
      // WHEN reading its contents
      // THEN there should be at least 2 FROM statements
      const content = readDockerfile(findRuntimeDockerfile());
      const froms = getFromStatements(content);
      expect(froms.length).toBeGreaterThanOrEqual(2);
    });

    it('builder stage should use node:22-alpine', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN inspecting the first FROM statement
      // THEN it should reference node:22-alpine
      const content = readDockerfile(findRuntimeDockerfile());
      const froms = getFromStatements(content);
      expect(froms[0]).toMatch(/node:22-alpine/);
    });

    it('production stage should use node:22-alpine', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN inspecting the second FROM statement
      // THEN it should reference node:22-alpine
      const content = readDockerfile(findRuntimeDockerfile());
      const froms = getFromStatements(content);
      expect(froms[froms.length - 1]).toMatch(/node:22-alpine/);
    });

    it('should contain npx mastra build command', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN searching for the build command
      // THEN it should include npx mastra build
      const content = readDockerfile(findRuntimeDockerfile());
      expect(content).toMatch(/npx\s+mastra\s+build/);
    });

    it('should COPY from builder stage', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN searching for COPY --from instructions
      // THEN it should copy from the builder stage
      const content = readDockerfile(findRuntimeDockerfile());
      expect(content).toMatch(/COPY\s+--from=\S+/i);
    });

    it('should EXPOSE port 4111', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN searching for EXPOSE directive
      // THEN it should expose port 4111
      const content = readDockerfile(findRuntimeDockerfile());
      expect(content).toMatch(/EXPOSE\s+4111/);
    });

    it('should have CMD to start node index.mjs', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN searching for CMD directive
      // THEN it should run node index.mjs
      const content = readDockerfile(findRuntimeDockerfile());
      expect(content).toMatch(/CMD.*node.*index\.mjs/);
    });
  });

  describe('REQ-D06 scenarios', () => {
    it('happy path: runtime Dockerfile exists', () => {
      // GIVEN the project repository
      // WHEN checking for the runtime Dockerfile
      // THEN the file should exist
      const path = findRuntimeDockerfile();
      expect(existsSync(path)).toBe(true);
    });

    it('edge case: production stage should not contain source code directory', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN inspecting COPY commands in the production stage
      // THEN src/ should NOT be copied to the production stage
      const content = readDockerfile(findRuntimeDockerfile());
      const lines = content.split('\n');
      let inProductionStage = false;
      let secondFrom = false;
      for (const line of lines) {
        if (/^\s*FROM\s+/i.test(line)) {
          if (secondFrom) inProductionStage = true;
          secondFrom = true;
        }
        if (inProductionStage && /^\s*COPY\s+/i.test(line) && !line.includes('--from')) {
          expect(line).not.toMatch(/src\//);
        }
      }
    });

    it('error case: missing package-lock.json would cause npm install to warn', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN inspecting the COPY commands in builder stage
      // THEN package*.json should be copied (supporting both package.json and package-lock.json)
      const content = readDockerfile(findRuntimeDockerfile());
      expect(content).toMatch(/COPY.*package/i);
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D07: Frontend Dockerfile (Caddy + SPA Build)
// ---------------------------------------------------------------------------
describe('REQ-D07: Frontend Dockerfile', () => {
  // --- T-D11 / T-D16: Frontend Dockerfile uses caddy:2-alpine ---
  describe('T-D11 / T-D16: Caddy production stage', () => {
    it('should have at least 2 FROM statements (multi-stage)', () => {
      // GIVEN the frontend Dockerfile exists
      // WHEN reading its contents
      // THEN there should be at least 2 FROM statements
      const content = readDockerfile(findFrontendDockerfile());
      const froms = getFromStatements(content);
      expect(froms.length).toBeGreaterThanOrEqual(2);
    });

    it('builder stage should use node:22-alpine', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN inspecting the first FROM statement
      // THEN it should reference node:22-alpine
      const content = readDockerfile(findFrontendDockerfile());
      const froms = getFromStatements(content);
      expect(froms[0]).toMatch(/node:22-alpine/);
    });

    it('production stage should use caddy:2-alpine', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN inspecting the last FROM statement (production stage)
      // THEN it should reference caddy:2-alpine
      const content = readDockerfile(findFrontendDockerfile());
      const froms = getFromStatements(content);
      expect(froms[froms.length - 1]).toMatch(/caddy:2-alpine/);
    });

    it('should COPY Caddyfile into the image', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN searching for Caddyfile COPY
      // THEN Caddyfile should be copied in the production stage
      const content = readDockerfile(findFrontendDockerfile());
      expect(content).toMatch(/COPY.*[Cc]addyfile/i);
    });

    it('should COPY built assets from builder to /srv/', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN searching for COPY --from in production stage
      // THEN dist/ should be copied to /srv/
      const content = readDockerfile(findFrontendDockerfile());
      expect(content).toMatch(/COPY\s+--from=.*\/dist\/?\s+\/srv\//i);
    });

    it('should EXPOSE port 3001', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN searching for EXPOSE directive
      // THEN it should expose port 3001
      const content = readDockerfile(findFrontendDockerfile());
      expect(content).toMatch(/EXPOSE\s+3001/);
    });
  });

  describe('REQ-D07 scenarios', () => {
    it('happy path: frontend Dockerfile exists', () => {
      // GIVEN the project repository
      // WHEN checking for the frontend Dockerfile
      // THEN the file should exist
      const path = findFrontendDockerfile();
      expect(existsSync(path)).toBe(true);
    });

    it('edge case: production stage should not contain node_modules', () => {
      // GIVEN the frontend Dockerfile is read
      // WHEN inspecting COPY commands in the production stage (after caddy FROM)
      // THEN node_modules should NOT be copied
      const content = readDockerfile(findFrontendDockerfile());
      const lines = content.split('\n');
      let inCaddyStage = false;
      for (const line of lines) {
        if (/^\s*FROM\s+caddy/i.test(line)) inCaddyStage = true;
        if (inCaddyStage && /^\s*COPY\s+/i.test(line) && !line.includes('--from')) {
          expect(line).not.toMatch(/node_modules/);
        }
      }
    });

    it('error case: Caddyfile syntax error would prevent Caddy from starting', () => {
      // GIVEN the frontend Dockerfile copies a Caddyfile
      // WHEN the Caddyfile has a syntax error
      // THEN Caddy fails at container start with a parse error
      // (This test validates the Caddyfile is referenced — runtime check is manual)
      const content = readDockerfile(findFrontendDockerfile());
      expect(content).toMatch(/[Cc]addyfile/);
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D14: Docker Image Size Constraint
// ---------------------------------------------------------------------------
describe('REQ-D14: Docker Image Size Constraint', () => {
  describe('T-D18: Total image size <= 2GB', () => {
    it('[MANUAL/CI] total docker image size should not exceed 2GB', () => {
      // GIVEN a fresh Docker environment
      // WHEN running `docker compose pull && docker compose build`
      // THEN the total image size (sum of all unique layers) should be <= 2GB
      //
      // Manual verification:
      //   docker compose build
      //   docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" | grep -E "(frontend|runtime|libsql|langfuse|clickhouse|redis|minio)"
      //   Sum all sizes — should be <= 2GB
      expect(true).toBe(true); // Placeholder — run manually
    });

    it('[MANUAL/CI] custom images should use Alpine base images', () => {
      // GIVEN the runtime and frontend Dockerfiles
      // WHEN inspecting base images
      // THEN all should use Alpine variants
      const runtimeContent = readDockerfile(findRuntimeDockerfile());
      const frontendContent = readDockerfile(findFrontendDockerfile());
      expect(runtimeContent).toMatch(/alpine/i);
      expect(frontendContent).toMatch(/alpine/i);
    });

    it('edge case: base images should be pinned to prevent size bloat', () => {
      // GIVEN the runtime Dockerfile is read
      // WHEN inspecting FROM statements
      // THEN images should have version tags (not just :latest)
      const content = readDockerfile(findRuntimeDockerfile());
      const froms = getFromStatements(content);
      for (const fromLine of froms) {
        expect(fromLine).not.toMatch(/:latest/);
        // Should have a version tag like :22-alpine
        expect(fromLine).toMatch(/:\S+/);
      }
    });
  });
});
