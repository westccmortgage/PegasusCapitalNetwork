// New member signup notification → sends email to admin via Resend
// Triggered by Supabase Database Webhook on public.member_log INSERT.
// After migration 033, member_log includes: full_name, role, signup_method,
// access_code, tier. The Netlify function reads them straight from the payload.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  // Verify this is genuinely from Supabase (shared secret)
  const secret = event.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const r = payload.record || {};
  const email         = r.email         || '(not provided)';
  const userId        = r.user_id       || r.id || '—';
  const fullName      = r.full_name     || '—';
  const role          = r.role          || '—';
  const signupMethod  = r.signup_method || 'email';
  const accessCode    = r.access_code   || null;
  const tier          = r.tier          || 'starter (default)';

  const joinedAt = r.created_at
    ? new Date(r.created_at).toLocaleString('en-US', { timeZone:'America/Los_Angeles', dateStyle:'medium', timeStyle:'short' })
    : new Date().toLocaleString('en-US', { timeZone:'America/Los_Angeles', dateStyle:'medium', timeStyle:'short' });

  const methodLabel = signupMethod === 'google' ? 'Google OAuth' : 'Email & password';
  const profileLink = `https://pegasuscapitalnetwork.com/public-profile.html?id=${encodeURIComponent(userId)}`;
  const adminLink   = `https://pegasuscapitalnetwork.com/admin.html`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#1d1d1b">
      <div style="background:#13314e;padding:22px 28px;border-radius:10px 10px 0 0">
        <span style="color:#cda748;font-size:13px;letter-spacing:.12em;font-weight:600">PEGASUS CAPITAL NETWORK</span>
      </div>
      <div style="background:#ffffff;border:1px solid #e2ded5;border-top:none;padding:28px;border-radius:0 0 10px 10px">
        <h2 style="margin:0 0 18px;font-size:20px;font-weight:400;color:#13314e">New Pegasus Member Joined</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#9a978f;width:140px">Full name</td>
              <td style="padding:8px 0;font-weight:500">${escapeHtml(fullName)}</td></tr>
          <tr><td style="padding:8px 0;color:#9a978f">Email</td>
              <td style="padding:8px 0;font-weight:500">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:8px 0;color:#9a978f">Role</td>
              <td style="padding:8px 0">${escapeHtml(role)}</td></tr>
          <tr><td style="padding:8px 0;color:#9a978f">Signup method</td>
              <td style="padding:8px 0">${escapeHtml(methodLabel)}</td></tr>
          ${accessCode ? `
          <tr><td style="padding:8px 0;color:#9a978f">Access code used</td>
              <td style="padding:8px 0;font-family:monospace">${escapeHtml(accessCode)}</td></tr>` : `
          <tr><td style="padding:8px 0;color:#9a978f">Access code used</td>
              <td style="padding:8px 0;color:#9a978f">—</td></tr>`}
          <tr><td style="padding:8px 0;color:#9a978f">Membership tier</td>
              <td style="padding:8px 0;font-weight:500">${escapeHtml(tier)}</td></tr>
          <tr><td style="padding:8px 0;color:#9a978f">Joined</td>
              <td style="padding:8px 0">${escapeHtml(joinedAt)} PT</td></tr>
          <tr><td style="padding:8px 0;color:#9a978f">User ID</td>
              <td style="padding:8px 0;font-family:monospace;font-size:12px;color:#6b6b66">${escapeHtml(userId)}</td></tr>
        </table>
        <div style="margin-top:22px;padding-top:18px;border-top:1px solid #e2ded5;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${profileLink}"
             style="display:inline-block;background:#ffffff;color:#13314e;border:1px solid #c8c4ba;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px">
            View profile
          </a>
          <a href="${adminLink}"
             style="display:inline-block;background:#13314e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px">
            Open Admin Console →
          </a>
        </div>
        <p style="margin-top:20px;font-size:11px;color:#b0ada6">
          Pegasus Capital Network · Admin notification · This email was sent because a new member joined.
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
        to:   ['pegasuslendersgroup@gmail.com'],
        subject: `New Pegasus Member Joined — ${fullName !== '—' ? fullName + ' (' + email + ')' : email}`,
        html
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'Email send failed' };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch(e) {
    console.error('Notify error:', e.message);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
