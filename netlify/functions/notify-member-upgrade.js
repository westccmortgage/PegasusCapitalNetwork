// Member upgrade notification → emails the member when their access is
// upgraded (admin grant or access-code redemption). Triggered by a
// Supabase Database Webhook on public.upgrade_log INSERT.
//
// Supabase setup (one-time, in Dashboard → Database → Webhooks):
//   Table: public.upgrade_log
//   Events: INSERT
//   URL: https://pegasuscapitalnetwork.com/.netlify/functions/notify-member-upgrade
//   HTTP Headers: x-webhook-secret = $WEBHOOK_SECRET
//
// Optional. If the webhook is not wired, upgrade_log rows simply accumulate
// without sending email — nothing breaks.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const secret = event.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const r = payload.record || {};
  const userId     = r.user_id || '—';
  const tier       = (r.tier || 'pro').toLowerCase();
  const source     = r.source || 'access_code';
  const expiresAt  = r.expires_at;
  const accessCode = r.access_code || null;

  // Look up the user's email + name from the Supabase Admin API. The function
  // needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars set in Netlify
  // (same pattern as run-health-check.js).
  let email = null;
  let fullName = null;
  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,full_name`;
    const lookup = await fetch(url, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    if (lookup.ok) {
      const rows = await lookup.json();
      if (Array.isArray(rows) && rows.length) {
        email    = rows[0].email || null;
        fullName = rows[0].full_name || null;
      }
    }
  } catch (e) {
    console.warn('Profile lookup failed:', e.message);
  }

  if (!email) {
    // Without an email, there's nothing to send. Acknowledge the webhook.
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no_email' }) };
  }

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const sourceLabel = source === 'admin_grant' ? 'an admin grant' : (source && source.indexOf('access_code') === 0 ? 'an access code' : source);
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  // Per-tier unlocks copy — kept concise. Aligned with deal-rooms.html /
  // showcase.html / network-requests.html / match-engine.html surfaces.
  const unlocks = {
    starter: ['Member directory', 'Public profile page', 'Network discovery'],
    pro:     ['1 active Deal Room', 'Showcase publishing', 'Network Requests (5/mo)', 'Match Engine alignment'],
    gold:    ['Unlimited Deal Rooms', 'Priority Match Engine', 'Network Requests (unlimited)', 'Institutional placement on directory']
  }[tier] || [];

  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#1d1d1b">
      <div style="background:#13314e;padding:22px 28px;border-radius:10px 10px 0 0">
        <span style="color:#cda748;font-size:13px;letter-spacing:.12em;font-weight:600">PEGASUS CAPITAL NETWORK</span>
      </div>
      <div style="background:#ffffff;border:1px solid #e2ded5;border-top:none;padding:28px;border-radius:0 0 10px 10px">
        <h2 style="margin:0 0 14px;font-size:22px;font-weight:400;color:#13314e">Your ${escapeHtml(tierLabel)} access is active</h2>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3a3a36">
          ${fullName ? 'Hi ' + escapeHtml(fullName.split(' ')[0]) + ',' : 'Hello,'}<br><br>
          Your Pegasus access has been activated via ${escapeHtml(sourceLabel)}. Your ${escapeHtml(tierLabel)} tier is live now and you can use it from any device.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;background:#faf9f6;border:1px solid #e2ded5;border-radius:8px">
          <tr><td style="padding:12px 16px;color:#9a978f;width:140px;border-bottom:1px solid #efece5">Tier</td>
              <td style="padding:12px 16px;font-weight:600;color:#13314e;border-bottom:1px solid #efece5">${escapeHtml(tierLabel)}</td></tr>
          <tr><td style="padding:12px 16px;color:#9a978f;border-bottom:1px solid #efece5">Active until</td>
              <td style="padding:12px 16px;border-bottom:1px solid #efece5">${escapeHtml(expiresLabel)}</td></tr>
          ${accessCode ? `
          <tr><td style="padding:12px 16px;color:#9a978f">Activated with</td>
              <td style="padding:12px 16px;font-family:monospace">${escapeHtml(accessCode)}</td></tr>` : ''}
        </table>
        ${unlocks.length ? `
        <div style="margin-bottom:22px">
          <div style="font-weight:600;font-size:13px;color:#13314e;margin-bottom:10px">What's unlocked at this tier</div>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.7;color:#3a3a36">
            ${unlocks.map(u => `<li>${escapeHtml(u)}</li>`).join('')}
          </ul>
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="https://pegasuscapitalnetwork.com/dashboard.html"
             style="display:inline-block;background:#13314e;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-size:13px">
            Open Dashboard →
          </a>
          <a href="https://pegasuscapitalnetwork.com/deal-rooms.html"
             style="display:inline-block;background:#ffffff;color:#13314e;border:1px solid #c8c4ba;padding:11px 22px;border-radius:8px;text-decoration:none;font-size:13px">
            Visit Deal Rooms
          </a>
        </div>
        <p style="margin-top:22px;font-size:11px;color:#b0ada6">
          Pegasus Capital Network · Membership confirmation · You're receiving this because your access was upgraded.
        </p>
      </div>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'notifications@pegasuslendersgroup.com',
        to:   [email],
        subject: `Your Pegasus ${tierLabel} access is active`,
        html
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'Email send failed' };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, to: email }) };
  } catch(e) {
    console.error('Upgrade notify error:', e.message);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
