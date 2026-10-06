// Single email entry point for license delivery.
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL (a Resend-verified sender,
// e.g. 'VibeyCursor <noreply@your-real-domain.com>') in Vercel env vars.

export async function sendLicenseEmail(email, licenseKey) {
  if (!email || !licenseKey) return;

  if (!process.env.RESEND_API_KEY) {
    console.log(`License email skipped (no RESEND_API_KEY): ${email}`);
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.error('License email skipped: RESEND_FROM_EMAIL is not set (use a Resend-verified sender address)');
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'Your VibeyCursor license key',
      text: `Thanks for upgrading! Your VibeyCursor license key is:\n\n${licenseKey}\n\nPaste it into the VibeyCursor extension popup under "Activate License".`
    })
  });
}
