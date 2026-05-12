# Multi-Project Triage Architecture

## Overview

The Triage application has been refactored from a single-project model to a **multi-project architecture** where each project is an independent entity with its own:
- Repository configuration (URL, branch)
- Integration credentials (Linear token, GitHub token, Slack webhook)
- Wiki/RAG data (documents, embeddings, chunks)
- Project-scoped workflows and data

This enables parallel, isolated execution of triage workflows across multiple codebases without credential or data leakage.

## Data Model

### Core Entity: Project

Projects are the root entity in the system, stored in the `projects` table with:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  repo_default_branch TEXT DEFAULT 'main',
  
  -- Integration credentials (per-project)
  linear_token TEXT,
  linear_team_id TEXT,
  linear_webhook_id TEXT,
  linear_webhook_url TEXT,
  
  github_token TEXT,
  github_repo_owner TEXT,
  github_repo_name TEXT,
  
  slack_enabled BOOLEAN DEFAULT 0,
  slack_webhook_url TEXT,
  slack_channel_id TEXT,
  
  -- Wiki/RAG status
  wiki_status TEXT DEFAULT 'idle',
  wiki_error TEXT,
  documents_count INTEGER DEFAULT 0,
  chunks_count INTEGER DEFAULT 0,
  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Related Tables

- **wiki_documents**: Repository documents for RAG, scoped to `project_id`
- **wiki_chunks**: Document chunks with embeddings, linked via `document_id → wiki_documents(id)`
- **conversations, linear_issues, local_tickets**: All have `project_id` foreign key

**Key constraint**: All nested entities cascade-delete when a project is deleted.

## Architecture Layers

### 1. Backend API Routes

**Location**: `runtime/src/lib/*.ts`

#### A. Project Management Routes (`project-routes.ts`)
Implements CRUD operations on projects:
- `GET /projects` — list all projects
- `POST /projects` — create project + trigger wiki generation
- `GET /projects/:id` — get project details with stats
- `PATCH /projects/:id` — update name, repo URL, default branch
- `DELETE /projects/:id` — cascade delete project and all related data

#### B. Integration Configuration Routes (`integration-routes.ts`)
Per-project integration setup and testing:
- `POST /projects/:projectId/settings/linear/test` — validate Linear token, save
- `POST /projects/:projectId/settings/linear/webhook` — register webhook with Linear API
- `POST /projects/:projectId/settings/github/test` — validate GitHub PAT
- `POST /projects/:projectId/settings/slack/test` — send test message to webhook
- `GET /projects/:projectId/settings/integrations` — fetch all integration status

#### C. Project-Scoped Routes (`scoped-routes.ts`)
Per-project data queries using project's own credentials:
- `GET /projects/:projectId/linear/issues` — issues using project's Linear token
- `GET /projects/:projectId/linear/cycle` — active cycle for project's Linear team
- `GET /projects/:projectId/linear/members` — team members for project
- `POST /projects/:projectId/wiki/generate` — trigger wiki generation for project
- `GET /projects/:projectId/wiki/status` — wiki generation status for project

**Implementation pattern**:
```
Extract projectId → Fetch project row → Validate required integration (e.g., linear_token) 
→ Use project's credentials → Filter data to project_id → Return
```

#### D. Middleware (`project-middleware.ts`)
Validates `projectId` parameter before route handlers:
- Extracts `projectId` from URL parameter
- Verifies project exists in database
- Attaches projectId to Hono context for use in handlers
- Returns 404 if project not found

### 2. Frontend Routes & Components

**Location**: `frontend/src/routes/*.tsx`

#### Project Management (`projects.lazy.tsx`)
- List all projects
- Create new project (specify name, repo URL, branch)
- View project details with wiki generation status
- Edit project metadata
- Delete project

**UI Flow**:
1. User creates project via form
2. Backend creates DB record and triggers wiki generation in background
3. Frontend polls `/api/projects/:id` to show progress
4. Wiki status updates in real-time

#### Project Selector Component (`project-selector.tsx`)
- Dropdown showing all projects
- Stores current `projectId` in localStorage
- Emits custom event `triage:project-change` when selection changes
- Other components listen to this event and auto-refetch project-scoped data

#### Integration Settings (`project-settings.lazy.tsx`)
Per-project integration configuration page accessible at `/project-settings`:

**Three sections**:

**Linear Integration**
- Input field for API token
- Test & Save button → calls `POST /api/projects/:projectId/settings/linear/test`
- On success: shows "Connected as <name> (<email>)"
- Webhook registration section (only if token configured):
  - Pre-filled webhook URL: `{origin}/api/webhooks/linear`
  - Optional Team ID input
  - Register Webhook button → calls `POST /api/projects/:projectId/settings/linear/webhook`

**GitHub Integration**
- Input fields: Owner, Repo, Personal Access Token
- Test & Save → `POST /api/projects/:projectId/settings/github/test`
- Shows authenticated user on success

**Slack Integration**
- Webhook URL input (masked)
- Optional Channel ID input
- Test & Save → `POST /api/projects/:projectId/settings/slack/test`
- Backend sends real test message to webhook

**UI Features**:
- Status indicator per integration (green checkmark "Configured" or red X "Not configured")
- Masked input fields for sensitive values
- Loading states and error messages
- Query invalidation to refresh status after save
- Integrations are project-scoped via `useCurrentProjectId()` hook

