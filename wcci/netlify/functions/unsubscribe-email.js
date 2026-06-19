// netlify/functions/unsubscribe-email.js
// Public endpoint hit from the unsubscribe link in campaign emails.
// Verifies an HMAC token, then sets email_unsubscribed + do_not_email
// and logs the activity. Shows a simple confirmation page.

const https = require("https");
const crypto = require("crypto");

function request(method, url, headers, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const b = data ? JSON.stringify(data) : null;
    const h = { ...headers }; if (b) h["Content-Length"] = Buffer.byteLength(b);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h }, (res) => {
      let c = ""; res.on("data", d => c += d); res.on("end", () => resolve({ status: res.statusCode, body: c }));
    });
    req.on("error", reject); if (b) req.write(b); req.end();
  });
}
function token(id) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_KEY || "wcci";
  return crypto.createHmac("sha256", secret).update(String(id)).digest("hex").slice(0, 32);
}
function page(title, msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:Georgia,serif;background:#f6f3ec;color:#14213d;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.box{background:#fffdf8;border:1px solid #e4ddcf;border-radius:16px;padding:40px;max-width:460px;text-align:center;box-shadow:0 8px 24px -12px rgba(10,36,99,.18)}
.m{font-size:32px;color:#b8893a}h1{font-size:22px;color:#0a2463;margin:12px 0}p{font-size:15px;line-height:1.6;color:#444}</style></head>
<body><div class="box"><div class="m">◈</div><h1>${title}</h1><p>${msg}</p></div></body></html>`;
}

exports.handler = async function (event) {
  const html = (code, t, m) => ({ statusCode: code, headers: { "Content-Type": "text/html" }, body: page(t, m) });
  const id = (event.queryStringParameters || {}).lead;
  const tok = (event.queryStringParameters || {}).token;
  if (!id || !tok) return html(400, "Invalid link", "This unsubscribe link is missing information.");
  if (id === "test") return html(200, "Test link", "This was a test unsubscribe link — no changes were made.");
  if (tok !== token(id)) return html(400, "Invalid link", "This unsubscribe link could not be verified.");

  try {
    const r = await request("PATCH", `${process.env.SUPABASE_URL}/rest/v1/leads?id=eq.${id}`,
      { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      { email_unsubscribed: true, do_not_email: true });
    if (r.status >= 400) return html(500, "Something went wrong", "We couldn't process your request. Please contact us directly.");
    // best-effort activity log
    try {
      await request("POST", `${process.env.SUPABASE_URL}/rest/v1/crm_activities`,
        { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        { lead_id: id, activity_type: "email_unsubscribed", channel: "email", direction: "inbound", subject: "Unsubscribed from marketing email", created_by: "unsubscribe-link" });
    } catch {}
    return html(200, "You're unsubscribed", "You have been unsubscribed from future marketing emails from West Coast Capital Mortgage. You will no longer receive marketing messages from us.");
  } catch (e) {
    return html(500, "Something went wrong", "We couldn't process your request. Please contact us directly.");
  }
};
