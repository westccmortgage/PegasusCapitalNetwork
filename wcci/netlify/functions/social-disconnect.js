// netlify/functions/social-disconnect.js
// Marks a social account as disconnected for the signed-in CRM user.
// Auth-gated (Supabase token). This function is STATELESS: it does not store,
// read, or revoke OAuth tokens. No server-side token exists yet to revoke, so
// we never claim a real provider revocation. The frontend sets the
// social_accounts row to not_connected under RLS.
//
// Env vars used:
//   SUPABASE_URL         (already set)
//   SUPABASE_ANON_KEY    (already set)

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

// Accept platform values case-insensitively and common display forms.
function normalizePlatform(p) {
  const s = String(p || "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("linkedin")) return "linkedin";
  if (s.includes("instagram") || s.includes("insta")) return "instagram";
  if (s.includes("facebook") || s.includes("fb")) return "facebook";
  if (s.includes("tiktok") || s.includes("tik tok")) return "tiktok";
  if (s.includes("youtube") || s.includes("you tube")) return "youtube";
  if (s === "x" || s.includes("twitter") || s.includes("x /") || s.includes("/ twitter")) return "x";
  return s;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };

  let p;
  try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { platform, accountId, accessToken } = p;
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  // verify caller is a signed-in CRM user
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`, {
      apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`
    });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  } catch { return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) }; }

  const normalized = normalizePlatform(platform);

  // No server-side token is stored anywhere, so there is nothing to revoke.
  // We do NOT claim a real provider revocation. The frontend persists the
  // social_accounts row as not_connected under RLS.
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      status: "not_connected",
      platform: normalized,
      accountId: accountId || null,
      message: "Marked disconnected. No server-side token existed to revoke (real revocation runs in Phase 2)."
    })
  };
};
