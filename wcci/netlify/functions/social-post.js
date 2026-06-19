// netlify/functions/social-post.js
// Generates compliant mortgage social posts via the Anthropic API.
// Auth-gated (Supabase token) so it can't be abused. Nothing is auto-posted.
//
// Env vars used:
//   ANTHROPIC_KEY        (already set — same key chat.js uses)
//   SUPABASE_URL         (already set)
//   SUPABASE_ANON_KEY    (already set)
//   SOCIAL_POST_MODEL    (optional — defaults below; set this if your key
//                         needs a different model string)

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

const MODEL = process.env.SOCIAL_POST_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM = `You are a marketing copywriter for West Coast Capital Mortgage (brand: WCCI), a LICENSED mortgage company. NMLS #2817729. You write social media copy that is engaging but strictly compliant with US mortgage advertising rules (TILA/Reg Z, UDAAP, Fair Housing).

About WCCI: wcci.online is an AI-powered mortgage strategy assistant. Borrowers describe their purchase, refinance, income, or investment-property scenario and receive a PRELIMINARY mortgage strategy before a full application or credit pull. Tagline: "Your Mortgage Strategy, Powered by AI." Positioning: no credit pull, no pressure, preliminary review only, reviewed by licensed mortgage professionals.

ABSOLUTE COMPLIANCE RULES — never write any of the following:
- guaranteed approval, "approved!", "you're approved", or any approval guarantee
- "everyone qualifies", "anyone can qualify", or similar
- specific interest rates, APRs, or any number followed by %
- specific monthly payment amounts or payment promises
- "lowest rate", "best rate", or comparative rate claims
- misleading or absolute loan-term promises
- fake or invented testimonials, client names, or quotes
- unverified statistics or made-up numbers
- discriminatory or exclusionary targeting (never reference race, color, religion, national origin, sex, familial status, disability, or use exclusionary language) — Fair Housing applies

SAFE framing you MAY use: preliminary mortgage strategy; a possible mortgage path; reviewed by a licensed mortgage professional; no credit pull unless authorized; this is not a loan approval; not a commitment to lend; not a rate quote.

Platform style:
- LinkedIn: professional, can be a few short paragraphs, line breaks fine, thought-leadership tone.
- Instagram: warm and visual, short punchy lines, a light emoji is okay, hashtag-friendly.
- Facebook: conversational, medium length, approachable.
- X: under 280 characters total, punchy, minimal hashtags.

Return ONLY a valid JSON object — no markdown, no code fences, no preamble — with exactly these keys:
{
 "main_post": "platform-appropriate post in the requested tone and audience",
 "short_post": "a condensed version",
 "hashtags": "5-9 professional hashtags, space separated, each starting with #",
 "cta": "one short call-to-action line, e.g. Start your preliminary review at wcci.online",
 "disclaimer": "If the post references loans/mortgages or wcci.online AI, set this to: Preliminary mortgage scenario review only. Not a loan approval, preapproval, commitment to lend, rate quote, or underwriting decision. Otherwise empty string."
}`;

// server-side backstop scan for obviously non-compliant phrasing
function complianceFlags(text) {
  const t = (text || "").toLowerCase();
  const flags = [];
  if (/guarantee/.test(t)) flags.push("Contains 'guarantee'");
  if (/everyone qualifies|anyone qualifies|all qualify/.test(t)) flags.push("Universal-qualification claim");
  if (/\d+(\.\d+)?\s?%/.test(text || "")) flags.push("Contains a rate/percentage");
  if (/(lowest|best)\s+rate/.test(t)) flags.push("Comparative rate claim");
  if (/\$\s?\d[\d,]*\s*(\/\s?mo|per month|a month|monthly|payment)/.test(t)) flags.push("Specific payment amount");
  if (/\byou(?:'re| are)\s+approved\b|guaranteed approval|pre-?approved guaranteed/.test(t)) flags.push("Approval guarantee");
  return flags;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };

  let p;
  try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }
  const { postType, platform, tone, audience, tag, topic, accessToken } = p;
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };
  if (!process.env.ANTHROPIC_KEY) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_KEY not configured" }) };

  // verify caller is a signed-in CRM user
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`, {
      apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`
    });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
  } catch { return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) }; }

  const userMsg = `Create a social media post with these parameters:
- Platform: ${platform || "LinkedIn"}
- Post type: ${postType || "General WCCI Mortgage AI post"}
- Tone: ${tone || "Professional"}
- Target audience: ${audience || "general borrowers"}
- Audience tag context: ${tag || "none"}
- Topic / what to post about: ${topic || "(use the post type as the theme)"}

Return ONLY the JSON object.`;

  try {
    const r = await request("POST", "https://api.anthropic.com/v1/messages",
      { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      { model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content: userMsg }] });

    if (r.status >= 400) return { statusCode: 502, body: JSON.stringify({ error: "Anthropic: " + r.body }) };

    const data = JSON.parse(r.body);
    const raw = (data.content || []).map(b => b.text || "").join("").trim();
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let post;
    try { post = JSON.parse(cleaned); }
    catch { post = { main_post: raw, short_post: "", hashtags: "", cta: "", disclaimer: "" }; }

    post.compliance_flags = complianceFlags((post.main_post || "") + " " + (post.short_post || ""));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(post) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
