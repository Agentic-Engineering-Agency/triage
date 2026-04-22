/**
 * Wiki/RAG pipeline — clones a repo, chunks source files, embeds, and stores in LibSQL.
 *
 * Inspired by llm-wiki: two-pass analysis where pass-1 chunks code structurally
 * and pass-2 enriches with AI-generated summaries. Uses Mastra's @mastra/rag
 * for document chunking and @mastra/libsql for vector storage.
 */
import { createClient } from '@libsql/client';
import { LibSQLVector } from '@mastra/libsql';
import { MDocument } from '@mastra/rag';
import { embed, embedMany } from 'ai';
import { resolveOpenRouterFromProjectId } from './tenant-openrouter';
import { resolveKey } from './tenant-keys';
import {
  parseGithubRepoUrl,
  buildAuthenticatedCloneUrl,
  scrubPatFromString,
} from './github-repo';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, lstatSync, existsSync, rmSync } from 'fs';
import { join, extname, relative } from 'path';
import crypto from 'crypto';

// ============================================================
// Constants
// ============================================================

const VECTOR_INDEX = 'wiki_vectors';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const MAX_FILE_SIZE = 100_000; // 100KB — skip very large files
const BATCH_SIZE = 20; // embed N chunks at a time

// File extensions we ingest
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt',
  '.md', '.mdx', '.txt', '.yml', '.yaml', '.toml', '.json',
  '.sql', '.graphql', '.prisma', '.proto',
  '.css', '.scss', '.html', '.svelte', '.vue',
  '.sh', '.bash', '.zsh', '.fish',
  '.dockerfile', '.env.example',
]);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.mastra', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'vendor',
  'target', '.gradle', '.idea', '.vscode',
]);

// ============================================================
// DB client
// ============================================================

function getDbClient() {
  return createClient({ url: process.env.LIBSQL_URL || 'http://libsql:8080' });
}

function getVectorStore() {
  return new LibSQLVector({
    id: 'wiki-vector',
    url: process.env.LIBSQL_URL || 'http://libsql:8080',
  });
}

// ============================================================
// File scanning
// ============================================================

