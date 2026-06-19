// netlify/functions/social-publish.js
// Auth-gated publish endpoint for social posts.
//
// IMPORTANT: Real provider publishing and OAuth token storage are NOT
// implemented. This function NEVER posts to any platform and NEVER returns
// posted/published true. It only reports whether OAuth is configured for the
// requested platform so the frontend can guide the user to manual posting.
//
// It does NOT store, log, or return any OAuth tokens, and it does NOT write to
// the database (no Supabase service key here — the frontend persists rows
// under RLS, e.g. a social_publish_attempts row).
//
// Env vars used:
//   SUPABASE_URL              (already set)
//   SUPABASE_ANON_KEY         (already set)
//   OAUTH_REDIRECT_BASE_URL   (optional, redirect base)
//   Platform OAuth credentials (checked, never read into output):
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

// Accept platform values case-insensitively and common display forms.
function normalizePlatform(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "";
  if (/linkedin/.test(t)) return "linkedin";
  if (/instagram|insta\b|ig\b/.test(t)) return "instagram";
  if (/facebook|fb\b/.test(t)) return "facebook";
  if (/tiktok|tik tok/.test(t)) return "tiktok";
  if (/youtube|you tube|yt\b/.test(t)) return "youtube";
  if (/(^|\W)x(\W|$)|twitter/.test(t)) return "x";
  return t;
}

// platform -> required env var names (never read their values into output)
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
  return vars.every((name) => !!process.env[name]);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };

  let p;
  try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { postId, platform, accountId, accessToken, version } = p;
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  // verify caller is a signed-in CRM user
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`, {
      apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`
    });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  } catch { return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) }; }

  const normalized = normalizePlatform(platform);

  // Unknown platform: treat as not connected so the frontend shows a friendly message.
  if (!normalized || !REQUIRED_ENV[normalized]) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        status: "not_connected",
        configured: false,
        message: "OAuth is not configured for this platform yet. Use manual posting.",
        platform: normalized || null,
        postId: postId || null
      })
    };
  }

  // Env vars missing -> not connected.
  if (!isConfigured(normalized)) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        status: "not_connected",
        configured: false,
        message: "OAuth is not configured for this platform yet. Use manual posting.",
        platform: normalized,
        postId: postId || null
      })
    };
  }

  // Env vars present, but there is no real token/publish flow implemented yet.
  // We NEVER fake a post — require manual publishing.
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: false,
      status: "manual_required",
      configured: true,
      message: "Automated publishing isn't enabled yet — copy the post and publish manually.",
      platform: normalized,
      postId: postId || null
    })
  };
};
