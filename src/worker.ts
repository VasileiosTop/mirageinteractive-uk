import {
  deriveWaitlistKey,
  signActionToken,
  verifyActionToken,
  type WaitlistEntry,
} from './lib/waitlist';
import { consumeRateLimit } from './lib/rate-limit';
import { verifyTurnstileToken } from './lib/turnstile';
import { sendConfirmationEmail } from './lib/email';

interface Env {
  ASSETS: Fetcher;
  WAITLIST_LUMEN: KVNamespace;
  // Required: HMAC secret used both for KV-key derivation and signed
  // confirm/delete tokens. Generate once with `openssl rand -base64 32` and
  // store with `wrangler secret put WAITLIST_HMAC_SECRET`.
  WAITLIST_HMAC_SECRET?: string;
  // Optional: enables Turnstile verification when present.
  TURNSTILE_SECRET_KEY?: string;
  // Optional: enables transactional email (double-opt-in) when present.
  RESEND_API_KEY?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_BODY_BYTES = 2048;
const RATE_LIMIT_PER_MINUTE = 5;
const CONFIRM_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DELETE_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60; // 1 year — re-issue on launch email

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === 'www.mirageinteractive.uk') {
      url.hostname = 'mirageinteractive.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/waitlist/lumen' && request.method === 'POST') {
      return handleLumenWaitlistSubmit(request, env);
    }

    if (
      url.pathname === '/api/waitlist/lumen/confirm' &&
      request.method === 'GET'
    ) {
      return handleLumenWaitlistConfirm(request, env);
    }

    if (url.pathname === '/api/waitlist/lumen/delete') {
      if (request.method === 'GET') return handleLumenWaitlistDeletePrompt(request, env);
      if (request.method === 'POST') return handleLumenWaitlistDeleteAction(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleLumenWaitlistSubmit(
  request: Request,
  env: Env,
): Promise<Response> {
  const baseUrl = new URL(request.url);
  const formUrl = new URL('/products/mirage-lumen', baseUrl);
  const thanksUrl = new URL('/products/mirage-lumen-thanks', baseUrl);

  if (!env.WAITLIST_HMAC_SECRET) {
    console.error('[waitlist] WAITLIST_HMAC_SECRET not set; refusing write');
    return redirectWithError(formUrl, 'server');
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return redirectWithError(formUrl, 'invalid');
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return redirectWithError(formUrl, 'invalid');
  }

  const form = new URLSearchParams(rawBody);

  // Rate limit per-IP. Done BEFORE honeypot so bots can't spam the
  // silent-redirect path. cf-connecting-ip is set by Cloudflare and trusted
  // at the edge; unknown IPs fall back to a shared bucket.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rl = await consumeRateLimit(
    env.WAITLIST_LUMEN,
    `submit:${ip}`,
    RATE_LIMIT_PER_MINUTE,
    60,
  );
  if (!rl.allowed) {
    return redirectWithError(formUrl, 'ratelimit', rl.retryAfter);
  }

  // Honeypot: legitimate users never fill the hidden "website" input.
  // Silent accept for bots that fall for it — no error hint, no KV write.
  const honeypot = form.get('website') ?? '';
  if (honeypot.trim() !== '') {
    return Response.redirect(thanksUrl.toString(), 303);
  }

  const emailRaw = form.get('email') ?? '';
  const email = emailRaw.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LEN ||
    !EMAIL_REGEX.test(email)
  ) {
    return redirectWithError(formUrl, 'invalid');
  }

  // Turnstile verification (only when the secret is provisioned).
  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileToken = form.get('cf-turnstile-response') ?? '';
    const verified = await verifyTurnstileToken(
      turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      ip,
    );
    if (!verified) {
      return redirectWithError(formUrl, 'turnstile');
    }
  }

  try {
    const key = await deriveWaitlistKey(email, env.WAITLIST_HMAC_SECRET);

    const existingRaw = await env.WAITLIST_LUMEN.get(key);
    if (existingRaw) {
      // Already on the list — silent dedup.
      return Response.redirect(thanksUrl.toString(), 303);
    }

    const confirmToken = await signActionToken(
      email,
      'confirm',
      env.WAITLIST_HMAC_SECRET,
      CONFIRM_TOKEN_LIFETIME_SECONDS,
    );
    const deleteToken = await signActionToken(
      email,
      'delete',
      env.WAITLIST_HMAC_SECRET,
      DELETE_TOKEN_LIFETIME_SECONDS,
    );
    const confirmUrl = new URL('/api/waitlist/lumen/confirm', baseUrl);
    confirmUrl.searchParams.set('t', confirmToken);
    const deleteUrl = new URL('/api/waitlist/lumen/delete', baseUrl);
    deleteUrl.searchParams.set('t', deleteToken);

    await sendConfirmationEmail(env, {
      to: email,
      confirmUrl: confirmUrl.toString(),
      deleteUrl: deleteUrl.toString(),
    });

    // Audit-honest: email_click_confirmed only flips to true when the user
    // clicks the link in their inbox. Self-asserted submissions stay false
    // until that click — the operator can decide whether to email
    // unconfirmed entries.
    const entry: WaitlistEntry = {
      email,
      submitted_at: new Date().toISOString(),
      email_click_confirmed: false,
    };
    await env.WAITLIST_LUMEN.put(key, JSON.stringify(entry));

    return Response.redirect(thanksUrl.toString(), 303);
  } catch (err) {
    console.error('[waitlist] submit failed', err);
    return redirectWithError(formUrl, 'server');
  }
}

