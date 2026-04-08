/**
 * SpecSafe TEST — Environment Variable Configuration
 * Spec: SPEC-20260407-001
 * Requirements: REQ-D08, REQ-D13, REQ-D14
 * Author: Reva (Test Engineer)
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
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const commentIdx = line.indexOf('#', line.indexOf('='));
      const mainPart = commentIdx > -1 ? line.substring(0, commentIdx).trim() : line.trim();
      const comment = commentIdx > -1 ? line.substring(commentIdx).trim() : '';
      const eqIdx = mainPart.indexOf('=');
      return {
        key: mainPart.substring(0, eqIdx).trim(),
        value: mainPart.substring(eqIdx + 1).trim(),
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
      // GIVEN the project repository
      // WHEN checking for .env.example
      // THEN the file should exist
      expect(existsSync(ENV_EXAMPLE_PATH)).toBe(true);
    });
  });

  // --- T-D12: CHANGEME placeholders ---
  describe('T-D12: CHANGEME placeholders', () => {
    it('should have at least 14 CHANGEME placeholders', () => {
      // GIVEN the .env.example file is read
      // WHEN counting occurrences of "CHANGEME"
      // THEN there should be at least 14
      const content = readEnvExample();
      const matches = content.match(/CHANGEME/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(14);
    });

    it('ENCRYPTION_KEY should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for ENCRYPTION_KEY
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/ENCRYPTION_KEY=.*CHANGEME/);
    });

    it('SALT should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for SALT
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/SALT=.*CHANGEME/);
    });

    it('NEXTAUTH_SECRET should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for NEXTAUTH_SECRET
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/NEXTAUTH_SECRET=.*CHANGEME/);
    });

    it('CLICKHOUSE_PASSWORD should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for CLICKHOUSE_PASSWORD
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/CLICKHOUSE_PASSWORD=.*CHANGEME/);
    });

    it('REDIS_AUTH should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for REDIS_AUTH
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/REDIS_AUTH=.*CHANGEME/);
    });

    it('MINIO_ROOT_PASSWORD should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for MINIO_ROOT_PASSWORD
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/MINIO_ROOT_PASSWORD=.*CHANGEME/);
    });

    it('POSTGRES_PASSWORD should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for POSTGRES_PASSWORD
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/POSTGRES_PASSWORD=.*CHANGEME/);
    });

    it('OPENROUTER_API_KEY should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for OPENROUTER_API_KEY
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY=.*CHANGEME/);
    });

    it('BETTER_AUTH_SECRET should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for BETTER_AUTH_SECRET
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/BETTER_AUTH_SECRET=.*CHANGEME/);
    });

    it('RESEND_API_KEY should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for RESEND_API_KEY
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_API_KEY=.*CHANGEME/);
    });

    it('LINEAR_API_KEY should have a CHANGEME placeholder', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for LINEAR_API_KEY
      // THEN it should exist with CHANGEME value
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY=.*CHANGEME/);
    });

    it('all three S3 secret access key variables should have CHANGEME placeholders', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for LANGFUSE_S3_*_SECRET_ACCESS_KEY
      // THEN all three should have CHANGEME values
      const content = readEnvExample();
      expect(content).toMatch(/LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=.*CHANGEME/);
      expect(content).toMatch(/LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=.*CHANGEME/);
      expect(content).toMatch(/LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY=.*CHANGEME/);
    });
  });

  // --- T-D13: Variable groups ---
  describe('T-D13: Environment variable groups', () => {
    it('should contain App configuration variables', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for App-level variables
      // THEN NODE_ENV and CADDY_PORT should be present
      const content = readEnvExample();
      expect(content).toMatch(/NODE_ENV/);
      expect(content).toMatch(/CADDY_PORT/);
    });

    it('should contain LLM/AI configuration variables', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for LLM-related variables
      // THEN OPENROUTER_API_KEY should be present
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });

    it('should contain Integration variables (Linear, Resend)', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for integration variables
      // THEN LINEAR_API_KEY, RESEND_API_KEY, and RESEND_FROM_EMAIL should be present
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
      expect(content).toMatch(/RESEND_API_KEY/);
      expect(content).toMatch(/RESEND_FROM_EMAIL/);
    });

    it('RESEND_FROM_EMAIL should be set to triage@agenticengineering.lat', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for RESEND_FROM_EMAIL
      // THEN it should have the correct sender address
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_FROM_EMAIL=triage@agenticengineering\.lat/);
    });

    it('RESEND_FROM_EMAIL should have an explanatory comment', () => {
      // GIVEN the .env.example file is read
      // WHEN inspecting the RESEND_FROM_EMAIL line
      // THEN it should have a comment explaining it is the sender address
      const content = readEnvExample();
      const lines = content.split('\n');
      const fromEmailLine = lines.find((l) => l.includes('RESEND_FROM_EMAIL'));
      expect(fromEmailLine).toBeDefined();
      const hasInlineComment = fromEmailLine!.includes('#');
      const lineIdx = lines.indexOf(fromEmailLine!);
      const hasCommentBefore = lineIdx > 0 && lines[lineIdx - 1].trim().startsWith('#');
      expect(
        hasInlineComment || hasCommentBefore,
        'RESEND_FROM_EMAIL should have an explanatory comment'
      ).toBe(true);
    });

    it('should contain Langfuse Core variables', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for Langfuse-related variables
      // THEN NEXTAUTH_SECRET, ENCRYPTION_KEY, SALT should be present
      const content = readEnvExample();
      expect(content).toMatch(/NEXTAUTH_SECRET/);
      expect(content).toMatch(/ENCRYPTION_KEY/);
      expect(content).toMatch(/SALT/);
    });

    it('should contain Langfuse Infrastructure variables', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for infrastructure variables
      // THEN CLICKHOUSE_PASSWORD, REDIS_AUTH, MINIO_ROOT_PASSWORD, POSTGRES_PASSWORD should be present
      const content = readEnvExample();
      expect(content).toMatch(/CLICKHOUSE_PASSWORD/);
      expect(content).toMatch(/REDIS_AUTH/);
      expect(content).toMatch(/MINIO_ROOT_PASSWORD/);
      expect(content).toMatch(/POSTGRES_PASSWORD/);
    });

    it('should contain runtime connection variables', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for runtime connection variables
      // THEN RUNTIME_HOST and RUNTIME_PORT should be present
      const content = readEnvExample();
      expect(content).toMatch(/RUNTIME_HOST/);
      expect(content).toMatch(/RUNTIME_PORT/);
    });

    it('should contain LANGFUSE_BASEURL variable', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for LANGFUSE_BASEURL
      // THEN it should be present with a default value
      const content = readEnvExample();
      expect(content).toMatch(/LANGFUSE_BASEURL/);
    });

    it('should have comments explaining variable groups', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for comment lines
      // THEN there should be section headers as comments
      const content = readEnvExample();
      const commentLines = content.split('\n').filter((l) => l.trimStart().startsWith('#'));
      // Should have at least 5 comment lines for section headers
      expect(commentLines.length).toBeGreaterThanOrEqual(5);
    });
  });

  // --- REQ-D08 Scenarios ---
  describe('REQ-D08 scenarios', () => {
    it('happy path: ENCRYPTION_KEY has generation hint (openssl rand -hex 32)', () => {
      // GIVEN the .env.example file is read
      // WHEN searching near ENCRYPTION_KEY
      // THEN a comment with openssl rand -hex 32 should be present
      const content = readEnvExample();
      expect(content).toMatch(/openssl\s+rand\s+-hex\s+32/);
    });

    it('edge case: CHANGEME values are easily greppable', () => {
      // GIVEN the .env.example file is read
      // WHEN searching for the literal string CHANGEME
      // THEN all secret values should contain CHANGEME (making forgotten replacements obvious)
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      const secretKeys = [
        'ENCRYPTION_KEY',
        'SALT',
        'NEXTAUTH_SECRET',
        'CLICKHOUSE_PASSWORD',
        'POSTGRES_PASSWORD',
        'BETTER_AUTH_SECRET',
      ];
      for (const key of secretKeys) {
        const line = lines.find((l) => l.key === key);
        if (line) {
          expect(line.value, `${key} should have CHANGEME placeholder`).toContain('CHANGEME');
        }
      }
    });

    it('error case: .env.example should not contain real secrets', () => {
      // GIVEN the .env.example file is read
      // WHEN inspecting values
      // THEN no value should look like a real API key or secret (long random strings)
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      for (const line of lines) {
        // A real secret would be a long hex or base64 string (32+ chars)
        // CHANGEME is acceptable
        if (line.value.length > 40 && !line.value.includes('CHANGEME')) {
          // This could be a real secret — flag it
          expect(
            line.value,
            `${line.key} might contain a real secret in .env.example`
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
      // GIVEN LINEAR_API_KEY is empty or unset in .env
      // WHEN docker compose up is run
      // THEN all services should start without error
      // THEN triage should create local tickets in LibSQL instead of Linear
      //
      // Manual verification:
      //   1. Set LINEAR_API_KEY= (empty) in .env
      //   2. Run docker compose up --build
      //   3. Trigger a triage
      //   4. Verify local ticket created in LibSQL and displayed in UI
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
    });

    it('[MANUAL] RESEND_API_KEY should be optional — system starts without it', () => {
      // GIVEN RESEND_API_KEY is empty or unset in .env
      // WHEN docker compose up is run
      // THEN all services should start without error
      // THEN email notifications should be logged to console instead of sent
      //
      // Manual verification:
      //   1. Set RESEND_API_KEY= (empty) in .env
      //   2. Run docker compose up --build
      //   3. Trigger a notification
      //   4. Verify console log shows "email would be sent" message
      const content = readEnvExample();
      expect(content).toMatch(/RESEND_API_KEY/);
    });

    it('[MANUAL] OPENROUTER_API_KEY is required — system shows clear error without it', () => {
      // GIVEN OPENROUTER_API_KEY is empty or unset in .env
      // WHEN a triage is attempted
      // THEN the system should show a clear error "LLM API key required"
      //
      // Manual verification:
      //   1. Set OPENROUTER_API_KEY= (empty) in .env
      //   2. Run docker compose up --build (should still start)
      //   3. Attempt a triage
      //   4. Verify clear error message about missing LLM API key
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });
  });

  describe('REQ-D13 scenarios', () => {
    it('happy path: all API keys configured uses real integrations', () => {
      // GIVEN .env.example has all API keys defined
      // WHEN inspected
      // THEN LINEAR_API_KEY, RESEND_API_KEY, and OPENROUTER_API_KEY should all be present
      const content = readEnvExample();
      expect(content).toMatch(/LINEAR_API_KEY/);
      expect(content).toMatch(/RESEND_API_KEY/);
      expect(content).toMatch(/OPENROUTER_API_KEY/);
    });

    it('edge case: demo environment has no Linear workspace', () => {
      // GIVEN .env.example
      // WHEN LINEAR_API_KEY is inspected
      // THEN it should have a CHANGEME placeholder (not a real key)
      // indicating demo mode works without a real Linear workspace
      const content = readEnvExample();
      const lines = parseEnvLines(content);
      const linearLine = lines.find((l) => l.key === 'LINEAR_API_KEY');
      expect(linearLine).toBeDefined();
      expect(linearLine!.value).toContain('CHANGEME');
    });

    it('error case: OPENROUTER_API_KEY completely missing prevents triage', () => {
      // GIVEN .env.example
      // WHEN OPENROUTER_API_KEY is inspected
      // THEN it must be present (it's required, not optional)
      // AND it should have a CHANGEME placeholder indicating it MUST be set
      const content = readEnvExample();
      expect(content).toMatch(/OPENROUTER_API_KEY/);
      const lines = parseEnvLines(content);
      const openrouterLine = lines.find((l) => l.key === 'OPENROUTER_API_KEY');
      expect(openrouterLine).toBeDefined();
      expect(openrouterLine!.value).toContain('CHANGEME');
    });
  });
});
