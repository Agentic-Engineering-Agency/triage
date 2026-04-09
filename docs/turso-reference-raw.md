# Turso / LibSQL Reference Documentation
# Extracted: 2026-04-08
# Context: sqld v0.24.32 self-hosted in Docker (ghcr.io/tursodatabase/libsql-server:v0.24.32)
# Connection: http://libsql:8080 (from Docker), http://localhost:8080 (from host), no authToken

---

## SECTION 1: LOCAL DEVELOPMENT WITH sqld
Source: https://docs.turso.tech/local-development

### Overview

Three methods for building locally with Turso:

1. SQLite — local SQLite database file
2. Turso CLI — managed libSQL server (turso dev)
3. Turso Database — remote Turso database

### OUR SETUP: Self-hosted sqld in Docker

We run sqld (libSQL server) v0.24.32 in Docker instead of using `turso dev` or Turso Cloud.

- Docker image: ghcr.io/tursodatabase/libsql-server:v0.24.32
- From Docker network: http://libsql:8080
- From host machine: http://localhost:8080
- No authToken required

### Method 1: SQLite (File-based)

Caveats:
- Doesn't have all the features of libSQL (no vector support, no extensions)
- Works with non-serverless based Turso SDKs

Connect via `file:` URL — no authToken needed:

```javascript
import { createClient } from "@libsql/client";

const client = createClient({
  url: "file:local.db",
});
```

### Method 2: Turso CLI (turso dev)

Use this if you need libSQL-specific features like extensions.

```bash
turso dev
```

Starts a local libSQL server at http://127.0.0.1:8080:

```javascript
import { createClient } from "@libsql/client";

const client = createClient({
  url: "http://127.0.0.1:8080",
});
```

WARNING: Changes will be lost when you stop the server.

To persist changes or use a production dump:

```bash
turso dev --db-file local.db
```

### Method 3: Remote Turso Database

Use your hosted Turso database directly by passing the url to your SDK.
WARNING: This incurs platform costs and counts towards your quota.

### Using a Production Dump Locally

```bash
# 1. Create a dump using the Turso CLI
turso db shell your-database .dump > dump.sql

# 2. Create SQLite file from dump
cat dump.sql | sqlite3 local.db

# 3. Connect using any method above with local.db
```

### Connecting to Self-Hosted sqld (Our Pattern)

```typescript
import { createClient } from "@libsql/client";

// From within Docker network:
const client = createClient({
  url: "http://libsql:8080",
});

// From host machine:
const client = createClient({
  url: "http://localhost:8080",
});

// No authToken needed for local/self-hosted sqld
```

### GUI Tools for Development

| Tool              | Platform                       |
|-------------------|--------------------------------|
| Beekeeper Studio  | macOS, Linux, Windows          |
| Outerbase         | Browser                        |
| TablePlus         | macOS, Windows, Linux          |
| Dataflare         | macOS, Windows, Linux (paid)   |
| Outerbase Studio  | Browser                        |
| DBeaver           | macOS, Windows, Linux          |

---

## SECTION 2: VECTOR / EMBEDDING SUPPORT (AI & Embeddings)
Source: https://docs.turso.tech/features/ai-and-embeddings

### Overview

Turso and libSQL enable vector search capability WITHOUT an extension.
This is built-in to libSQL / sqld — works with our self-hosted setup.

### How It Works

1. Create a table with vector columns (e.g., F32_BLOB)
2. Insert vector values using conversion functions (e.g., vector32(...))
3. Calculate similarity using distance functions (e.g., vector_distance_cos)
4. Create a vector index with libsql_vector_idx(column) for faster NN queries
5. Query the index with vector_top_k(idx_name, q_vector, k) table-valued function

### Vector Types

LibSQL uses native SQLite BLOB storage class for vectors. All metadata is encoded
in the BLOB itself (costs a few extra bytes per row). Each type has two name
alternatives: a short form and a _BLOB suffix form.

| Type                      | Storage (bytes) | Description                                       |
|---------------------------|-----------------|---------------------------------------------------|
| FLOAT64 | F64_BLOB        | 8D+1            | IEEE 754 double precision (64-bit)                |
| FLOAT32 | F32_BLOB        | 4D              | IEEE 754 single precision (32-bit) — RECOMMENDED  |
| FLOAT16 | F16_BLOB        | 2D+1            | IEEE 754-2008 half precision (16-bit)             |
| FLOATB16 | FB16_BLOB      | 2D+1            | bfloat16 (16-bit) — faster ops, lower precision   |
| FLOAT8 | F8_BLOB          | D+14            | LibSQL-specific, each component as single u8 byte |
| FLOAT1BIT | F1BIT_BLOB    | ceil(D/8)+3     | LibSQL-specific, 1-bit per component — most compact|

