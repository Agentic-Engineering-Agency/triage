import { LinearWebhookClient } from '@linear/sdk/webhooks';

export type VerifyResult<T = Record<string, unknown>> =
  | { ok: true; payload: T }
  | { ok: false; reason: string };

/**
 * Verifies a Linear webhook payload using the official SDK:
 * HMAC-SHA256 over the raw body with timing-safe comparison,
 * plus a ±60s replay window enforced on the `linear-timestamp` header.
 *
 * Returns a tagged result instead of throwing so callers can branch
 * cleanly between 401 (bad signature / missing header / stale timestamp)
 * and 503 (no secret configured — caller's responsibility to check before
 * calling this).
 */
export function verifyLinearSignature<T = Record<string, unknown>>(
  secret: string,
  rawBody: Buffer,
  signature: string | null | undefined,
  timestampHeader: string | null | undefined,
): VerifyResult<T> {
  if (!signature) return { ok: false, reason: 'missing signature header' };
  try {
    const client = new LinearWebhookClient(secret);
    const payload = client.parseData(
      rawBody,
      signature,
      timestampHeader ?? undefined,
    );
    return { ok: true, payload: payload as T };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
