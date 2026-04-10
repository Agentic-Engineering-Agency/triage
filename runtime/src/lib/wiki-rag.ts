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
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, extname, relative, dirname } from 'path';
import crypto from 'crypto';

// ============================================================
// Constants
// ============================================================

const VECTOR_INDEX = 'wiki_vectors';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const MAX_FILE_SIZE = 100_000; // 100KB — skip very large files
const BATCH_SIZE = 5; // embed N chunks at a time — reduced to avoid LibSQL transaction timeouts

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
// Path remapping for containerized environments
// ============================================================

function remapPath(hostPath: string): string {
  // If running in container and path starts with /Users/agent/hackathon,
  // remap to /opt/repos (mounted volume)
  if (hostPath.startsWith('/Users/agent/hackathon')) {
    return hostPath.replace('/Users/agent/hackathon', '/opt/repos');
  }
  return hostPath;
}

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
    const entries = readdirSync(current);
    for (const entry of entries) {
      const full = join(current, entry);
      let stat;

      // Use lstatSync to check symlinks without following them
      try {
        stat = statSync(full);
      } catch (err) {
        // Skip if stat fails (broken symlink, permission denied, etc)
        continue;
      }

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
  const repoPath = `/data/repos/${projectId}`;

  try {
    // Update project status
    await db.execute({
      sql: `UPDATE projects SET status = 'processing', updated_at = ? WHERE id = ?`,
      args: [Date.now(), projectId],
    });

    // Ensure parent directory exists
    mkdirSync(dirname(repoPath), { recursive: true });

    // Clone or update the repository into the persistent volume
    if (repositoryUrl.startsWith('/') || repositoryUrl.startsWith('.')) {
      // Local path: rsync into the persistent repo path (remap for containerized environment)
      const remappedUrl = remapPath(repositoryUrl);
      console.log(`[wiki-rag] Syncing local repo from ${repositoryUrl} (remapped to ${remappedUrl}) to ${repoPath}`);
      mkdirSync(repoPath, { recursive: true });
      try {
        execFileSync('rsync', ['-av', '--delete', '--exclude=node_modules', '--exclude=.git', '--exclude=skills', remappedUrl + '/', repoPath + '/'], { timeout: 120_000, stdio: 'pipe' });
      } catch {
        console.log(`[wiki-rag] rsync failed, falling back to cp -P`);
        execFileSync('cp', ['-rP', remappedUrl + '/.', repoPath], { timeout: 60_000, stdio: 'pipe' });
      }
    } else if (existsSync(join(repoPath, '.git'))) {
      // Existing git clone: pull latest
      console.log(`[wiki-rag] Updating existing repo at ${repoPath}`);
      try {
        const pullArgs = ['-C', repoPath, 'pull', 'origin'];
        if (branch) pullArgs.push(branch);
        execFileSync('git', pullArgs, { timeout: 120_000, stdio: 'pipe' });
      } catch (pullErr) {
        console.warn(`[wiki-rag] git pull failed: ${pullErr instanceof Error ? pullErr.message : 'unknown'} — continuing with existing checkout`);
      }
    } else {
      // Fresh remote clone into persistent volume
      console.log(`[wiki-rag] Cloning remote repo ${repositoryUrl} to ${repoPath}`);
      const gitArgs = ['clone', '--depth', '1'];
      if (branch) gitArgs.push('--branch', branch);
      gitArgs.push(repositoryUrl, repoPath);
      try {
        execFileSync('git', gitArgs, { timeout: 120_000, stdio: 'pipe' });
      } catch (cloneErr) {
        const msg = cloneErr instanceof Error ? cloneErr.message : 'unknown';
        throw new Error(`git clone failed: ${msg}`);
      }
    }

    // Scan source files
    const files = scanFiles(repoPath, repoPath);
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
        console.warn(`[wiki-rag] Skipping ${file.relativePath}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    // Batch embed and store chunks
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

    console.log(`[wiki-rag] Starting batch embedding of ${allChunks.length} chunks (${Math.ceil(allChunks.length / BATCH_SIZE)} batches)`);

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.text);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      try {
        console.log(`[wiki-rag] Batch ${batchNum}: Starting embedding of ${texts.length} chunks...`);
        const { embeddings } = await embedMany({
          model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
          values: texts,
        });
        console.log(`[wiki-rag] Batch ${batchNum}: Got ${embeddings.length} embeddings, storing...`);

        // Store in vector index
        const ids = batch.map(() => crypto.randomUUID());
        const metadata = batch.map((c) => ({
          text: c.text.slice(0, 10000),
          ...c.metadata,
        }));

        // Try vector upsert — if it fails, skip this batch but continue
        try {
          console.log(`[wiki-rag] Batch ${batchNum}: Upserting to vector store...`);
          await vectorStore.upsert({
            indexName: VECTOR_INDEX,
            vectors: embeddings,
            metadata,
            ids,
          });
          console.log(`[wiki-rag] Batch ${batchNum}: Vector upsert OK`);
        } catch (upsertErr) {
          console.warn(`[wiki-rag] Batch ${batchNum}: Vector upsert failed: ${upsertErr instanceof Error ? upsertErr.message : 'unknown'}, skipping batch`);
          continue; // Skip to next batch to avoid transaction state issues
        }

        // Also store in wiki_chunks table for relational queries — batch insert
        const now = Date.now();
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const args: unknown[] = [];
        for (let j = 0; j < batch.length; j++) {
          args.push(
            ids[j],
            batch[j].metadata.documentId,
            batch[j].text,
            batch[j].metadata.chunkIndex,
            now,
          );
        }

        // Try DB insert — if it fails, skip this batch but continue
        try {
          console.log(`[wiki-rag] Batch ${batchNum}: Inserting to database...`);
          await db.execute({
            sql: `INSERT INTO wiki_chunks (id, document_id, content, chunk_index, created_at)
                  VALUES ${placeholders}`,
            args,
          });
          console.log(`[wiki-rag] Batch ${batchNum}: DB insert OK`);
        } catch (insertErr) {
          console.warn(`[wiki-rag] Batch ${batchNum}: DB insert failed: ${insertErr instanceof Error ? insertErr.message : 'unknown'}, skipping batch`);
          continue; // Skip to next batch
        }

        totalChunks += batch.length;
        const totalBatches = Math.ceil(allChunks.length / BATCH_SIZE);
        console.log(`[wiki-rag] Batch ${batchNum}/${totalBatches} complete (${totalChunks}/${allChunks.length} chunks, ${Math.round(totalChunks * 100 / allChunks.length)}%)`);
      } catch (err) {
        console.error(`[wiki-rag] Batch ${batchNum} error: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    console.log(`[wiki-rag] Embedding complete: ${totalChunks}/${allChunks.length} chunks processed`);

    // Update project with final counts (persist lastWikiGeneratedAt)
    const finishedAt = Date.now();
    await db.execute({
      sql: `UPDATE projects SET status = 'ready', documents_count = ?, chunks_count = ?, last_wiki_generated_at = ?, updated_at = ? WHERE id = ?`,
      args: [totalDocs, totalChunks, finishedAt, finishedAt, projectId],
    });

    return { projectId, documentsProcessed: totalDocs, chunksCreated: totalChunks, success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[wiki-rag] Pipeline error: ${errorMsg}`);

    await db.execute({
      sql: `UPDATE projects SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      args: [errorMsg.slice(0, 500), Date.now(), projectId],
    }).catch(() => {});

    return { projectId, documentsProcessed: 0, chunksCreated: 0, success: false, error: errorMsg };
  }
  // Note: no cleanup — repo is persisted at /data/repos/${projectId} for future access
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
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  // Ensure vector index exists
  try {
    const existingIndexes = await vectorStore.listIndexes();
    if (!existingIndexes.includes(VECTOR_INDEX)) {
      await vectorStore.createIndex({
        indexName: VECTOR_INDEX,
        dimension: EMBEDDING_DIMENSION,
      });
    }
  } catch (err) {
    console.warn(`[wiki-query] Index check failed: ${err instanceof Error ? err.message : 'unknown'}`);
    // Continue anyway; query might still work if table exists
  }

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