D = number of dimensions

### Vector Functions

| Function                  | Description                                                |
|---------------------------|------------------------------------------------------------|
| vector64                  | Convert to F64_BLOB                                        |
| vector32                  | Convert to F32_BLOB                                        |
| vector16                  | Convert to F16_BLOB                                        |
| vectorb16                 | Convert to FB16_BLOB                                       |
| vector8                   | Convert to F8_BLOB                                         |
| vector1bit                | Convert to F1BIT_BLOB                                      |
| vector                    | Alias for vector32                                         |
| vector_extract            | Returns text representation of a vector                    |
| vector_distance_cos       | Cosine distance (1 - cosine similarity)                    |
| vector_distance_l2        | Euclidean distance                                         |

IMPORTANT: vector_distance_cos and vector_distance_l2 require same type & dimensionality.

### Distance Results Interpretation

- 0 → nearly identical vectors
- 1 → orthogonal (perpendicular)
- 2 → opposite directions
- Very small negative numbers (e.g., -10^-14) are floating-point artifacts — treat as zero

### Vector Limitations

- Euclidean distance NOT supported for FLOAT1BIT vectors
- Max 65,536 dimensions

### Basic Usage Example (SQL)

```sql
-- 1. Create table with vector column
CREATE TABLE movies (
  title     TEXT,
  year      INT,
  embedding F32_BLOB(4) -- 4-dimensional f32 vector
);

-- 2. Insert embeddings
INSERT INTO movies (title, year, embedding)
VALUES
  ('Napoleon', 2023, vector32('[0.800, 0.579, 0.481, 0.229]')),
  ('Black Hawk Down', 2001, vector32('[0.406, 0.027, 0.378, 0.056]')),
  ('Gladiator', 2000, vector32('[0.698, 0.140, 0.073, 0.125]')),
  ('Blade Runner', 1982, vector32('[0.379, 0.637, 0.011, 0.647]'));

-- 3. Similarity search (brute force)
SELECT title, vector_extract(embedding),
       vector_distance_cos(embedding, vector32('[0.064, 0.777, 0.661, 0.687]')) AS distance
FROM movies
ORDER BY distance ASC;
```

### Vector Indexing (DiskANN Algorithm)

LibSQL implements the DiskANN algorithm for approximate nearest neighbor (ANN) queries.
Trades search accuracy for speed.

#### Creating a Vector Index

```sql
CREATE INDEX movies_idx ON movies (libsql_vector_idx(embedding));
```

- libsql_vector_idx marker function is REQUIRED to distinguish ANN indices from B-Tree indices
- Auto-populates with existing data; auto-updates on table changes
- Supports REINDEX, DROP INDEX
- Supports partial indexes:

```sql
CREATE INDEX movies_idx ON movies (libsql_vector_idx(embedding))
WHERE year >= 2000;
```

#### Querying the Vector Index

```sql
SELECT title, year
FROM vector_top_k('movies_idx', vector32('[0.064, 0.777, 0.661, 0.687]'), 3)
JOIN movies ON movies.rowid = id
WHERE year >= 2020;
```

vector_top_k returns ROWID (or PRIMARY KEY for WITHOUT ROWID tables).
Query vector MUST match the same type and dimensionality.

#### Index Settings

Specified as variadic string params in libsql_vector_idx:

```sql
CREATE INDEX movies_idx
ON movies(libsql_vector_idx(embedding, 'metric=l2', 'compress_neighbors=float8'));
```

| Setting              | Default      | Description                                                  |
|----------------------|--------------|--------------------------------------------------------------|
| metric               | cosine       | cosine or l2                                                 |
| max_neighbors        | 3*sqrt(D)    | Neighbors per node in DiskANN graph                          |
| compress_neighbors   | no compress  | Vector type for stored neighbors (float1bit/8/16/b16/32)    |
| alpha                | 1.2          | Graph density param (>=1); lower = sparser = faster          |
| search_l             | 200          | Neighbors visited during search; lower = faster              |
| insert_l             | 70           | Neighbors visited during insert; lower = faster inserts      |

Storage estimate: N × (Storage(T1) + M × Storage(T2)) bytes for N rows,
where T1 is column type, M is max_neighbors, T2 is compress_neighbors type.

#### Index Limitations

- Only works on tables WITH ROWID or with a SINGULAR PRIMARY KEY
- Composite PRIMARY KEY without ROWID is NOT supported

---

## SECTION 3: DRIZZLE ORM INTEGRATION
Source: https://docs.turso.tech/sdk/ts/orm/drizzle

### Dependencies

