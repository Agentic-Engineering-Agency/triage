import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, loadMasterKey } from './crypto-envelope';

describe('crypto-envelope', () => {
  const masterKey = randomBytes(32);

  describe('encrypt/decrypt round trip', () => {
    it('round-trips a short ascii string', () => {
      const blob = encrypt('hello', masterKey);
      expect(decrypt(blob, masterKey)).toEqual({ ok: true, plaintext: 'hello' });
    });

    it('round-trips an empty string', () => {
      const blob = encrypt('', masterKey);
      expect(decrypt(blob, masterKey)).toEqual({ ok: true, plaintext: '' });
    });

    it('round-trips a long string with unicode', () => {
      const pt = 'sk-' + 'x'.repeat(500) + ' — ñ 日本 🔑';
      const blob = encrypt(pt, masterKey);
      expect(decrypt(blob, masterKey)).toEqual({ ok: true, plaintext: pt });
    });

    it('produces different ciphertext for same plaintext (fresh IV + DEK)', () => {
      const a = encrypt('same', masterKey);
      const b = encrypt('same', masterKey);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('decrypt failures', () => {
    it('wrong master key → auth_failed', () => {
      const blob = encrypt('secret', masterKey);
      const other = randomBytes(32);
      expect(decrypt(blob, other)).toEqual({ ok: false, reason: 'auth_failed' });
    });

    it('tampered ciphertext → auth_failed', () => {
      const blob = encrypt('secret', masterKey);
      const tampered = Buffer.from(blob);
      tampered[tampered.length - 1] ^= 0xff;
      expect(decrypt(tampered, masterKey)).toEqual({ ok: false, reason: 'auth_failed' });
    });

    it('tampered wrapped DEK → auth_failed', () => {
      const blob = encrypt('secret', masterKey);
      const tampered = Buffer.from(blob);
      // wrappedDek starts at byte 1+12+16 = 29
      tampered[29 + 5] ^= 0xff;
      expect(decrypt(tampered, masterKey)).toEqual({ ok: false, reason: 'auth_failed' });
    });

    it('truncated blob shorter than header → malformed', () => {
      const blob = encrypt('secret', masterKey);
      const truncated = blob.subarray(0, 50);
      expect(decrypt(truncated, masterKey)).toEqual({ ok: false, reason: 'malformed' });
    });

    it('wrong version byte → bad_version', () => {
      const blob = encrypt('secret', masterKey);
      const munged = Buffer.from(blob);
      munged[0] = 0x02;
      expect(decrypt(munged, masterKey)).toEqual({ ok: false, reason: 'bad_version' });
    });

    it('master key of wrong length → auth_failed', () => {
      const blob = encrypt('secret', masterKey);
      const shortKey = randomBytes(16);
      expect(decrypt(blob, shortKey)).toEqual({ ok: false, reason: 'auth_failed' });
    });
  });

  describe('encrypt input validation', () => {
    it('throws on master key of wrong length', () => {
      expect(() => encrypt('x', randomBytes(16))).toThrow(/32 bytes/);
    });
  });

  describe('loadMasterKey', () => {
    it('missing env var → missing', () => {
      expect(loadMasterKey({})).toEqual({ ok: false, reason: 'missing' });
    });

    it('empty string → missing', () => {
      expect(loadMasterKey({ APP_MASTER_KEY: '' })).toEqual({ ok: false, reason: 'missing' });
    });

    it('whitespace-only → missing', () => {
      expect(loadMasterKey({ APP_MASTER_KEY: '   ' })).toEqual({ ok: false, reason: 'missing' });
    });

    it('non-base64 chars → invalid_base64', () => {
      expect(loadMasterKey({ APP_MASTER_KEY: 'not$valid!base64' })).toEqual({
        ok: false,
        reason: 'invalid_base64',
      });
    });

    it('wrong decoded length (too short) → invalid_length', () => {
      const tooShort = Buffer.from('hello world', 'utf8').toString('base64');
      expect(loadMasterKey({ APP_MASTER_KEY: tooShort })).toEqual({
        ok: false,
        reason: 'invalid_length',
      });
    });

    it('wrong decoded length (too long) → invalid_length', () => {
      const tooLong = randomBytes(64).toString('base64');
      expect(loadMasterKey({ APP_MASTER_KEY: tooLong })).toEqual({
        ok: false,
        reason: 'invalid_length',
      });
    });

    it('valid 32-byte base64 → ok', () => {
      const good = randomBytes(32).toString('base64');
      const r = loadMasterKey({ APP_MASTER_KEY: good });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.key.length).toBe(32);
    });

    it('loaded key round-trips through encrypt/decrypt', () => {
      const keyStr = randomBytes(32).toString('base64');
      const loaded = loadMasterKey({ APP_MASTER_KEY: keyStr });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const blob = encrypt('payload', loaded.key);
      expect(decrypt(blob, loaded.key)).toEqual({ ok: true, plaintext: 'payload' });
    });
  });
});
