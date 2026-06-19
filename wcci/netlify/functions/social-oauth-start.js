// netlify/functions/social-oauth-start.js
// Phase 1 of social OAuth: builds the provider authorize URL so the browser
// can open the consent window. This function is STATELESS:
//   - it does NOT store, log, or return any OAuth tokens
//   - it does NOT write to the database (no service key here)
//   - it does NOT claim any account is connected
// Token exchange happens later in social-oauth-callback (Phase 2).
//
// Auth: caller sends { accessToken } (Supabase) which is verified before use.
//
// Env vars used:
//   SUPABASE_URL              (already set)
//   SUPABASE_ANON_KEY         (already set)
//   OAUTH_REDIRECT_BASE_URL   (base origin for the callback redirect_uri)
//   per-platform OAuth client id/secret (see PLATFORMS below)

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
  if (/instagram|insta|ig/.test(t)) return "instagram";
  if (/facebook|fb|\bmeta page\b/.test(t)) return "facebook";
  if (/tiktok|tik tok/.test(t)) return "tiktok";
  if (/youtube|you tube|yt/.test(t)) return "youtube";
  if (/^x$|x\s*\/\s*twitter|twitter|^x\b/.test(t)) return "x";
  return t;
}

// Per-platform OAuth config. authorize/scopes/extra are used only when BOTH
// required env vars are present.
const PLATFORMS = {
  linkedin: {
    idVar: "LINKEDIN_CLIENT_ID",
    secretVar: "LINKEDIN_CLIENT_SECRET",
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    scope: "openid profile w_member_social",
    extra: {}
  },
  instagram: {
    idVar: "META_CLIENT_ID",
    secretVar: "META_CLIENT_SECRET",
    authorize: "https://www.facebook.com/v19.0/dialog/oauth",
    scope: "instagram_basic,instagram_content_publish,pages_show_list",
    extra: {}
  },
  facebook: {
    idVar: "META_CLIENT_ID",
    secretVar: "META_CLIENT_SECRET",
    authorize: "https://www.facebook.com/v19.0/dialog/oauth",
    scope: "pages_show_list,pages_manage_posts,pages_read_engagement",
    extra: {}
  },
  tiktok: {
    idVar: "TIKTOK_CLIENT_KEY",
    secretVar: "TIKTOK_CLIENT_SECRET",
    authorize: "https://www.tiktok.com/v2/auth/authorize/",
    scope: "user.info.basic,video.publish",
    extra: {},
    // TikTok uses client_key instead of client_id.
    clientParam: "client_key"
  },
  youtube: {
    idVar: "YOUTUBE_CLIENT_ID",
    secretVar: "YOUTUBE_CLIENT_SECRET",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }
  },
  x: {
    idVar: "X_CLIENT_ID",
    secretVar: "X_CLIENT_SECRET",
    authorize: "https://twitter.com/i/oauth2/authorize",
    scope: "tweet.read tweet.write users.read offline.access",
    // X (OAuth2 PKCE) requires a code_challenge; we send a minimal "plain"
    // challenge derived from the state so the consent screen renders.
    extra: { code_challenge_method: "plain" }
  }
};

const NOT_CONFIGURED = { ok: false, configured: false, error: "OAuth is not configured for this platform yet." };

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };

  let p;
  try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { platform, accessToken } = p;
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  // verify caller is a signed-in CRM user
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`, {
      apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`
    });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  } catch { return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) }; }

  const key = normalizePlatform(platform);
  const cfg = PLATFORMS[key];
  if (!cfg) {
    // Unknown platform -> treat as not configured (friendly, not an error).
    return { statusCode: 200, body: JSON.stringify(NOT_CONFIGURED) };
  }

  const clientId = process.env[cfg.idVar];
  const clientSecret = process.env[cfg.secretVar];
  const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL;

  // If either required env var (or the redirect base) is missing -> not configured.
  if (!clientId || !clientSecret || !baseUrl) {
    return { statusCode: 200, body: JSON.stringify(NOT_CONFIGURED) };
  }

  // BOTH present: build a real authorize URL.
  const redirectUri = baseUrl.replace(/\/+$/, "") + "/.netlify/functions/social-oauth-callback";

  // random-ish state derived from platform + timestamp (+ a little entropy).
  const state = `${key}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;

  const u = new URL(cfg.authorize);
  u.searchParams.set(cfg.clientParam || "client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  if (cfg.extra) {
    for (const [k, val] of Object.entries(cfg.extra)) u.searchParams.set(k, val);
  }
  // X PKCE needs a code_challenge value to render the consent screen (plain method).
  if (key === "x") u.searchParams.set("code_challenge", state);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      configured: true,
      authorizeUrl: u.toString(),
      note: "Complete the connection in the opened window. Token exchange (callback) is finalized in Phase 2."
    })
  };
};
