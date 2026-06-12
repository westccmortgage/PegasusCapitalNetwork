/**
 * submit-lead.js — Netlify Function
 * Receives a lead + strategy snapshot, validates it server-side, and forwards
 * it. Forwarding is config-driven via env vars so no secrets live in the repo:
 *
 *   LEAD_WEBHOOK_URL   (optional) POST the lead JSON here (Zapier/CRM/Slack)
 *   LEAD_NOTIFY_EMAIL  (optional) informational only in Phase 1
 *
 * With no env configured it still returns 200 and logs — so local dev works.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const contact = payload.contact || {};
  const errors = {};
  if (!contact.name || !contact.name.trim()) errors.name = 'Required';
  if (!contact.email || !EMAIL_RE.test(contact.email)) errors.email = 'Valid email required';
  if (Object.keys(errors).length) {
    return json(422, { ok: false, error: 'validation', errors });
  }

  const lead = {
    receivedAt: new Date().toISOString(),
    source: payload.source || 'BeforeJumboLoan.com',
    contact: {
      name: contact.name.trim(),
      email: contact.email.trim(),
      phone: (contact.phone || '').trim(),
      message: (contact.message || '').trim(),
    },
    scenario: payload.scenario || null,
  };

  // Forward to a webhook if configured.
  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
    } catch (err) {
      // Don't fail the lead capture if the downstream is down; log for ops.
      console.error('Lead webhook forward failed:', err && err.message);
    }
  } else {
    console.log('Lead received (no LEAD_WEBHOOK_URL configured):', JSON.stringify(lead));
  }

  return json(200, { ok: true, message: 'Lead received' });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
