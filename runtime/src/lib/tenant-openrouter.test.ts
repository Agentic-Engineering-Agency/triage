import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./integration-keys', () => ({
  getIntegrationKey: vi.fn(),
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn((opts: { apiKey?: string }) => {
    const factory = (() => ({})) as unknown as ReturnType<typeof import('@openrouter/ai-sdk-provider').createOpenRouter>;
    (factory as unknown as { __apiKey: string | undefined }).__apiKey = opts.apiKey;
    return factory;
  }),
}));

import { getIntegrationKey } from './integration-keys';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  resolveOpenRouterFromProjectId,
  resolveOpenRouterFromContext,
} from './tenant-openrouter';
import { __clearLogCacheForTests } from './tenant-keys';

const mockedGet = vi.mocked(getIntegrationKey);
const mockedCreate = vi.mocked(createOpenRouter);

describe('tenant-openrouter', () => {
  const envBackup = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    __clearLogCacheForTests();
    mockedGet.mockReset();
    mockedCreate.mockClear();
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (envBackup === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = envBackup;
  });

  it('uses tenant key when projectId has an integration row', async () => {
    mockedGet.mockResolvedValueOnce({
      ok: true,
      plaintext: 'sk-or-tenant',
      meta: {},
      status: 'active',
      lastTestedAt: null,
    });
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    await resolveOpenRouterFromProjectId('proj_a');

    expect(mockedCreate).toHaveBeenCalledWith({ apiKey: 'sk-or-tenant' });
  });

  it('falls back to env when projectId has no integration row', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    await resolveOpenRouterFromProjectId('proj_a');

    expect(mockedCreate).toHaveBeenCalledWith({ apiKey: 'sk-or-env' });
  });

  it('uses env when projectId is null / undefined', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    await resolveOpenRouterFromProjectId(undefined);
    await resolveOpenRouterFromProjectId(null);

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(mockedCreate).toHaveBeenNthCalledWith(1, { apiKey: 'sk-or-env' });
    expect(mockedCreate).toHaveBeenNthCalledWith(2, { apiKey: 'sk-or-env' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('passes apiKey: undefined when nothing resolves', async () => {
    // no env, no projectId
    await resolveOpenRouterFromProjectId(undefined);

    expect(mockedCreate).toHaveBeenCalledWith({ apiKey: undefined });
  });

  it('fromContext reads projectId off requestContext', async () => {
    mockedGet.mockResolvedValueOnce({
      ok: true,
      plaintext: 'sk-or-ctx',
      meta: {},
      status: 'active',
      lastTestedAt: null,
    });

    const requestContext = {
      get: (k: string) => (k === 'projectId' ? 'proj_x' : undefined),
    } as unknown as import('@mastra/core/request-context').RequestContext;

    await resolveOpenRouterFromContext({ requestContext });

    expect(mockedGet).toHaveBeenCalledWith('proj_x', 'openrouter');
    expect(mockedCreate).toHaveBeenCalledWith({ apiKey: 'sk-or-ctx' });
  });

  it('fromContext without requestContext uses env', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    await resolveOpenRouterFromContext({});

    expect(mockedCreate).toHaveBeenCalledWith({ apiKey: 'sk-or-env' });
  });
});
