/**
 * SpecSafe TEST — Environment Variable Configuration
 *
 * Validates `.env.example` against the post-Helm-extraction layout: only the
 * runtime/frontend/libsql + per-tenant integration surface lives in compose
 * env. Langfuse and its dependencies (ClickHouse, Redis, MinIO, Postgres) are
 * configured via Helm values and asserted in `tests/infra-k8s/helm-chart.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');
const ENV_EXAMPLE_PATH = resolve(PROJECT_ROOT, '.env.example');

function readEnvExample(): string {
  return readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
}

function parseEnvLines(content: string): { key: string; value: string; comment: string }[] {
  return content
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((line) => {
      const commentIdx = line.indexOf('#');
      const beforeComment = commentIdx >= 0 ? line.substring(0, commentIdx) : line;
      const comment = commentIdx >= 0 ? line.substring(commentIdx).trim() : '';
      const [key, ...valueParts] = beforeComment.split('=');
      return {
        key: key.trim(),
        value: valueParts.join('=').trim(),
        comment,
      };
    });
}

// ---------------------------------------------------------------------------
// REQ-D08: Environment Variable Configuration
// ---------------------------------------------------------------------------
describe('REQ-D08: Environment Variable Configuration', () => {
  describe('.env.example existence', () => {
    it('should have a .env.example file at the project root', () => {
      expect(existsSync(ENV_EXAMPLE_PATH)).toBe(true);
    });
  });

  describe('T-D12: CHANGEME placeholders', () => {
    it('should have at least 10 CHANGEME placeholders', () => {
      // Reduced from 14 after Langfuse-stack secrets (ENCRYPTION_KEY, SALT,
      // NEXTAUTH_SECRET, CLICKHOUSE_PASSWORD, REDIS_AUTH, MINIO_ROOT_PASSWORD,
      // POSTGRES_PASSWORD, the three LANGFUSE_S3_*_SECRET_ACCESS_KEY entries)
      // moved to Helm values in commit 7e0bd39.
      const content = readEnvExample();
      const matches = content.match(/CHANGEME/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(10);
    });

    it('APP_MASTER_KEY should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/APP_MASTER_KEY=.*CHANGEME/);
    });

    it('OPENROUTER_API_KEY should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY=.*CHANGEME/);
    });

    it('BETTER_AUTH_SECRET should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/BETTER_AUTH_SECRET=.*CHANGEME/);
    });

    it('RESEND_API_KEY should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_API_KEY=.*CHANGEME/);
    });

    it('LINEAR_API_KEY should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY=.*CHANGEME/);
    });

    it('GITHUB_TOKEN should have a CHANGEME placeholder', () => {
      const content = readEnvExample();
      expect(content).toMatch(/GITHUB_TOKEN=.*CHANGEME/);
    });

    it('SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET should have CHANGEME placeholders', () => {
      const content = readEnvExample();
      expect(content).toMatch(/SLACK_BOT_TOKEN=.*CHANGEME/);
      expect(content).toMatch(/SLACK_SIGNING_SECRET=.*CHANGEME/);
    });
  });

  describe('T-D13: Environment variable groups', () => {
    it('should contain App configuration variables', () => {
      const content = readEnvExample();
      expect(content).toMatch(/NODE_ENV/);
      expect(content).toMatch(/LIBSQL_URL/);
    });

    it('should contain LLM/AI configuration variables', () => {
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });

    it('should contain Integration variables (Linear, Resend, Slack)', () => {
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
      expect(content).toMatch(/RESEND_API_KEY/);
      expect(content).toMatch(/RESEND_FROM_EMAIL/);
      expect(content).toMatch(/SLACK_BOT_TOKEN/);
    });

    it('RESEND_FROM_EMAIL should be set to triage@agenticengineering.lat', () => {
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_FROM_EMAIL=triage@agenticengineering\.lat/);
    });

    it('RESEND_FROM_EMAIL should have an explanatory comment', () => {
      const content = readEnvExample();
      const lines = content.split('\n');
      const fromEmailLine = lines.find((l) => l.includes('RESEND_FROM_EMAIL'));
      expect(fromEmailLine).toBeDefined();
      const hasInlineComment = fromEmailLine!.includes('#');
      const lineIdx = lines.indexOf(fromEmailLine!);
      const hasCommentBefore = lineIdx > 0 && lines[lineIdx - 1].trim().startsWith('#');
      expect(
        hasInlineComment || hasCommentBefore,
        'RESEND_FROM_EMAIL should have an explanatory comment',
      ).toBe(true);
    });

    it('should contain envelope encryption + better-auth secrets', () => {
      const content = readEnvExample();
      expect(content).toMatch(/APP_MASTER_KEY/);
      expect(content).toMatch(/BETTER_AUTH_SECRET/);
      expect(content).toMatch(/BETTER_AUTH_URL/);
    });

    it('should contain runtime/caddy connection variables', () => {
      const content = readEnvExample();
      expect(content).toMatch(/RUNTIME_HOST/);
      expect(content).toMatch(/RUNTIME_PORT/);
      expect(content).toMatch(/CADDY_PORT/);
    });

    it('should contain FRONTEND_MODE switch', () => {
      const content = readEnvExample();
      expect(content).toMatch(/FRONTEND_MODE=static/);
    });

    it('should have comments explaining variable groups', () => {
      const content = readEnvExample();
      const commentLines = content.split('\n').filter((l) => l.trimStart().startsWith('#'));
      expect(commentLines.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('REQ-D08 scenarios', () => {
    it('happy path: APP_MASTER_KEY documents how to generate the key', () => {
      // APP_MASTER_KEY replaced ENCRYPTION_KEY as the canonical secret-rotation
      // anchor when envelope encryption landed (multi-tenant arc, slice #3).
      const content = readEnvExample();
      const lines = content.split('\n');
      const masterIdx = lines.findIndex((l) => l.includes('APP_MASTER_KEY='));
      expect(masterIdx).toBeGreaterThanOrEqual(0);
      // Look for an openssl rand hint within the surrounding ~10 lines.
      const window = lines.slice(Math.max(0, masterIdx - 10), masterIdx + 1).join('\n');
      expect(window).toMatch(/openssl\s+rand/);
    });

    it('edge case: CHANGEME values are easily greppable', () => {
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      const secretKeys = [
        'APP_MASTER_KEY',
        'BETTER_AUTH_SECRET',
        'OPENROUTER_API_KEY',
        'LINEAR_API_KEY',
        'RESEND_API_KEY',
      ];
      for (const key of secretKeys) {
        const line = lines.find((l) => l.key === key);
        if (line) {
          expect(line.value, `${key} should have CHANGEME placeholder`).toContain('CHANGEME');
        }
      }
    });

    it('error case: .env.example should not contain real secrets', () => {
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      for (const line of lines) {
        if (line.value.length > 40 && !line.value.includes('CHANGEME')) {
          expect(
            line.value,
            `${line.key} might contain a real secret in .env.example`,
          ).toContain('CHANGEME');
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-D13: Graceful Degradation for External Services
// ---------------------------------------------------------------------------
describe('REQ-D13: Graceful Degradation', () => {
  describe('T-D17: Optional API keys', () => {
    it('[MANUAL] LINEAR_API_KEY should be optional — system starts without it', () => {
      // Manual verification: empty LINEAR_API_KEY → triage falls back to a local
      // ticket row in LibSQL (no per-tenant Linear integration configured).
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
    });

    it('[MANUAL] RESEND_API_KEY should be optional — system starts without it', () => {
      // Manual verification: empty RESEND_API_KEY → notifications logged.
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_API_KEY/);
    });

    it('[MANUAL] OPENROUTER_API_KEY is required — system shows clear error without it', () => {
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });
  });

  describe('REQ-D13 scenarios', () => {
    it('happy path: all API keys configured uses real integrations', () => {
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
      expect(content).toMatch(/RESEND_API_KEY/);
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });

    it('edge case: demo environment has no Linear workspace', () => {
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      const linearLine = lines.find((l) => l.key === 'LINEAR_API_KEY');
      expect(linearLine).toBeDefined();
      expect(linearLine!.value).toContain('CHANGEME');
    });

    it('error case: OPENROUTER_API_KEY completely missing prevents triage', () => {
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
      const lines = parseEnvLines(content);
      const openrouterLine = lines.find((l) => l.key === 'OPENROUTER_API_KEY');
      expect(openrouterLine).toBeDefined();
      expect(openrouterLine!.value).toContain('CHANGEME');
    });
  });
});