## Data Flow: Creating a Project & Generating Wiki

```
1. User POST /projects { name, repositoryUrl, branch }
   ↓
2. Backend creates project row with status='pending'
   ↓
3. generateWiki(projectId, repoUrl, branch) spawned in background
   ↓
4. Wiki pipeline clones repo to /data/repos/{projectId}
   ↓
5. Documents extracted, vectorized, stored in wiki_documents + wiki_chunks
   ↓
6. Project status updated to 'ready' or 'error'
   ↓
7. Frontend polls GET /projects/:projectId/wiki/status
   ↓
8. Displays progress and final result
```

## Data Flow: Using a Project's Integrations

```
1. User navigates to /project-settings
   ↓
2. Frontend fetches GET /projects/:projectId/settings/integrations
   ↓
3. Shows configuration status (configured boolean, non-sensitive metadata)
   ↓
4. User enters Linear token and clicks Test & Save
   ↓
5. POST /api/projects/:projectId/settings/linear/test { token }
   ↓
6. Backend validates token via LinearClient.viewer
   ↓
7. Saves token to projects.linear_token (encrypted in production)
   ↓
8. Frontend invalidates query and refreshes status
   ↓
9. User registers webhook via POST /projects/:projectId/settings/linear/webhook
   ↓
10. Backend creates webhook via LinearClient.createWebhook()
    ↓
11. Webhook ID and URL stored in DB
    ↓
12. When issue moves to Done, webhook sends update to /api/webhooks/linear
    ↓
13. Endpoint resumes suspended workflow run for that project
```

## Data Isolation Guarantees

**Project A and Project B cannot see each other's data**:

1. **Credential isolation**: Each project stores its own Linear token, GitHub token, Slack webhook
   - A Linear query by Project A uses Project A's token and team ID
   - Project B's token/team is completely separate
   
2. **Document isolation**: Wiki documents and chunks are filtered by `WHERE project_id = ?`
   - Queries never leak documents from other projects
   
3. **Conversation isolation**: Each conversation is tied to a projectId
   - Conversations from Project A don't appear in Project B's history

4. **Workflow isolation**: Workflows are triggered per-project
   - The triage workflow runs independently for each project's issues
   - Suspended runs are matched to specific projects

## Security Considerations

### Token Storage
- Linear, GitHub, and Slack tokens stored in plaintext in `projects` table
- **Production**: Should be encrypted at rest (e.g., via encryption middleware or encrypted columns)
- **Never** exposed in API responses (only `configured: boolean` status)
- Slack webhook URLs masked as `****` in GET responses

### Webhook Validation
- Linear webhook URL pre-validated before saving
- Slack webhook tested by sending actual message
- GitHub token tested via API call
- All external HTTP calls wrapped in try-catch with meaningful errors

### Future: Per-Project Authorization
- Middleware currently validates project existence only
- **TODO**: Add auth check to verify user owns/can access project
- Prevents unauthorized users from accessing other users' projects

## File Organization

```
runtime/
  src/
    lib/
      project-routes.ts           # GET/POST/PATCH/DELETE /projects
      integration-routes.ts       # POST /projects/:projectId/settings/*
      scoped-routes.ts            # GET/POST /projects/:projectId/linear/* /wiki/*
      project-middleware.ts       # projectId validation middleware
      wiki-rag.ts                 # Wiki generation pipeline
      project-selector.ts         # Frontend hook + context
    mastra/
      index.ts                    # Imports all route arrays and spreads into apiRoutes

frontend/
  src/
    routes/
      projects.lazy.tsx           # Project CRUD UI
      project-settings.lazy.tsx   # Integration settings UI
      __root.tsx                  # Sidebar + ProjectSelector integration
    components/
      project-selector.tsx        # Dropdown + custom event system
```

## Testing

Comprehensive test suite in `runtime/src/lib/project-routes.test.ts`:
- Mock in-memory database (Map-backed)
- Mock LinearClient, GitHub fetch, Slack fetch
- Test CRUD operations on projects
- Test integration token validation and saving
- Test scoped queries (data isolation)
- Test error cases (missing tokens, invalid projects, etc.)

Run with: `npm test` or `vitest`

## Deployment Considerations

### Docker Volumes
- `/data/repos/{projectId}` — persistent repository storage
  - Prevents re-cloning repos on every container restart
  - Supports incremental updates via `git pull`

### Environment Variables
- `LINEAR_API_KEY` — optional global Linear key (legacy, for backward compatibility)
- `LIBSQL_URL` — database connection string
- `OPENROUTER_API_KEY` — LLM provider

### Database Initialization
- Run `runtime/init-db.mjs` on first deployment
- Creates all tables with proper foreign keys and indexes
- Indexes on `project_id` for fast filtering in scoped queries

## Future Improvements

1. **Encryption**: Encrypt credential columns at rest
2. **Rate limiting**: Implement exponential backoff for Linear API calls
3. **Idempotency**: Check if wiki generation already in progress before re-triggering
4. **Per-project auth**: Verify user owns project before returning data
5. **Webhook signature validation**: Verify Linear webhook requests are authentic
6. **Audit logging**: Track who created/modified each project and integration