async function handleLumenWaitlistConfirm(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.WAITLIST_HMAC_SECRET) {
    return htmlPage(
      'Server not configured',
      'WAITLIST_HMAC_SECRET is not set on the worker.',
      503,
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t') ?? '';
  const verified = await verifyActionToken(token, env.WAITLIST_HMAC_SECRET);
  if (!verified.valid) {
    const message =
      verified.reason === 'expired'
        ? 'This confirmation link has expired. Submit the form again to get a fresh one.'
        : 'This link is not valid.';
    return htmlPage('Link not valid', message, 400);
  }
  if (verified.action !== 'confirm') {
    return htmlPage('Link not valid', 'This link is the wrong type.', 400);
  }

  try {
    const key = await deriveWaitlistKey(verified.email, env.WAITLIST_HMAC_SECRET);
    const existingRaw = await env.WAITLIST_LUMEN.get(key);
    if (!existingRaw) {
      return htmlPage(
        'Not on the list',
        "We don't have a record matching this link. If you meant to sign up, please submit the form again.",
        404,
      );
    }
    const existing = JSON.parse(existingRaw) as WaitlistEntry;
    if (!existing.email_click_confirmed) {
      existing.email_click_confirmed = true;
      existing.email_click_confirmed_at = new Date().toISOString();
      await env.WAITLIST_LUMEN.put(key, JSON.stringify(existing));
    }
    return htmlPage(
      "You're confirmed.",
      "Thanks. We'll email you when Mirage Lumen ships, and never for any other reason.",
      200,
    );
  } catch (err) {
    console.error('[waitlist] confirm failed', err);
    return htmlPage(
      'Something went wrong',
      'Please try the link again in a moment.',
      500,
    );
  }
}

// GET on the delete endpoint never deletes — it shows a confirm-and-submit
// page. This stops accidental deletes from prefetchers, link previews,
// referrer leaks, and copy-pasted URLs. The actual delete only happens on
// POST below.
async function handleLumenWaitlistDeletePrompt(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.WAITLIST_HMAC_SECRET) {
    return htmlPage(
      'Server not configured',
      'WAITLIST_HMAC_SECRET is not set on the worker.',
      503,
    );
  }
  const url = new URL(request.url);
  const token = url.searchParams.get('t') ?? '';
  const verified = await verifyActionToken(token, env.WAITLIST_HMAC_SECRET);
  if (!verified.valid) {
    const message =
      verified.reason === 'expired'
        ? 'This deletion link has expired. Email legal@mirageinteractive.uk and we will remove your address manually.'
        : 'This link is not valid.';
    return htmlPage('Link not valid', message, 400);
  }
  if (verified.action !== 'delete') {
    return htmlPage('Link not valid', 'This link is the wrong type.', 400);
  }
  // Render a one-button form. The token is in a hidden field; deletion only
  // happens when the user submits.
  return deletePromptPage(token);
}

