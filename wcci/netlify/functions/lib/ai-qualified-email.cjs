// AI-qualified completed-lead email — the single authoritative completed-lead
// send. Extracted into a .cjs module so it can be unit-tested (the Netlify
// function files are .js but package.json sets "type":"module").
//
// The send is idempotent at TWO layers:
//   • the server claim (idempotency.cjs) gates who may send, and
//   • the Resend `Idempotency-Key` header (== completedLeadEventId) collapses a
//     "Resend accepted but our response was lost" retry into the original email.

const https = require("https");

// Canonical licensing footer (company NMLS #2817729 and broker NMLS #2775380 are
// distinct — never interchange them).
const LICENSE_HTML = 'West Coast Capital Mortgage Inc. · CA DRE Corporation License #02440065 · NMLS #2817729<br>Anatoliy Kanevsky · California Real Estate Broker · CA DRE Broker License #01385024 · NMLS #2775380';

function postJSON(url, data, headers = {}, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = typeof data === "string" ? data : JSON.stringify(data);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers }
    }, (res) => {
      let chunks = "";
      res.on("data", (c) => chunks += c);
      res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
    });
    // A timeout is AMBIGUOUS: the request may already have been accepted. Reject
    // with a flagged error so the caller keeps the idempotency claim.
    req.setTimeout(timeoutMs, () => { const e = new Error("request timeout"); e.ambiguous = true; req.destroy(e); });
    req.on("error", (e) => { if (!("ambiguous" in e)) e.ambiguous = true; reject(e); });
    req.write(body);
    req.end();
  });
}