function scanFiles(dir: string, base: string): { path: string; relativePath: string }[] {
  const results: { path: string; relativePath: string }[] = [];

  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (err) {
      console.warn(`[wiki-rag] Skipping unreadable dir ${current}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stat;
      try {
        // lstat (not stat) so broken symlinks don't throw ENOENT and symlinks
        // that could escape the clone aren't followed into arbitrary targets.
        stat = lstatSync(full);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }

      if (stat.size > MAX_FILE_SIZE) continue;

      const ext = extname(entry).toLowerCase();
      const name = entry.toLowerCase();
      if (CODE_EXTENSIONS.has(ext) || name === 'dockerfile' || name === 'caddyfile' || name === 'makefile') {
        results.push({ path: full, relativePath: relative(base, full) });
      }
    }
  }

  walk(dir);
  return results;
}

// ============================================================
// Chunking strategy selection
// ============================================================

function getChunkStrategy(ext: string): 'markdown' | 'json' | 'recursive' {
  if (['.md', '.mdx'].includes(ext)) return 'markdown';
  if (['.json'].includes(ext)) return 'json';
  // HTML/SVG/Vue/Svelte use recursive — html strategy requires headers/sections config
  return 'recursive';
}

// ============================================================
// Core pipeline
// ============================================================

export interface WikiGenerateResult {
  projectId: string;
  documentsProcessed: number;
  chunksCreated: number;
  success: boolean;
  error?: string;
}

export async function generateWiki(
  projectId: string,
  repositoryUrl: string,
  branch?: string,
): Promise<WikiGenerateResult> {
  const db = getDbClient();
  const vectorStore = getVectorStore();
  const tmpDir = `/tmp/wiki-clone-${projectId}`;

  // Resolve a GitHub PAT for this project if one exists, so private repos
  // clone. Non-GitHub URLs skip the auth-injection path entirely — resolveKey
  // still runs (cheap), but the URL rewrite is gated on parseGithubRepoUrl.
  // Held in `cloneSecret` so we can scrub it from error messages below.
  const parsedRepo = parseGithubRepoUrl(repositoryUrl);
  let cloneUrl = repositoryUrl;
  let cloneSecret: string | null = null;
  if (parsedRepo) {
    const resolved = await resolveKey('github', projectId);
    if (resolved.key) {
      cloneSecret = resolved.key;
      cloneUrl = buildAuthenticatedCloneUrl(parsedRepo.owner, parsedRepo.repo, resolved.key);
    }
  }

  // Defense-in-depth: if this project was flagged needs_auth and we still
  // have no PAT, bail out instead of re-attempting a public clone that'll
  // fail again. The row stays in needs_auth; PUT /integrations/github is the
  // path that clears it.
  if (!cloneSecret && parsedRepo) {
    const statusRow = await db.execute({
      sql: `SELECT status FROM projects WHERE id = ?`,
      args: [projectId],
    });
    if (statusRow.rows[0]?.status === 'needs_auth') {
      return {
        projectId,
        documentsProcessed: 0,
        chunksCreated: 0,
        success: false,
        error: 'needs_auth',
      };
    }
  }

  try {
    // Update project status
    await db.execute({
      sql: `UPDATE projects SET status = 'processing', updated_at = ? WHERE id = ?`,
      args: [Date.now(), projectId],
    });

    // Clone the repository (using execFileSync to prevent shell injection)
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    const gitArgs = ['clone', '--depth', '1'];
    if (branch) gitArgs.push('--branch', branch);
    gitArgs.push(cloneUrl, tmpDir);
    execFileSync('git', gitArgs, { timeout: 60_000, stdio: 'pipe' });

    // Scan source files
    const files = scanFiles(tmpDir, tmpDir);
    console.log(`[wiki-rag] Found ${files.length} files to process for project ${projectId}`);

    let totalDocs = 0;
    let totalChunks = 0;

    // Ensure vector index exists
    const existingIndexes = await vectorStore.listIndexes();
    if (!existingIndexes.includes(VECTOR_INDEX)) {
      await vectorStore.createIndex({
        indexName: VECTOR_INDEX,
        dimension: EMBEDDING_DIMENSION,
      });
    }

    // Process files in batches
    const allChunks: { text: string; metadata: Record<string, unknown> }[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf-8');
        if (!content.trim()) continue;

        const ext = extname(file.relativePath).toLowerCase();
        const strategy = getChunkStrategy(ext);

        // Create MDocument and chunk
        const doc = strategy === 'markdown'
          ? MDocument.fromMarkdown(content, { filePath: file.relativePath, projectId })
          : strategy === 'json'
            ? MDocument.fromJSON(content, { filePath: file.relativePath, projectId })
            : MDocument.fromText(content, { filePath: file.relativePath, projectId });

        await doc.chunk({
          strategy,
          maxSize: 2000,
          overlap: 200,
        });

        // Store document record
        const docId = crypto.randomUUID();
        const now = Date.now();
        await db.execute({
          sql: `INSERT INTO wiki_documents (id, project_id, file_path, summary, pass, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)`,
          args: [docId, projectId, file.relativePath, `Source file: ${file.relativePath}`, now, now],
        });
        totalDocs++;

        // Collect chunks for batch embedding
        const texts = doc.getText();
        for (let i = 0; i < texts.length; i++) {
          allChunks.push({
            text: texts[i],
            metadata: {
              documentId: docId,
              projectId,
              filePath: file.relativePath,
              chunkIndex: i,
            },
          });
        }
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : 'unknown error';
        console.warn(
          `[wiki-rag] Skipping ${file.relativePath}: ${scrubPatFromString(rawMsg, cloneSecret ?? undefined)}`,
        );
      }
    }

    // Batch embed and store chunks. OpenRouter client resolves per-tenant
    // via the project_integrations table (fallback to env when not
    // configured for this project).
    const openrouter = await resolveOpenRouterFromProjectId(projectId);

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.text);

      try {
        const { embeddings } = await embedMany({
          model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
          values: texts,
        });

        // Store in vector index
        const ids = batch.map(() => crypto.randomUUID());
        const metadata = batch.map((c) => ({
          text: c.text.slice(0, 10000),
          ...c.metadata,
        }));

        await vectorStore.upsert({
          indexName: VECTOR_INDEX,
          vectors: embeddings,
          metadata,
          ids,
        });

        // Also store in wiki_chunks table for relational queries
        const now = Date.now();
        for (let j = 0; j < batch.length; j++) {
          await db.execute({
            sql: `INSERT INTO wiki_chunks (id, document_id, content, chunk_index, created_at)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              ids[j],
              batch[j].metadata.documentId as string,
              batch[j].text,
              batch[j].metadata.chunkIndex as number,
              now,
            ],
          });
        }

        totalChunks += batch.length;
        console.log(`[wiki-rag] Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)} (${totalChunks}/${allChunks.length} chunks)`);
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : 'unknown';
        console.error(
          `[wiki-rag] Embedding batch error: ${scrubPatFromString(rawMsg, cloneSecret ?? undefined)}`,
        );
      }
    }

    // Update project with final counts
    await db.execute({
      sql: `UPDATE projects SET status = 'ready', documents_count = ?, chunks_count = ?, updated_at = ? WHERE id = ?`,
      args: [totalDocs, totalChunks, Date.now(), projectId],
    });

    return { projectId, documentsProcessed: totalDocs, chunksCreated: totalChunks, success: true };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Unknown error';
    // Scrub BEFORE logging or persisting — git stderr routinely echoes the
    // clone URL, which includes x-access-token:<pat>@. We must not write
    // the PAT to the logs or to the projects.error column.
    const errorMsg = scrubPatFromString(rawMsg, cloneSecret ?? undefined);
    console.error(`[wiki-rag] Pipeline error: ${errorMsg}`);

    await db.execute({
      sql: `UPDATE projects SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      args: [errorMsg.slice(0, 500), Date.now(), projectId],
    }).catch(() => {});

    return { projectId, documentsProcessed: 0, chunksCreated: 0, success: false, error: errorMsg };
  } finally {
    // Cleanup cloned repo
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// Query
// ============================================================

export interface WikiQueryResult {
  results: Array<{
    chunkId: string;
    documentId: string;
    filePath: string;
    content: string;
    score: number;
    summary: string | null;
  }>;
  query: string;
  totalResults: number;
}

export async function queryWiki(
  query: string,
  projectId?: string,
  topK = 10,
): Promise<WikiQueryResult> {
  const vectorStore = getVectorStore();

  // Short-circuit before embedding if no index exists yet. The index is
  // created lazily by generateWiki on the write path; running a query before
  // any project has been indexed would otherwise hit "no such table:
  // wiki_vectors" and bill an embedding call for nothing.
  const indexes = await vectorStore.listIndexes();
  if (!indexes.includes(VECTOR_INDEX)) {
    console.log(`[wiki-rag] queryWiki: index "${VECTOR_INDEX}" not yet created — returning empty results`);
    return { results: [], query, totalResults: 0 };
  }

  // Query-side embedding uses the same per-tenant resolver; when projectId is
  // undefined (global search path, currently unused) resolveKey falls back to
  // env so this matches pre-tenant behaviour for callers that pass no scope.
  const openrouter = await resolveOpenRouterFromProjectId(projectId ?? null);

  // Generate query embedding
  const { embedding: queryVector } = await embed({
    model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
    value: query,
  });

  // Search vector store
  const filter = projectId ? { projectId } : undefined;
  const vectorResults = await vectorStore.query({
    indexName: VECTOR_INDEX,
    queryVector,
    topK,
    filter,
  });

  const results = vectorResults.map((r) => ({
    chunkId: r.id,
    documentId: (r.metadata?.documentId as string) || '',
    filePath: (r.metadata?.filePath as string) || '',
    content: (r.metadata?.text as string) || '',
    score: r.score,
    summary: null,
  }));

  return {
    results,
    query,
    totalResults: results.length,
  };
}
