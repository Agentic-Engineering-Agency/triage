import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./integration-keys', () => ({
  getIntegrationKey: vi.fn(),
}));

import { getIntegrationKey } from './integration-keys';
import { resolveKey, __clearLogCacheForTests, PROVIDER_ENV_VARS } from './tenant-keys';

const mockedGet = vi.mocked(getIntegrationKey);

describe('tenant-keys / resolveKey', () => {
  const envBackup = new Map<string, string | undefined>();
  const trackEnv = (name: string) => {
    if (!envBackup.has(name)) envBackup.set(name, process.env[name]);
  };

  beforeEach(() => {
    __clearLogCacheForTests();
    mockedGet.mockReset();
    // Snapshot + clear every env var we resolve against so tests are isolated.
    for (const envVar of Object.values(PROVIDER_ENV_VARS)) {
      trackEnv(envVar);
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const [name, value] of envBackup) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    envBackup.clear();
  });

  it('returns tenant key when project has a configured integration', async () => {
    mockedGet.mockResolvedValueOnce({
      ok: true,
      plaintext: 'sk-tenant-linear',
      meta: { teamId: 'TEAM-1' },
      status: 'active',
      lastTestedAt: null,
    });
    process.env.LINEAR_API_KEY = 'sk-env-linear';

    const res = await resolveKey('linear', 'proj_a');

    expect(res).toEqual({ key: 'sk-tenant-linear', source: 'tenant' });
    expect(mockedGet).toHaveBeenCalledWith('proj_a', 'linear');
  });

  it('falls back to env when tenant row is not_found', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    process.env.RESEND_API_KEY = 're-env';

    const res = await resolveKey('resend', 'proj_a');

    expect(res).toEqual({ key: 're-env', source: 'env' });
  });

  it('falls back to env when master key is missing', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'master_key_missing' });
    process.env.SLACK_BOT_TOKEN = 'xoxb-env';

    const res = await resolveKey('slack', 'proj_a');

    expect(res).toEqual({ key: 'xoxb-env', source: 'env' });
  });

  it('does NOT fall back on decrypt_failed — returns none', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'decrypt_failed' });
    process.env.LINEAR_API_KEY = 'sk-env-linear';

    const res = await resolveKey('linear', 'proj_a');

    expect(res).toEqual({ key: null, source: 'none' });
  });

  it('uses env directly when no projectId is provided', async () => {
    process.env.GITHUB_TOKEN = 'ghp-env';

    const res = await resolveKey('github');

    expect(res).toEqual({ key: 'ghp-env', source: 'env' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('uses env directly when projectId is null', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env';

    const res = await resolveKey('openrouter', null);

    expect(res).toEqual({ key: 'sk-or-env', source: 'env' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('returns none when neither tenant nor env has a key', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const res = await resolveKey('linear', 'proj_a');

    expect(res).toEqual({ key: null, source: 'none' });
  });

  it('returns none when no projectId and no env var set', async () => {
    const res = await resolveKey('resend');

    expect(res).toEqual({ key: null, source: 'none' });
  });

  it('treats empty env var as missing', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    process.env.LINEAR_API_KEY = '';

    const res = await resolveKey('linear', 'proj_a');

    expect(res).toEqual({ key: null, source: 'none' });
  });

  it('envFallback:false skips env lookup entirely (strict mode)', async () => {
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    process.env.LINEAR_API_KEY = 'sk-env-linear';

    const res = await resolveKey('linear', 'proj_a', { envFallback: false });

    expect(res).toEqual({ key: null, source: 'none' });
  });

  it('envFallback:false still returns tenant key when present', async () => {
    mockedGet.mockResolvedValueOnce({
      ok: true,
      plaintext: 'sk-tenant',
      meta: {},
      status: 'active',
      lastTestedAt: null,
    });

    const res = await resolveKey('linear', 'proj_a', { envFallback: false });

    expect(res).toEqual({ key: 'sk-tenant', source: 'tenant' });
  });

  it('logs source changes once per (project, provider) pair', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockedGet.mockResolvedValue({ ok: false, reason: 'not_found' });
    process.env.LINEAR_API_KEY = 'sk-env';

    await resolveKey('linear', 'proj_a');
    await resolveKey('linear', 'proj_a');
    await resolveKey('linear', 'proj_a');

    const calls = logSpy.mock.calls.filter((args) =>
      String(args[0]).startsWith('[tenant-keys]'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('project=proj_a');
    expect(calls[0][0]).toContain('source=env');

    logSpy.mockRestore();
  });

  it('logs again when source changes for the same pair', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // First call: env fallback.
    mockedGet.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    process.env.LINEAR_API_KEY = 'sk-env';
    await resolveKey('linear', 'proj_a');

    // Second call: tenant key configured.
    mockedGet.mockResolvedValueOnce({
      ok: true,
      plaintext: 'sk-tenant',
      meta: {},
      status: 'active',
      lastTestedAt: null,
    });
    await resolveKey('linear', 'proj_a');

    const calls = logSpy.mock.calls.filter((args) =>
      String(args[0]).startsWith('[tenant-keys]'),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain('source=env');
    expect(calls[1][0]).toContain('source=tenant');

    logSpy.mockRestore();
  });
});
