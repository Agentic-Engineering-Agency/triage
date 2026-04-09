import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';

const SKIP = !process.env.LIBSQL_URL;

describe.skipIf(SKIP)('REQ-DB18: Wiki Vector Search Integration', () => {
  let client: any;
  const testDocId = `test-doc-${Date.now()}`;

  beforeAll(async () => {
    // Ensure schema is applied
    execSync('npx drizzle-kit migrate', {
      cwd: process.cwd() + '/runtime',
      env: { ...process.env },
      stdio: 'pipe',
    });

    const mod = await import('../../runtime/src/db/client');
    client = mod.client;

    // Insert a test wiki document
    const nowEpoch = Math.floor(Date.now() / 1000);
    await client.execute({
      sql: `INSERT INTO wiki_documents (id, project_id, file_path, summary, pass, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        testDocId,
        'test-project',
        'test/vector-test.md',
        'Test content for vector similarity search',
        1,
        nowEpoch,
        nowEpoch,
      ],
    });

    // Insert 3 wiki_chunks with different 1536-dim embeddings
    // Pattern 1: all 0.1 values
    const embedding1 = new Float32Array(1536).fill(0.1);
    // Pattern 2: all 0.5 values
    const embedding2 = new Float32Array(1536).fill(0.5);
    // Pattern 3: mixed — first half 0.9, second half 0.1
    const embedding3 = new Float32Array(1536);
    for (let i = 0; i < 1536; i++) {
      embedding3[i] = i < 768 ? 0.9 : 0.1;
    }

    await client.execute({
      sql: `INSERT INTO wiki_chunks (id, document_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, vector32(?), ?)`,
      args: [
        `${testDocId}-chunk-1`,
        testDocId,
        0,
        'Chunk with low uniform embedding',
        `[${Array.from(embedding1).join(',')}]`,
        nowEpoch,
      ],
    });

    await client.execute({
      sql: `INSERT INTO wiki_chunks (id, document_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, vector32(?), ?)`,
      args: [
        `${testDocId}-chunk-2`,
        testDocId,
        1,
        'Chunk with mid uniform embedding',
        `[${Array.from(embedding2).join(',')}]`,
        nowEpoch,
      ],
    });

    await client.execute({
      sql: `INSERT INTO wiki_chunks (id, document_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, vector32(?), ?)`,
      args: [
        `${testDocId}-chunk-3`,
        testDocId,
        2,
        'Chunk with mixed embedding',
        `[${Array.from(embedding3).join(',')}]`,
        nowEpoch,
      ],
    });

    // Insert a chunk with null embedding
    await client.execute({
      sql: `INSERT INTO wiki_chunks (id, document_id, chunk_index, content, embedding, created_at)
            VALUES (?, ?, ?, ?, NULL, ?)`,
      args: [
        `${testDocId}-chunk-null`,
        testDocId,
        3,
        'Chunk with no embedding',
        nowEpoch,
      ],
    });
  });

  afterAll(async () => {
    if (!client) return;
    // Clean up test data
    await client.execute({
      sql: `DELETE FROM wiki_chunks WHERE document_id = ?`,
      args: [testDocId],
    });
    await client.execute({
      sql: `DELETE FROM wiki_documents WHERE id = ?`,
      args: [testDocId],
    });
  });

  it('SHALL return results ordered by cosine distance', async () => {
    // Query with a vector close to embedding2 (all 0.5)
    const queryEmbedding = new Float32Array(1536).fill(0.5);
    const queryVector = `[${Array.from(queryEmbedding).join(',')}]`;

    const result = await client.execute({
      sql: `SELECT id, content, vector_distance_cos(embedding, vector32(?)) AS distance
            FROM wiki_chunks
            WHERE document_id = ? AND embedding IS NOT NULL
            ORDER BY distance ASC
            LIMIT 10`,
      args: [queryVector, testDocId],
    });

    expect(result.rows.length).toBe(3);

    // The chunk with all-0.5 should be closest (distance ≈ 0)
    expect(result.rows[0].id).toBe(`${testDocId}-chunk-2`);

    // Distances should be in ascending order
    const distances = result.rows.map((r: any) => Number(r.distance));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
  });

  it('SHALL exclude rows with null embedding from vector search', async () => {
    const queryEmbedding = new Float32Array(1536).fill(0.5);
    const queryVector = `[${Array.from(queryEmbedding).join(',')}]`;

    const result = await client.execute({
      sql: `SELECT id FROM wiki_chunks
            WHERE document_id = ? AND embedding IS NOT NULL
            ORDER BY vector_distance_cos(embedding, vector32(?)) ASC`,
      args: [testDocId, queryVector],
    });

    const ids = result.rows.map((r: any) => r.id);
    expect(ids).not.toContain(`${testDocId}-chunk-null`);
  });

  it('SHALL reject dimension mismatch', async () => {
    // Use a 10-dim vector instead of 1536-dim
    const wrongDim = new Float32Array(10).fill(0.5);
    const wrongVector = `[${Array.from(wrongDim).join(',')}]`;

    await expect(
      client.execute({
        sql: `SELECT vector_distance_cos(embedding, vector32(?)) AS distance
              FROM wiki_chunks
              WHERE document_id = ? AND embedding IS NOT NULL
              LIMIT 1`,
        args: [wrongVector, testDocId],
      }),
    ).rejects.toThrow();
  });
});
