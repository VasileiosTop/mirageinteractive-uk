interface Env {
  ASSETS: Fetcher;
  WAITLIST_LUMEN: KVNamespace;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_BODY_BYTES = 2048;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === 'www.mirageinteractive.uk') {
      url.hostname = 'mirageinteractive.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (request.method === 'POST' && url.pathname === '/api/waitlist/lumen') {
      return handleLumenWaitlist(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleLumenWaitlist(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return plainText('Unsupported content type.', 400);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return plainText('Request too large.', 413);
  }

  const form = new URLSearchParams(rawBody);
  const honeypot = form.get('website') ?? '';
  const emailRaw = form.get('email') ?? '';

  const thanksUrl = new URL('/products/mirage-lumen-thanks', request.url);

  if (honeypot.trim() !== '') {
    return Response.redirect(thanksUrl.toString(), 303);
  }

  const email = emailRaw.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LEN ||
    !EMAIL_REGEX.test(email)
  ) {
    return plainText(
      'Invalid email address. Use the browser back button to try again.',
      400,
    );
  }

  try {
    const existing = await env.WAITLIST_LUMEN.get(email);
    if (existing === null) {
      const submitted_at = new Date().toISOString();
      await env.WAITLIST_LUMEN.put(
        email,
        JSON.stringify({ email, submitted_at }),
      );
    }
    return Response.redirect(thanksUrl.toString(), 303);
  } catch {
    return plainText('Something went wrong. Please try again in a moment.', 500);
  }
}

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
