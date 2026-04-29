// Email sending stub. Wired-up but provider-agnostic — drop in your
// provider's API call inside sendConfirmationEmail() to enable double-opt-in.
//
// Until a provider is configured, the worker will:
//   - log a warning on each "would-send" event,
//   - store entries with email_click_confirmed=false (single-opt-in;
//     audit-honest).
//
// Once a provider is configured (and sendConfirmationEmail returns
// { sent: true }), the entry stays email_click_confirmed=false until the
// user clicks the confirm link, at which point the confirm endpoint flips
// the flag to true.

export interface EmailEnv {
  RESEND_API_KEY?: string;
}

export interface ConfirmationEmail {
  to: string;
  confirmUrl: string;
  deleteUrl: string;
}

export interface EmailSendResult {
  sent: boolean;
  reason?: string;
}

export async function sendConfirmationEmail(
  env: EmailEnv,
  message: ConfirmationEmail,
): Promise<EmailSendResult> {
  if (!env.RESEND_API_KEY) {
    // Partial address in logs — full email never appears in worker logs.
    // Strip CR/LF defensively to prevent log injection if a malformed
    // address sneaks past the form's email regex.
    const cleaned = message.to.replace(/[\r\n]/g, '');
    const masked = cleaned.replace(/^(.).*?(@.*)$/, '$1***$2');
    console.warn(
      '[email] no provider configured; would have sent confirmation',
      { to: masked },
    );
    return { sent: false, reason: 'no-provider' };
  }

  // Example wiring (uncomment and adapt when ready):
  //
  //   const res = await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': `Bearer ${env.RESEND_API_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       from: 'Mirage Interactive <hello@mirageinteractive.uk>',
  //       to: message.to,
  //       subject: 'Confirm your Mirage Lumen waitlist subscription',
  //       text:
  //         `Confirm your Mirage Lumen waitlist subscription:\n` +
  //         `${message.confirmUrl}\n\n` +
  //         `If you didn't sign up, ignore this email or delete the address now:\n` +
  //         `${message.deleteUrl}\n`,
  //     }),
  //   });
  //   return { sent: res.ok, reason: res.ok ? undefined : `provider-${res.status}` };

  return { sent: false, reason: 'not-implemented' };
}
