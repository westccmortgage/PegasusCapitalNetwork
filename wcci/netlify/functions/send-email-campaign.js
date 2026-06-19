// netlify/functions/send-email-campaign.js
// Sends a tag-targeted email campaign via Resend. Auth-gated.
// Exclusion (DNC / do_not_email / unsubscribed / invalid) is enforced
// SERVER-SIDE so excluded contacts can never be reached from the client.
//
// Env vars:
//   RESEND_API_KEY            (existing)
//   SUPABASE_URL              (existing)
//   SUPABASE_ANON_KEY         (existing)  - used to verify the caller
//   SUPABASE_SERVICE_KEY      (existing)  - used to read leads / write records
//   COMPANY_NAME              e.g. West Coast Capital Mortgage   (REQUIRED for campaigns)
//   COMPANY_ADDRESS           physical mailing address           (REQUIRED for campaigns)
//   CAMPAIGN_EMAIL_FROM       e.g. "West Coast Capital <loans@wcci.online>" (falls back to LEAD_EMAIL_FROM / onboarding@resend.dev)
//   EMAIL_UNSUBSCRIBE_BASE_URL  defaults to https://wcci.online
//   UNSUBSCRIBE_SECRET        optional; falls back to SUPABASE_SERVICE_KEY

const https = require("https");
const crypto = require("crypto");

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
function sbReq(method, path, body, prefer) {
  const h = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" };
  if (prefer) h["Prefer"] = prefer;
  return request(method, `${process.env.SUPABASE_URL}/rest/v1/${path}`, h, body);
}

function unsubToken(id) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_KEY || "wcci";
  return crypto.createHmac("sha256", secret).update(String(id)).digest("hex").slice(0, 32);
}

