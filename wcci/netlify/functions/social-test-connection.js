// netlify/functions/social-test-connection.js
// Tests whether a social account has a usable stored token.
// Auth-gated (Supabase token). Stateless: no token is stored, logged, or returned.
// Since Phase 2 (real OAuth) is not wired yet, this NEVER reports connected:true.
//
// Env vars used:
//   SUPABASE_URL          (already set)
//   SUPABASE_ANON_KEY     (already set)
//   Platform OAuth vars (presence-checked only, never read/returned):
//     linkedin  -> LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
//     instagram -> META_CLIENT_ID, META_CLIENT_SECRET
//     facebook  -> META_CLIENT_ID, META_CLIENT_SECRET
//     tiktok    -> TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
//     youtube   -> YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
//     x         -> X_CLIENT_ID, X_CLIENT_SECRET

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

// Map display/casing variants to canonical platform keys.
function normalizePlatform(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "";
  if (t.includes("linkedin")) return "linkedin";
  if (t.includes("instagram") || t === "ig") return "instagram";
  if (t.includes("facebook") || t === "fb") return "facebook";
  if (t.includes("tiktok") || t === "tik tok") return "tiktok";
  if (t.includes("youtube") || t === "yt") return "youtube";
  if (t === "x" || t.includes("twitter") || t.includes("x / twitter") || t.includes("x/twitter")) return "x";
  return t;
}

// Required env vars per platform.
const REQUIRED_ENV = {
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  instagram: ["META_CLIENT_ID", "META_CLIENT_SECRET"],
  facebook: ["META_CLIENT_ID", "META_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"]
};

function isConfigured(platform) {
  const vars = REQUIRED_ENV[platform];
  if (!vars) return false;
  return vars.every(v => !!process.env[v]);
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
  if (!normalized || !REQUIRED_ENV[normalized]) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        connected: false,
        configured: false,
        platform: normalized || null,
        accountId: accountId || null,
        token_status: "none",
        message: "OAuth is not configured for this platform yet."
      })
    };
  }

  const configured = isConfigured(normalized);

  if (!configured) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        connected: false,
        configured: false,
        platform: normalized,
        accountId: accountId || null,
        token_status: "none",
        message: "OAuth is not configured for this platform yet."
      })
    };
  }

  // Env vars present, but there is no real token storage/exchange yet (Phase 2).
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: false,
      connected: false,
      configured: true,
      platform: normalized,
      accountId: accountId || null,
      token_status: "unknown",
      message: "No stored token to test yet — connect the account in Phase 2."
    })
  };
};