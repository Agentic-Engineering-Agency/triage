import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Envelope encryption for per-tenant secrets (BYO API keys).
 *
 * Each row gets a fresh 32-byte DEK. Payload is AES-256-GCM under the DEK;
 * the DEK itself is AES-256-GCM-wrapped under APP_MASTER_KEY. Rotating the
 * master key then requires only re-wrapping DEKs, not re-encrypting the
 * payloads themselves. The version byte is bound into both GCM tags via AAD
 * so a downgrade attempt fails auth instead of silently succeeding.
 */

export type LoadMasterKeyResult =
  | { ok: true; key: Buffer }
  | { ok: false; reason: 'missing' | 'invalid_base64' | 'invalid_length' };

export type DecryptResult =
  | { ok: true; plaintext: string }
  | { ok: false; reason: 'bad_version' | 'malformed' | 'auth_failed' };

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;
const MASTER_KEY_LEN = 32;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN + DEK_LEN + IV_LEN + TAG_LEN;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function loadMasterKey(
  env: Record<string, string | undefined> = process.env,
): LoadMasterKeyResult {
  const raw = env.APP_MASTER_KEY;
  if (!raw || raw.trim() === '') return { ok: false, reason: 'missing' };
  const trimmed = raw.trim();
  if (!BASE64_RE.test(trimmed)) return { ok: false, reason: 'invalid_base64' };
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length !== MASTER_KEY_LEN) return { ok: false, reason: 'invalid_length' };
  return { ok: true, key: decoded };
}

export function encrypt(plaintext: string, masterKey: Buffer): Buffer {
  if (masterKey.length !== MASTER_KEY_LEN) {
    throw new Error(`masterKey must be ${MASTER_KEY_LEN} bytes, got ${masterKey.length}`);
  }
  const aad = Buffer.from([VERSION]);
  const dek = randomBytes(DEK_LEN);
  const keyIv = randomBytes(IV_LEN);
  const dataIv = randomBytes(IV_LEN);

  const keyCipher = createCipheriv('aes-256-gcm', masterKey, keyIv);
  keyCipher.setAAD(aad);
  const wrappedDek = Buffer.concat([keyCipher.update(dek), keyCipher.final()]);
  const keyTag = keyCipher.getAuthTag();

  const dataCipher = createCipheriv('aes-256-gcm', dek, dataIv);
  dataCipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    dataCipher.update(plaintext, 'utf8'),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([VERSION]),
    keyIv,
    keyTag,
    wrappedDek,
    dataIv,
    dataTag,
    ciphertext,
  ]);
}

export function decrypt(blob: Buffer, masterKey: Buffer): DecryptResult {
  if (masterKey.length !== MASTER_KEY_LEN) return { ok: false, reason: 'auth_failed' };
  if (blob.length < HEADER_LEN) return { ok: false, reason: 'malformed' };
  if (blob[0] !== VERSION) return { ok: false, reason: 'bad_version' };

  let offset = 1;
  const keyIv = blob.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const keyTag = blob.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const wrappedDek = blob.subarray(offset, offset + DEK_LEN); offset += DEK_LEN;
  const dataIv = blob.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const dataTag = blob.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const ciphertext = blob.subarray(offset);
  const aad = Buffer.from([VERSION]);

  let dek: Buffer;
  try {
    const keyDecipher = createDecipheriv('aes-256-gcm', masterKey, keyIv);
    keyDecipher.setAAD(aad);
    keyDecipher.setAuthTag(keyTag);
    dek = Buffer.concat([keyDecipher.update(wrappedDek), keyDecipher.final()]);
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }

  try {
    const dataDecipher = createDecipheriv('aes-256-gcm', dek, dataIv);
    dataDecipher.setAAD(aad);
    dataDecipher.setAuthTag(dataTag);
    const plaintext = Buffer.concat([
      dataDecipher.update(ciphertext),
      dataDecipher.final(),
    ]).toString('utf8');
    return { ok: true, plaintext };
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }
}
