import { hmacSha256, bufferToBase64Url, base64UrlToString, timingSafeEqual } from './crypto';

// Audit-honest field names. The presence of a record means the user submitted
// the form. `email_click_confirmed` is true ONLY after they click the confirm
// link in their inbox — single-opt-in submissions stay false.
export interface WaitlistEntry {
  email: string;
  submitted_at: string;
  email_click_confirmed: boolean;
  email_click_confirmed_at?: string;
}

export type ActionKind = 'confirm' | 'delete';

// Domain-separated HMAC inputs. Different prefixes for key derivation vs.
// token signing prevent any cross-protocol confusion if the secret were
// (mis)used for another purpose later.
const KEY_DERIVATION_PREFIX = 'wl:key:v1:';
const TOKEN_SIGNATURE_PREFIX = 'wl:token:v1:';

// Derives the KV key for an email address. The raw email never appears in the
// key, so listing the namespace returns only opaque hashes.
export async function deriveWaitlistKey(email: string, secret: string): Promise<string> {
  const sig = await hmacSha256(secret, KEY_DERIVATION_PREFIX + email);
  return `wl:${bufferToBase64Url(sig)}`;
}

interface TokenPayload {
  a: ActionKind;
  e: string;
  x: number; // unix seconds
}

// Signs a self-contained token of the form `<payload_b64>.<sig_b64>`.
// The token carries the email + action + expiry; verification is local and
// does not require a KV round-trip.
export async function signActionToken(
  email: string,
  action: ActionKind,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload: TokenPayload = { a: action, e: email, x: expiresAt };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = bufferToBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secret, TOKEN_SIGNATURE_PREFIX + payloadB64);
  return `${payloadB64}.${bufferToBase64Url(sig)}`;
}

export type TokenVerification =
  | { valid: false; reason: 'malformed' | 'invalid-signature' | 'expired' }
  | { valid: true; email: string; action: ActionKind; expiresAt: number };

export async function verifyActionToken(
  token: string,
  secret: string,
): Promise<TokenVerification> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return { valid: false, reason: 'malformed' };
  }
  // Reject any character outside unpadded URL-safe base64 + the single dot
  // separator. Stops mixed-alphabet, padded, or whitespace-laden inputs at
  // the door.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return { valid: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  const [payloadB64, sigB64] = parts;
  const expectedSig = await hmacSha256(secret, TOKEN_SIGNATURE_PREFIX + payloadB64);
  if (!timingSafeEqual(bufferToBase64Url(expectedSig), sigB64)) {
    return { valid: false, reason: 'invalid-signature' };
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64UrlToString(payloadB64)) as TokenPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (
    !payload ||
    typeof payload.e !== 'string' ||
    payload.e.length === 0 ||
    payload.e.length > 254 ||
    (payload.a !== 'confirm' && payload.a !== 'delete') ||
    typeof payload.x !== 'number' ||
    !Number.isFinite(payload.x) ||
    !Number.isInteger(payload.x)
  ) {
    return { valid: false, reason: 'malformed' };
  }
  if (Math.floor(Date.now() / 1000) > payload.x) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, email: payload.e, action: payload.a, expiresAt: payload.x };
}