function complianceFlags(text) {
  const t = text || ""; const f = [];
  const tests = [
    [/guaranteed\s+(approval|rate)/i, "guaranteed approval/rate"],
    [/everyone\s+qualifies/i, "'everyone qualifies'"],
    [/you(?:'re| are)\s+(pre-?)?approved/i, "approval claim"],
    [/\bpre-?approved\b/i, "'preapproved' claim"],
    [/no\s+doc(umentation)?\s+(needed|required)/i, "'no documentation required'"],
    [/\bexact\s+rate\b/i, "'exact rate'"],
    [/\bfinal\s+(terms|payment)\b/i, "'final terms/payment'"],
    [/(?<!not a )commitment to lend/i, "'commitment to lend'"]
  ];
  tests.forEach(([re, lab]) => { if (re.test(t)) f.push(lab); });
  return [...new Set(f)];
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function skipReason(l) {
  if (!l.email) return "missing_email";
  if (!EMAIL_RE.test(l.email)) return "invalid_email";
  if (l.do_not_contact || (Array.isArray(l.tags) && l.tags.includes("DNC"))) return "do_not_contact";
  if (l.do_not_email) return "do_not_email";
  if (l.email_unsubscribed) return "email_unsubscribed";
  return null;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function applyMerge(text, lead, wcciUrl) {
  const first = (lead.name || "there").split(" ")[0];
  const map = { first_name: first, name: lead.name || "there", email: lead.email || "", phone: lead.phone || "",
    loan_purpose: lead.loan_purpose || "", state: lead.state || "", income_type: lead.income_type || "",
    concern: lead.concern || "", wcci_url: wcciUrl };
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map) ? map[k] : m);
}
function buildHtml(bodyText, cta, disclaimer, wcciUrl, companyName, companyAddress, unsubUrl) {
  const bodyHtml = esc(bodyText).replace(/\n/g, "<br>");
  const ctaHtml = cta ? `<p style="margin:24px 0"><a href="${esc(wcciUrl)}" style="background:#0a2463;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(cta)}</a></p>` : "";
  const discHtml = disclaimer ? `<p style="font-size:11px;color:#888;line-height:1.5;margin-top:24px">${esc(disclaimer)}</p>` : "";
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#14213d;font-size:15px;line-height:1.6">
<div>${bodyHtml}</div>${ctaHtml}${discHtml}
<hr style="border:none;border-top:1px solid #e4ddcf;margin:24px 0">
<p style="font-size:12px;color:#888;line-height:1.5">${esc(companyName)}<br>${esc(companyAddress)}<br>
<a href="${esc(unsubUrl)}" style="color:#888">Unsubscribe</a> from future marketing emails.</p></div>`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  let p; try { p = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }
  const { tag, subject, body, cta, disclaimer, templateName, selectedIds, testEmail, accessToken } = p;
  if (!accessToken) return { statusCode: 401, body: JSON.stringify({ error: "Not signed in" }) };

  // verify caller
  let userEmail = "unknown";
  try {
    const v = await request("GET", `${process.env.SUPABASE_URL}/auth/v1/user`,
      { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` });
    if (v.status !== 200) return { statusCode: 401, body: JSON.stringify({ error: "Invalid session" }) };
    try { userEmail = JSON.parse(v.body).email || "unknown"; } catch {}
  } catch { return { statusCode: 401, body: JSON.stringify({ error: "Auth check failed" }) }; }

  if (!subject || !body) return { statusCode: 400, body: JSON.stringify({ error: "Subject and body are required" }) };

  // compliance gate
  const flags = complianceFlags(subject + "\n" + body + "\n" + (cta || ""));
  if (flags.length) return { statusCode: 400, body: JSON.stringify({ error: "Compliance: remove " + flags.join(", ") }) };

  const FROM = process.env.CAMPAIGN_EMAIL_FROM || process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
  const wcciUrl = "https://wcci.online";
  const companyName = process.env.COMPANY_NAME || "West Coast Capital Mortgage";
  const companyAddress = process.env.COMPANY_ADDRESS || "";
  const unsubBase = process.env.EMAIL_UNSUBSCRIBE_BASE_URL || "https://wcci.online";

  // ---- TEST send ----
  if (testEmail) {
    if (!EMAIL_RE.test(testEmail)) return { statusCode: 400, body: JSON.stringify({ error: "Invalid test email" }) };
    const sample = { name: "Test Recipient", email: testEmail, loan_purpose: "purchase", state: "CA", income_type: "W-2", concern: "" };
    const html = buildHtml(applyMerge(body, sample, wcciUrl), applyMerge(cta, sample, wcciUrl), disclaimer, wcciUrl, companyName, companyAddress || "[Company address not set]", unsubBase + "/.netlify/functions/unsubscribe-email?lead=test&token=test");
    const r = await request("POST", "https://api.resend.com/emails",
      { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      { from: FROM, to: [testEmail], subject: "[TEST] " + applyMerge(subject, sample, wcciUrl), html });
    if (r.status >= 400) return { statusCode: 502, body: JSON.stringify({ error: "Resend: " + r.body }) };
    return { statusCode: 200, body: JSON.stringify({ test: true, sentTo: testEmail }) };
  }

  // ---- REAL campaign: company address is mandatory (CAN-SPAM) ----
  if (!companyAddress) return { statusCode: 400, body: JSON.stringify({ error: "COMPANY_ADDRESS is not configured. A physical mailing address is required before sending marketing email." }) };
  if (!tag) return { statusCode: 400, body: JSON.stringify({ error: "No tag selected" }) };

  // fetch leads (service role) and build the tag audience
  const lr = await sbReq("GET", "leads?select=id,name,email,phone,tags,status,loan_purpose,state,income_type,concern,do_not_contact,do_not_email,email_unsubscribed");
  if (lr.status >= 400) return { statusCode: 502, body: JSON.stringify({ error: "Lead fetch: " + lr.body }) };
  const all = JSON.parse(lr.body);
  const audience = all.filter(l => Array.isArray(l.tags) && l.tags.includes(tag));
  const selSet = Array.isArray(selectedIds) ? new Set(selectedIds) : null;

  const sendList = [], skipList = [];
  for (const l of audience) {
    const reason = skipReason(l);
    if (reason) { skipList.push({ l, reason }); continue; }
    if (selSet && !selSet.has(l.id)) { skipList.push({ l, reason: "deselected" }); continue; }
    sendList.push(l);
  }

  // create campaign record
  const cr = await sbReq("POST", "email_campaigns", {
    name: templateName || subject, tag, template_name: templateName || null, subject, body,
    cta: cta || null, disclaimer: disclaimer || null,
    total_recipients: audience.length, eligible_recipients: sendList.length,
    skipped_recipients: skipList.length, status: "sending", created_by: userEmail
  }, "return=representation");
  if (cr.status >= 400) return { statusCode: 502, body: JSON.stringify({ error: "Campaign create: " + cr.body }) };
  const campaign = JSON.parse(cr.body)[0];

  // send in batches of 100 via Resend batch endpoint
  let sent = 0, failed = 0;
  const sentLeads = [];
  for (let i = 0; i < sendList.length; i += 100) {
    const chunk = sendList.slice(i, i + 100);
    const payload = chunk.map(l => {
      const unsubUrl = `${unsubBase}/.netlify/functions/unsubscribe-email?lead=${l.id}&token=${unsubToken(l.id)}`;
      return { from: FROM, to: [l.email], subject: applyMerge(subject, l, wcciUrl),
        html: buildHtml(applyMerge(body, l, wcciUrl), applyMerge(cta, l, wcciUrl), disclaimer, wcciUrl, companyName, companyAddress, unsubUrl) };
    });
    try {
      const br = await request("POST", "https://api.resend.com/emails/batch",
        { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, payload);
      if (br.status >= 400) { failed += chunk.length; chunk.forEach(l => l.__err = "Resend " + br.status); }
      else { sent += chunk.length; chunk.forEach(l => sentLeads.push(l)); }
    } catch (e) { failed += chunk.length; chunk.forEach(l => l.__err = e.message); }
  }

  // recipient records (everyone in the audience)
  const now = new Date().toISOString();
  const recRows = [];
  sendList.forEach(l => recRows.push({ campaign_id: campaign.id, lead_id: l.id, email: l.email,
    status: l.__err ? "failed" : "sent", sent_at: l.__err ? null : now, error_message: l.__err || null }));
  skipList.forEach(({ l, reason }) => recRows.push({ campaign_id: campaign.id, lead_id: l.id, email: l.email || null, status: "skipped", skipped_reason: reason }));
  if (recRows.length) await sbReq("POST", "email_campaign_recipients", recRows, "return=minimal");

  // activity log for each successfully-sent recipient
  if (sentLeads.length) {
    const acts = sentLeads.map(l => ({ lead_id: l.id, activity_type: "email_campaign_sent", direction: "outbound",
      channel: "email", subject, body,
      metadata: { campaign_id: campaign.id, campaign_name: templateName || subject, tag, template_name: templateName || null },
      created_by: userEmail }));
    await sbReq("POST", "crm_activities", acts, "return=minimal");
  }

  // finalize campaign
  await sbReq("PATCH", `email_campaigns?id=eq.${campaign.id}`, { sent_count: sent, failed_count: failed, status: "sent" }, "return=minimal");

  return { statusCode: 200, body: JSON.stringify({
    total: audience.length, eligible: sendList.length, skipped: skipList.length, sent, failed, campaign_id: campaign.id
  }) };
};
