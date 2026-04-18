import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyLinearSignature } from './verify-linear-signature';

const SECRET = 'test-secret-abc123';

function sign(body: string | Buffer, secret = SECRET): string {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return createHmac('sha256', secret).update(buf).digest('hex');
}

function nowHeader(offsetMs = 0): string {
  return String(Date.now() + offsetMs);
}

describe('verifyLinearSignature', () => {
  it('accepts a valid signature with a fresh timestamp', () => {
    const body = JSON.stringify({ action: 'update', type: 'Issue' });
    const raw = Buffer.from(body);
    const ts = nowHeader();
    const sig = sign(Buffer.concat([raw]));

    const result = verifyLinearSignature(SECRET, raw, sig, ts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({ action: 'update', type: 'Issue' });
    }
  });

  it('rejects when the signature header is missing', () => {
    const raw = Buffer.from('{}');
    const result = verifyLinearSignature(SECRET, raw, null, nowHeader());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing signature/i);
  });

  it('rejects when the body is tampered after signing', () => {
    const body = JSON.stringify({ action: 'update' });
    const sig = sign(body);
    const tampered = Buffer.from(body.replace('update', 'delete'));

    const result = verifyLinearSignature(SECRET, tampered, sig, nowHeader());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature/i);
  });

  it('rejects when the signature is computed with a different secret', () => {
    const body = Buffer.from('{}');
    const sig = sign(body, 'wrong-secret');

    const result = verifyLinearSignature(SECRET, body, sig, nowHeader());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature/i);
  });

  it('rejects a stale timestamp outside the ±60s window', () => {
    const body = Buffer.from('{}');
    const sig = sign(body);
    const stale = nowHeader(-2 * 60 * 1000);

    const result = verifyLinearSignature(SECRET, body, sig, stale);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timestamp/i);
  });

  it('accepts without a timestamp header when body has no webhookTimestamp', () => {
    // SDK skips the replay check when neither header nor body timestamp is present.
    const body = Buffer.from('{}');
    const sig = sign(body);

    const result = verifyLinearSignature(SECRET, body, sig, null);
    expect(result.ok).toBe(true);
  });
});