async function handleLumenWaitlistDeleteAction(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.WAITLIST_HMAC_SECRET) {
    return htmlPage(
      'Server not configured',
      'WAITLIST_HMAC_SECRET is not set on the worker.',
      503,
    );
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return htmlPage('Bad request', 'Unsupported content type.', 400);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return htmlPage('Bad request', 'Request too large.', 413);
  }
  const form = new URLSearchParams(rawBody);
  const token = form.get('t') ?? '';
  const verified = await verifyActionToken(token, env.WAITLIST_HMAC_SECRET);
  if (!verified.valid) {
    const message =
      verified.reason === 'expired'
        ? 'This deletion link has expired. Email legal@mirageinteractive.uk and we will remove your address manually.'
        : 'This link is not valid.';
    return htmlPage('Link not valid', message, 400);
  }
  if (verified.action !== 'delete') {
    return htmlPage('Link not valid', 'This link is the wrong type.', 400);
  }
  try {
    const key = await deriveWaitlistKey(verified.email, env.WAITLIST_HMAC_SECRET);
    const existingRaw = await env.WAITLIST_LUMEN.get(key);
    if (existingRaw) {
      await env.WAITLIST_LUMEN.delete(key);
    }
    return htmlPage(
      'Removed.',
      'Your email has been deleted from the Mirage Lumen waitlist. You will not hear from us again.',
      200,
    );
  } catch (err) {
    console.error('[waitlist] delete failed', err);
    return htmlPage(
      'Something went wrong',
      'Please try again, or email legal@mirageinteractive.uk for help.',
      500,
    );
  }
}

function redirectWithError(
  formUrl: URL,
  error: string,
  retryAfter?: number,
): Response {
  const url = new URL(formUrl.toString());
  url.searchParams.set('error', error);
  url.hash = 'waitlist';
  const headers: Record<string, string> = { Location: url.toString() };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(null, { status: 303, headers });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Self-contained inline-CSS pages — only allow same-origin form posts and
  // no scripts at all. Fonts/images limited to data: + same-origin.
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function htmlPage(title: string, message: string, status: number): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — Mirage Lumen</title>
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg">
<style>
  body { background: #05070f; color: #d4d8e8; font-family: 'Inter Variable', Inter, system-ui, sans-serif; margin: 0; padding: 4rem 1.5rem; line-height: 1.5; }
  .wrap { max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 2.25rem; color: #fff; margin: 0 0 1rem; font-weight: 700; line-height: 1.1; }
  p { font-size: 1rem; }
  a { color: #cdc5b4; }
  a:hover { color: #fff; }
</style>
</head>
<body>
<main class="wrap">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="margin-top: 2rem;"><a href="/">&larr; Back to mirageinteractive.uk</a></p>
</main>
</body>
</html>`;
  return new Response(body, { status, headers: SECURITY_HEADERS });
}

function deletePromptPage(token: string): Response {
  const escapedToken = escapeHtml(token);
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Confirm removal — Mirage Lumen</title>
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg">
<style>
  body { background: #05070f; color: #d4d8e8; font-family: 'Inter Variable', Inter, system-ui, sans-serif; margin: 0; padding: 4rem 1.5rem; line-height: 1.5; }
  .wrap { max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 2.25rem; color: #fff; margin: 0 0 1rem; font-weight: 700; line-height: 1.1; }
  p { font-size: 1rem; }
  a { color: #cdc5b4; }
  a:hover { color: #fff; }
  .btn { display: inline-block; background: #FBF9F3; color: #0A0907; border: 0; padding: 0.625rem 1.25rem; border-radius: 9999px; font-weight: 600; cursor: pointer; font-size: 0.875rem; font-family: inherit; }
  .btn:hover { background: #ece9e0; }
</style>
</head>
<body>
<main class="wrap">
  <h1>Remove me from the Mirage Lumen waitlist?</h1>
  <p>Click the button below to confirm. We won't email you about Mirage Lumen again.</p>
  <form method="POST" action="/api/waitlist/lumen/delete" style="margin-top: 2rem;">
    <input type="hidden" name="t" value="${escapedToken}">
    <button type="submit" class="btn">Remove me</button>
  </form>
  <p style="margin-top: 2rem;"><a href="/">&larr; Back to mirageinteractive.uk</a></p>
</main>
</body>
</html>`;
  return new Response(body, { status: 200, headers: SECURITY_HEADERS });
}
