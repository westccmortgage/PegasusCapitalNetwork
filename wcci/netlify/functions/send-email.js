// netlify/functions/send-email.js
// Sends a single email via Resend, but ONLY for a signed-in CRM user.
// The browser passes its Supabase access token; we verify it before sending
// so this endpoint can't be abused as an open spam relay.
//
// Required Netlify env vars:
//   RESEND_API_KEY     (you already have this)
//   EMAIL_FROM         e.g. "West Coast Capital <loans@wcci.online>"  (domain must be verified in Resend)
//   SUPABASE_URL       your new WCCI project URL
//   SUPABASE_ANON_KEY  your new WCCI anon/publishable key

const https = require("https");

function request(method, url, headers, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = data ? (typeof data === "string" ? data : JSON.stringify(data)) : null;
    const h = { ...headers };
    if (body) h["Content-Length"] = Buffer.byteLength(body);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h }, (res) => {
      let c = ""; res.on("data", d => c += d); res.on("end", () => resolve({ status: res.statusCode, body: c }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }
  const { to, subject, html, accessToken } = payload;
  if (!to || !subject || !html) return { statusCode: 400, body: JSON.stringify({ error: "Missing to/subject/html" }) };
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  // 1) verify the caller is a real signed-in Supabase user
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`, {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) };
  }

  // 2) send via Resend
  try {
    const r = await request("POST", "https://api.resend.com/emails",
      { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: process.env.EMAIL_FROM || "onboarding@resend.dev", to: [to], subject, html });
    if (r.status >= 400) return { statusCode: 502, body: JSON.stringify({ error: "Resend: " + r.body }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