function aiQualifiedHtml(l) {
  const safe = (v) => String(v == null || v === "" ? "—" : v).replace(/</g, "&lt;");
  const money = (n) => (n == null || n === "" ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US"));
  const contactBanner = l.doNotContact
    ? `<p style="background:#fdeee7;border:1px solid #e07a3a;padding:10px;border-radius:6px"><b>⛔ DO NOT CONTACT.</b> The borrower asked not to be contacted. This record is delivered for recordkeeping and scenario intelligence only — do not generate any outreach while this flag is set.</p>`
    : `<p style="background:#e9f7ef;border:1px solid #1aa35a;padding:10px;border-radius:6px"><b>✅ AI-QUALIFIED LEAD</b> — the scenario is ready for licensed follow-up via the borrower's preferred method (${safe(l.contactPreference)}).</p>`;
  return `<h2>🤖 AI-QUALIFIED LEAD — Scenario Complete</h2>
${contactBanner}
<h3>Contact</h3>
<p><b>Name:</b> ${safe(l.name)}<br><b>Phone:</b> ${safe(l.phone)}<br><b>Email:</b> ${safe(l.email)}<br><b>Preferred language:</b> ${safe(l.preferredLanguage)}<br><b>Contact preference:</b> ${safe(l.contactPreference)}</p>
<h3>Scenario</h3>
<p><b>Loan goal:</b> ${safe(l.loanGoal)}<br><b>Location:</b> ${[l.city, l.county && l.county + " County", l.state, l.zip].filter(Boolean).map(safe).join(", ") || "—"}<br>
<b>Price/value:</b> ${money(l.purchasePrice)} · <b>Loan:</b> ${money(l.loanAmount)} · <b>Down:</b> ${money(l.downPayment)}<br>
<b>Occupancy:</b> ${safe(l.occupancy)} · <b>Property:</b> ${safe(l.propertyType)} · <b>Credit ~</b> ${safe(l.creditRange)}<br>
<b>Income:</b> ${safe(l.incomeType)} · <b>Timing:</b> ${safe(l.expectedTiming)}</p>
<h3>AI summary</h3><p>${safe(l.aiSummary)}</p>
<h3>Context</h3>
<p><b>Primary questions/topics:</b> ${(l.primaryQuestions || []).map(safe).join(", ") || "—"}<br>
<b>Objections:</b> ${(l.objections || []).map(safe).join(", ") || "—"}<br>
<b>Competitor mentioned:</b> ${safe(l.competitorMentioned)}<br>
<b>Resources recommended:</b> ${(l.resourcesRecommended || []).map(safe).join(", ") || "—"}<br>
<b>Resources opened:</b> ${(l.resourcesOpened || []).map(safe).join(", ") || "—"}<br>
<b>Unresolved items:</b> ${(l.unresolvedItems || []).map(safe).join(", ") || "none"}</p>
<h3>Qualification</h3>
<p><b>Reason:</b> ${safe(l.qualificationReason)} · <b>Model confidence:</b> ${l.modelConfidence != null ? l.modelConfidence : "—"} · <b>Completeness:</b> ${l.scenarioCompleteness != null ? Math.round(l.scenarioCompleteness * 100) + "%" : "—"}<br>
<b>Source:</b> ${safe(l.sourceWebsite)} (${safe(l.activeBrand)}) · <b>Session:</b> ${safe(l.sessionId)} · <b>Submitted:</b> ${safe(l.submittedAt)}</p>
<p style="font-size:11px;color:#888"><i>One West Coast Capital Mortgage Inc. team handles this inquiry. Contact data is not distributed to multiple outside lenders.</i></p>
<hr><p style="font-size:11px;color:#666"><i>Preliminary AI-qualified scenario. MLO review required. No approval, pricing, or commitment issued by AI.</i></p>
<p style="font-size:11px;color:#888;line-height:1.6">${LICENSE_HTML}</p>`;
}

// Build the STABLE material email payload. Contains no timestamps, random ids, or
// regenerated wording, so a retry under the same Resend idempotency key sends
// byte-identical content. (submittedAt/session appear only inside the HTML body
// via the lead object, which is itself pinned by the payload-hash claim.)
function buildAiQualifiedEmailPayload(lead, { from, to }) {
  const flag = lead.doNotContact ? "⛔ DNC" : "✅";
  return {
    from, to: [to],
    subject: `🤖 ${flag} AI-Qualified WCCI Lead — ${lead.name || lead.phone || lead.email || "Borrower"} · ${lead.loanGoal || ""} · ${lead.state || ""}`,
    html: aiQualifiedHtml(lead),
  };
}

// Returns a discriminated outcome so the caller can decide claim disposition:
//   { outcome: 'delivered' }                         → mark delivered
//   { outcome: 'ambiguous', error }                  → KEEP claim (sending_unknown), retry
//   { outcome: 'failed', status?, body?, released? } → definitive, no request accepted
// `post` is injectable for tests. `idempotencyKey` MUST be the completedLeadEventId
// so a Resend-accepted-but-response-lost send is deduplicated by Resend itself.
async function sendAiQualifiedEmail(lead, { idempotencyKey, post } = {}) {
  const API_KEY = process.env.RESEND_API_KEY;
  const TO = process.env.LEAD_EMAIL_TO || "akanevsky1967@gmail.com";
  const FROM = process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
  if (!API_KEY) { console.error("RESEND_API_KEY not configured"); return { outcome: "failed", released: true, error: "no api key" }; }
  const doPost = post || postJSON;
  const payload = buildAiQualifiedEmailPayload(lead, { from: FROM, to: TO });
  const headers = { Authorization: `Bearer ${API_KEY}` };
  // RESEND IDEMPOTENCY KEY — the exact completedLeadEventId, never a fresh random
  // key. Protects the case where Resend accepted the email but the Function timed
  // out before it saw the 200: the retry returns Resend's original response.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const r = await doPost("https://api.resend.com/emails", payload, headers);
    if (r.status >= 400) {
      console.error("AI-qualified lead email error:", r.status, r.body);
      // A 4xx/5xx HTTP response means Resend answered and rejected — no email was
      // accepted, so this claim is safe to release for a clean retry.
      return { outcome: "failed", status: r.status, body: r.body, released: true };
    }
    return { outcome: "delivered", status: r.status };
  } catch (e) {
    // Network error / timeout → AMBIGUOUS. Resend may already hold the request.
    // Never release the claim here.
    console.error("AI-qualified lead email ambiguous failure:", e.message);
    return { outcome: "ambiguous", error: e.message };
  }
}

module.exports = { sendAiQualifiedEmail, buildAiQualifiedEmailPayload, aiQualifiedHtml, LICENSE_HTML, postJSON };
