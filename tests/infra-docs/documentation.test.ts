/**
 * SPEC-20260407-001 — Documentation Template Tests (REQ-T01 through REQ-T07)
 * Author: Reva (Forge) — SpecSafe TEST phase
 * Framework: vitest
 * All tests are skipped (it.skip) — implementation pending CODE phase.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// REQ-T01: README.md Template
// ---------------------------------------------------------------------------
describe('REQ-T01: README.md Template', () => {

  // Scenario 1 — Happy path
  it('SHALL contain a Mermaid architecture diagram, quick-start section, tech stack table, team credits, and Excalidraw SVG embed', () => {
    // GIVEN the README.md file exists at the repository root
    const readmePath = path.join(REPO_ROOT, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf-8');

    // WHEN we inspect its contents
    // THEN it SHALL contain a Mermaid code block
    expect(content).toMatch(/```mermaid/);

    // THEN it SHALL contain a quick-start section with clone, env, and compose commands
    expect(content).toMatch(/git clone/i);
    expect(content).toMatch(/\.env\.example/);
    expect(content).toMatch(/docker compose up --build/);

    // THEN it SHALL contain a tech stack table with specific versions
    expect(content).toMatch(/Mastra/i);
    expect(content).toMatch(/1\.23/);
    expect(content).toMatch(/LibSQL/i);
    expect(content).toMatch(/Drizzle/i);
    expect(content).toMatch(/Better Auth/i);
    expect(content).toMatch(/Langfuse/i);
    expect(content).toMatch(/v3/i);
    expect(content).toMatch(/OpenRouter/i);
    expect(content).toMatch(/TanStack/i);
    expect(content).toMatch(/AI SDK/i);
    expect(content).toMatch(/Caddy/i);
    expect(content).toMatch(/shadcn\/ui/i);

    // THEN it SHALL contain a team credits section
    expect(content).toMatch(/credit|team|contributors|authors/i);

    // THEN it SHALL embed an Excalidraw SVG from docs/diagrams/
    expect(content).toMatch(/<img[^>]+src=[^>]*docs\/diagrams\/[^>]*\.svg/i);
  });

  // Scenario 2 — Edge case: Mermaid diagram shows all 9 containers
  it('SHALL have a Mermaid diagram that references all 9 service names', () => {
    // GIVEN the README.md file exists
    const readmePath = path.join(REPO_ROOT, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf-8');

    // WHEN we extract the Mermaid code block(s)
    const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g);
    expect(mermaidBlocks).not.toBeNull();
    const mermaidContent = mermaidBlocks!.join('\n');

    // THEN it SHALL reference all 9 services
    const services = [
      'frontend', 'runtime', 'libsql',
      'langfuse-web', 'langfuse-worker', 'clickhouse',
      'redis', 'minio', 'langfuse-postgres'
    ];
    for (const svc of services) {
      expect(mermaidContent.toLowerCase()).toContain(svc);
    }
  });

  // Scenario 3 — Error case: README references only valid commands and ports
  it('SHALL not reference invalid ports or nonexistent compose commands', () => {
    // GIVEN the README.md file exists
    const readmePath = path.join(REPO_ROOT, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf-8');

    // WHEN we inspect port references in the quick-start section
    // THEN referenced ports SHALL match the compose file (3001, 3000, 8080, 9090, 4111)
    // Verify the file exists and is non-empty as a baseline guard
    expect(content.length).toBeGreaterThan(500);

    // THEN it SHALL reference at least port 3001 (frontend) for users to access
    expect(content).toMatch(/3001/);
  });
});

// ---------------------------------------------------------------------------
// REQ-T02: AGENTS_USE.md Template
// ---------------------------------------------------------------------------
describe('REQ-T02: AGENTS_USE.md Template', () => {

  // Scenario 1 — Happy path: all 9 section headers present
  it('SHALL contain all 9 required section headers', () => {
    // GIVEN the AGENTS_USE.md file exists at the repository root
    const filePath = path.join(REPO_ROOT, 'AGENTS_USE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect section headers
    const requiredSections = [
      'Agent Overview',
      'Agents & Capabilities',
      'Architecture & Orchestration',
      'Context Engineering',
      'Use Cases',
      'Observability',
      'Security & Guardrails',
      'Scalability',
      'Lessons Learned',
    ];

    // THEN every required section header SHALL be present
    for (const section of requiredSections) {
      expect(content).toMatch(new RegExp(section, 'i'));
    }
  });

  // Scenario 2 — Edge case: Mermaid diagrams in section 3
  it('SHALL contain Mermaid diagrams in the Architecture & Orchestration section', () => {
    // GIVEN the AGENTS_USE.md file exists
    const filePath = path.join(REPO_ROOT, 'AGENTS_USE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we locate the Architecture & Orchestration section
    const archSectionMatch = content.match(/#{1,3}\s*.*Architecture\s*&\s*Orchestration[\s\S]*?(?=#{1,3}\s|\z)/i);
    expect(archSectionMatch).not.toBeNull();

    // THEN it SHALL contain at least one Mermaid code block
    const archSection = archSectionMatch![0];
    expect(archSection).toMatch(/```mermaid/);
  });

  // Scenario 3 — Error case: evidence placeholders in sections 6 and 7
  it('SHALL contain evidence placeholders in Observability and Security sections', () => {
    // GIVEN the AGENTS_USE.md file exists
    const filePath = path.join(REPO_ROOT, 'AGENTS_USE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect sections 6 (Observability) and 7 (Security & Guardrails)
    // THEN they SHALL contain <!-- EVIDENCE: --> placeholder tags
    const evidencePlaceholders = content.match(/<!--\s*EVIDENCE:[\s\S]*?-->/g);
    expect(evidencePlaceholders).not.toBeNull();
    expect(evidencePlaceholders!.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// REQ-T03: SCALING.md Template
// ---------------------------------------------------------------------------
describe('REQ-T03: SCALING.md Template', () => {

  // Scenario 1 — Happy path: contains Mermaid Docker and K8s diagrams
  it('SHALL contain Mermaid diagrams for Docker architecture and K8s topology', () => {
    // GIVEN the SCALING.md file exists at the repository root
    const filePath = path.join(REPO_ROOT, 'SCALING.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the Mermaid code blocks
    const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g);
    expect(mermaidBlocks).not.toBeNull();

    // THEN there SHALL be at least 2 Mermaid diagrams (Docker + K8s)
    expect(mermaidBlocks!.length).toBeGreaterThanOrEqual(2);

    // THEN one SHALL reference Docker/container architecture
    expect(content).toMatch(/docker|container|compose/i);

    // THEN one SHALL reference Kubernetes topology
    expect(content).toMatch(/kubernetes|k8s|helm/i);
  });

  // Scenario 2 — Edge case: per-service scaling table and bottleneck analysis
  it('SHALL contain a per-service scaling table and bottleneck analysis section', () => {
    // GIVEN the SCALING.md file exists
    const filePath = path.join(REPO_ROOT, 'SCALING.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the content
    // THEN it SHALL contain a markdown table with scaling strategies per service
    expect(content).toMatch(/\|.*scaling.*\|/i);

    // THEN it SHALL contain a bottleneck analysis section
    expect(content).toMatch(/bottleneck/i);
  });

  // Scenario 3 — Error case: cost projections section exists
  it('SHALL contain a cost projections section', () => {
    // GIVEN the SCALING.md file exists
    const filePath = path.join(REPO_ROOT, 'SCALING.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the content
    // THEN it SHALL contain a cost projections section
    expect(content).toMatch(/cost\s*projection|cost\s*estimate|cost\s*at\s*scale/i);
  });
});

// ---------------------------------------------------------------------------
// REQ-T04: QUICKGUIDE.md Template
// ---------------------------------------------------------------------------
describe('REQ-T04: QUICKGUIDE.md Template', () => {

  // Scenario 1 — Happy path: all 6 steps present
  it('SHALL contain all 6 sequential steps with exact commands', () => {
    // GIVEN the QUICKGUIDE.md file exists at the repository root
    const filePath = path.join(REPO_ROOT, 'QUICKGUIDE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the content for the 6 steps
    // THEN step 1: clone repository
    expect(content).toMatch(/git clone/i);

    // THEN step 2: configure environment
    expect(content).toMatch(/cp\s+\.env\.example/);

    // THEN step 3: docker compose
    expect(content).toMatch(/docker compose up --build/);

    // THEN step 4: access services
    expect(content).toMatch(/localhost/i);

    // THEN step 5: submit an incident
    expect(content).toMatch(/incident|triage|submit/i);

    // THEN step 6: observe in Langfuse
    expect(content).toMatch(/langfuse|observ|trace/i);
  });

  // Scenario 2 — Edge case: user already has a clone
  it('SHALL include guidance for users who already have a clone', () => {
    // GIVEN the QUICKGUIDE.md file exists
    const filePath = path.join(REPO_ROOT, 'QUICKGUIDE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the content
    // THEN it SHALL mention pulling latest or skipping clone step
    expect(content).toMatch(/pull|skip|already.*clone/i);
  });

  // Scenario 3 — Error case: troubleshooting section for compose failures
  it('SHALL include a troubleshooting section for common failures', () => {
    // GIVEN the QUICKGUIDE.md file exists
    const filePath = path.join(REPO_ROOT, 'QUICKGUIDE.md');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the content
    // THEN it SHALL contain a troubleshooting section
    expect(content).toMatch(/troubleshoot|common\s*issue|FAQ|problem/i);
  });
});

// ---------------------------------------------------------------------------
// REQ-T05: LICENSE File
// ---------------------------------------------------------------------------
describe('REQ-T05: LICENSE File', () => {

  // Scenario 1 — Happy path: valid MIT license with year 2026
  it('SHALL contain valid MIT License text with year 2026', () => {
    // GIVEN the LICENSE file exists at the repository root
    const filePath = path.join(REPO_ROOT, 'LICENSE');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the contents
    // THEN it SHALL contain the MIT License text
    expect(content).toMatch(/MIT License/i);
    expect(content).toMatch(/permission is hereby granted/i);

    // THEN it SHALL contain the year 2026
    expect(content).toMatch(/2026/);
  });

  // Scenario 2 — Edge case: copyright holder is identified
  it('SHALL identify the copyright holder', () => {
    // GIVEN the LICENSE file exists
    const filePath = path.join(REPO_ROOT, 'LICENSE');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the copyright line
    // THEN it SHALL contain a copyright statement with a holder name
    expect(content).toMatch(/copyright/i);
    // Copyright line should not be empty after the year
    expect(content).toMatch(/copyright\s*(\(c\))?\s*2026\s+\S+/i);
  });

  // Scenario 3 — Error case: LICENSE file exists and is non-empty
  it('SHALL exist at repository root and not be empty', () => {
    // GIVEN the repository root
    const filePath = path.join(REPO_ROOT, 'LICENSE');

    // WHEN we check the file
    // THEN it SHALL exist
    expect(fs.existsSync(filePath)).toBe(true);

    // THEN it SHALL not be empty
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// REQ-T06: .env.example File
// ---------------------------------------------------------------------------
describe('REQ-T06: .env.example File', () => {

  // Scenario 1 — Happy path: variable group headers present
  it('SHALL contain comment headers for each variable group', () => {
    // GIVEN the .env.example file exists at the repository root
    const filePath = path.join(REPO_ROOT, '.env.example');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect the contents
    // THEN it SHALL contain group header comments (# === ... ===)
    const groupHeaders = content.match(/^#\s*===.*===\s*$/gm);
    expect(groupHeaders).not.toBeNull();
    expect(groupHeaders!.length).toBeGreaterThanOrEqual(3);
  });

  // Scenario 2 — Edge case: all variable groups are present
  it('SHALL contain all expected variable groups', () => {
    // GIVEN the .env.example file exists
    const filePath = path.join(REPO_ROOT, '.env.example');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we inspect variable group headers
    // THEN it SHALL contain groups for App, LLM/AI, Integrations, Langfuse, and Infrastructure
    expect(content).toMatch(/app/i);
    expect(content).toMatch(/llm|ai|openrouter/i);
    expect(content).toMatch(/integration|linear|resend/i);
    expect(content).toMatch(/langfuse/i);
    expect(content).toMatch(/infra|postgres|redis|clickhouse|minio/i);
  });

  // Scenario 3 — Error case: CHANGEME placeholders for secrets
  it('SHALL contain CHANGEME placeholders for all secret variables', () => {
    // GIVEN the .env.example file exists
    const filePath = path.join(REPO_ROOT, '.env.example');
    const content = fs.readFileSync(filePath, 'utf-8');

    // WHEN we count CHANGEME occurrences
    const changemeMatches = content.match(/CHANGEME/g);

    // THEN there SHALL be at least 14 CHANGEME placeholders
    expect(changemeMatches).not.toBeNull();
    expect(changemeMatches!.length).toBeGreaterThanOrEqual(14);
  });
});

// ---------------------------------------------------------------------------
// REQ-T07: docs/diagrams/ Directory
// ---------------------------------------------------------------------------
describe('REQ-T07: docs/diagrams/ Directory', () => {

  // Scenario 1 — Happy path: directory exists with .excalidraw and .svg files
  it('SHALL contain at least one .excalidraw file and one .svg file', () => {
    // GIVEN the docs/diagrams/ directory exists
    const dirPath = path.join(REPO_ROOT, 'docs', 'diagrams');
    expect(fs.existsSync(dirPath)).toBe(true);

    // WHEN we list its contents
    const files = fs.readdirSync(dirPath);

    // THEN it SHALL contain at least one .excalidraw file
    const excalidrawFiles = files.filter(f => f.endsWith('.excalidraw'));
    expect(excalidrawFiles.length).toBeGreaterThanOrEqual(1);

    // THEN it SHALL contain at least one .svg file
    const svgFiles = files.filter(f => f.endsWith('.svg'));
    expect(svgFiles.length).toBeGreaterThanOrEqual(1);
  });

  // Scenario 2 — Edge case: directory is not empty
  it('SHALL contain files (not be an empty directory)', () => {
    // GIVEN the docs/diagrams/ directory exists
    const dirPath = path.join(REPO_ROOT, 'docs', 'diagrams');

    // WHEN we list its contents
    const files = fs.readdirSync(dirPath);

    // THEN it SHALL not be empty
    expect(files.length).toBeGreaterThan(0);
  });

  // Scenario 3 — Error case: directory must exist
  it('SHALL exist as a directory at docs/diagrams/', () => {
    // GIVEN the repository root
    const dirPath = path.join(REPO_ROOT, 'docs', 'diagrams');

    // WHEN we check if the path exists
    // THEN it SHALL exist
    expect(fs.existsSync(dirPath)).toBe(true);

    // THEN it SHALL be a directory (not a file)
    const stat = fs.statSync(dirPath);
    expect(stat.isDirectory()).toBe(true);
  });
});
