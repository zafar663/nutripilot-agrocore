import nodemailer from 'nodemailer';

/**
 * SMTP mailer driven by environment variables (set these in agrocore/.env):
 *
 *   SMTP_HOST       e.g. smtp.sendgrid.net  | smtp.gmail.com | smtp.eu.mailgun.org
 *   SMTP_PORT       e.g. 587 (STARTTLS) or 465 (SSL)
 *   SMTP_SECURE     "true" for port 465, otherwise "false"
 *   SMTP_USER       SMTP username (for SendGrid this is the literal "apikey")
 *   SMTP_PASS       SMTP password / API key
 *   SMTP_FROM       From address, e.g. "AgroCore Prime <no-reply@agrocoreprime.com>"
 *
 * If SMTP is not configured the mailer logs the message instead of throwing,
 * so the app keeps working in dev / before credentials are provisioned.
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/**
 * Send an email. Returns { sent: boolean, skipped?: string }.
 * Never throws on a missing config — callers can decide how loud to be.
 */
export async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();
  const from = process.env.SMTP_FROM || 'AgroCore Prime <no-reply@agrocoreprime.com>';
  if (!tx) {
    const reason = 'SMTP not configured (SMTP_HOST/PORT/USER/PASS missing)';
    console.warn(`[mailer] ${reason} — email to ${to} NOT sent. Subject: ${subject}`);
    return { sent: false, skipped: reason };
  }
  await tx.sendMail({ from, to, subject, text, html });
  return { sent: true };
}