```bash
npm i drizzle-orm @libsql/client dotenv
npm i -D drizzle-kit
```

package.json scripts:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

### Environment Variables (Our Self-Hosted Setup)

.env:
```
TURSO_DATABASE_URL=http://localhost:8080
# No TURSO_AUTH_TOKEN needed for self-hosted sqld
```

For Docker-internal services:
```
TURSO_DATABASE_URL=http://libsql:8080
```

### Drizzle Schema Definition

db/schema.ts:
```typescript
import { sql } from "drizzle-orm";
import { text, sqliteTable } from "drizzle-orm/sqlite-core";

export const fooTable = sqliteTable("foo", {
  bar: text("bar").notNull().default("Hey!"),
});
```

### Drizzle Kit Configuration

drizzle.config.ts:
```typescript
require("dotenv").config();
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
```

NOTE: For self-hosted sqld, authToken can be undefined/omitted.
NOTE: dialect "turso" works with self-hosted sqld (libSQL server).

### Connect Drizzle with libSQL Client

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,  // undefined for self-hosted
});

export const db = drizzle(turso);
```

### Database Migrations

```bash
npm run db:generate   # Generate migrations after schema changes
npm run db:migrate    # Apply migrations to database
```

### Basic Query

```typescript
import { db } from "./db";
import { fooTable } from "./schema";

const result = await db.select().from(fooTable).all();
```

### Vector Embeddings with Drizzle

#### 1. Define Custom Vector Type

```typescript
import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

const float32Array = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
  driverData: Buffer;
}>({
  dataType(config) {
    return `F32_BLOB(${config.dimensions})`;
  },
  fromDriver(value: Buffer) {
    return Array.from(new Float32Array(value.buffer));
  },
  toDriver(value: number[]) {
    return sql`vector32(${JSON.stringify(value)})`;
  },
});
```

#### 2. Create Table with Vector Column

```typescript
export const vectorTable = sqliteTable("vector_table", {
  id: integer("id").primaryKey(),
  vector: float32Array("vector", { dimensions: 3 }),
});
```

#### 3. Create Vector Index (Raw SQL Required)

```typescript
await db.run(sql`
  CREATE INDEX IF NOT EXISTS vector_index
  ON vector_table(vector)
  USING vector_cosine(3)
`);
```

NOTE: Alternatively, use the libsql_vector_idx syntax:
```typescript
await db.run(sql`
  CREATE INDEX IF NOT EXISTS vector_index
  ON vector_table(libsql_vector_idx(vector))
`);
```

#### 4. Insert Vector Data

```typescript
await db
  .insert(vectorTable)
  .values([{ vector: sql`vector32(${JSON.stringify([1.1, 2.2, 3.3])})` }]);
```

#### 5. Query Vector Data

Calculate vector distance:
```typescript
const res = await db
  .select({
    distance: sql<number>`vector_distance_cos(${vectorTable.vector}, vector32(${JSON.stringify([2.2, 3.3, 4.4])}))`,
  })
  .from(vectorTable);
```

Nearest neighbor search (top-K):
```typescript
const topK = await db
  .select({
    id: sql`id`,
    distance: sql`distance`,
  })
  .from(
    sql`vector_top_k('vector_index', vector32(${JSON.stringify([2.2, 3.3, 4.4])}), 5)`,
  )
  .leftJoin(vectorTable, sql`${vectorTable}.id = id`);
```

IMPORTANT: Create appropriate indexes for efficient vector operations.
Adjust vector dimensions to match your embedding model output.

---

## QUICK REFERENCE: KEY PATTERNS FOR OUR PROJECT

### Self-hosted sqld connection (no auth):
```typescript
import { createClient } from "@libsql/client";
const client = createClient({ url: "http://libsql:8080" });
// or from host: url: "http://localhost:8080"
```

### Vector column definition:
```sql
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY,
  content TEXT,
  embedding F32_BLOB(1536)  -- adjust dimensions to your model
);
```

### Insert embedding:
```sql
INSERT INTO embeddings (content, embedding)
VALUES ('some text', vector32('[0.1, 0.2, ...]'));
```

### Cosine similarity search:
```sql
SELECT content, vector_distance_cos(embedding, vector32('[0.1, 0.2, ...]')) AS distance
FROM embeddings
ORDER BY distance ASC
LIMIT 10;
```

### Create ANN index for fast search:
```sql
CREATE INDEX embeddings_idx ON embeddings (libsql_vector_idx(embedding));
```

### Top-K ANN query:
```sql
SELECT content
FROM vector_top_k('embeddings_idx', vector32('[0.1, 0.2, ...]'), 10)
JOIN embeddings ON embeddings.rowid = id;
```
