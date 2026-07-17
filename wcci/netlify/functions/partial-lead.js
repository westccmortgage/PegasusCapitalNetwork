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
    // A timeout is AMBIGUOUS: the request may already have been accepted. We
    // reject with a flagged error so the caller keeps the idempotency claim.
    req.setTimeout(timeoutMs, () => { const e = new Error("request timeout"); e.ambiguous = true; req.destroy(e); });
    req.on("error", (e) => { if (!("ambiguous" in e)) e.ambiguous = true; reject(e); });
    req.write(body);
    req.end();
  });
}

function extractFromConversation(messages) {
  // Contact counts ONLY from USER-authored messages — a phone number in model
  // text (hallucinated or echoed) must never create a lead.
  const userText = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const emailMatch = userText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  const phoneMatch = userText.replace(/\$\s?[\d,.]+/g, " ").match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/);
  return {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    transcript: messages.map(m => `${m.role === "user" ? "👤 USER" : "🤖 AI"}: ${m.content}`).join("\n\n")
  };
}

async function sendEmail(extracted, updateNumber) {
  const API_KEY = process.env.RESEND_API_KEY;
  const TO = process.env.LEAD_EMAIL_TO || "akanevsky1967@gmail.com";
  const FROM = process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
  if (!API_KEY) { console.error("RESEND_API_KEY not configured"); return false; }

  const label = updateNumber > 1 ? `⚠️ PARTIAL LEAD (UPDATE #${updateNumber})` : "⚠️ PARTIAL LEAD";
  const subjectPrefix = updateNumber > 1 ? `⚠️ Partial WCCI Lead (Update #${updateNumber})` : "⚠️ Partial WCCI Lead";

  const html = `<h2>${label} — WCCI</h2>
<p><i>User started but hasn't finished the scenario yet${updateNumber > 1 ? " — this is an updated capture with more conversation context" : ""}.</i></p>
<h3>Contact info captured</h3>
<p><b>Email:</b> ${extracted.email || "—"}<br><b>Phone:</b> ${extracted.phone || "—"}</p>
<h3>Conversation transcript</h3>
<pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;font-family:monospace;font-size:12px">${extracted.transcript.replace(/</g, "&lt;")}</pre>
<hr>
<p style="font-size:11px;color:#666"><i>Partial information only. Reach out promptly — they may still complete.</i></p>
<p style="font-size:11px;color:#888;line-height:1.6">${LICENSE_HTML}</p>`;

  try {
    const r = await postJSON("https://api.resend.com/emails", {
      from: FROM, to: [TO],
      subject: `${subjectPrefix} — ${extracted.phone || extracted.email || "Unknown"}`,
      html
    }, { Authorization: `Bearer ${API_KEY}` });
    if (r.status >= 400) console.error("Partial lead email error:", r.status, r.body);
    return r.status < 400;
  } catch (e) { console.error("Partial lead email failed:", e.message); return false; }
}

// Render the structured Strategy Review lead (from the profile panel) as HTML.
function structuredLeadHtml(lead) {
  const p = lead.scenarioProfile || {};
  const money = (n) => (n == null || n === "" ? "—" : "$" + Math.round(Number(n)).toLocaleString("en-US"));
  const paths = (lead.loanPathMatches || []).map(m =>
    `<li><b>${m.label}</b> — ${m.status}${m.estimatedMonthlyPayment ? ` · est. ${money(m.estimatedMonthlyPayment)}/mo · cash ${money(m.estimatedCashToClose)}` : ""}</li>`).join("");
  const ctc = lead.cashToClose;
  return `<h2>🧭 AI MORTGAGE STRATEGY REVIEW — Lead</h2>
<h3>Contact</h3>
<p><b>Name:</b> ${(lead.contact && lead.contact.name) || "—"}<br><b>Phone:</b> ${(lead.contact && lead.contact.phone) || "—"}<br><b>Email:</b> ${(lead.contact && lead.contact.email) || "—"}</p>
<h3>Scenario Profile</h3>
<p><b>Purchase price:</b> ${money(p.purchasePrice)}<br><b>Down payment:</b> ${money(p.downPayment)}<br><b>Loan amount:</b> ${money(p.loanAmount)}<br><b>LTV:</b> ${p.ltv != null ? p.ltv + "%" : "—"}<br><b>State:</b> ${p.state || "—"}<br><b>ZIP/County:</b> ${p.zipOrCounty || "—"}<br><b>Occupancy:</b> ${p.occupancy || "—"}<br><b>Loan purpose:</b> ${p.loanPurpose || "—"}<br><b>Employment:</b> ${p.employmentType || "—"}<br><b>Income doc:</b> ${p.incomeDocPath || "—"}<br><b>Est. FICO:</b> ${p.estimatedFICO || "—"}<br><b>Reserves:</b> ${money(p.reservesAfterClosing)}<br><b>Goal:</b> ${p.borrowerGoal || "—"}</p>
<h3>Possible loan paths</h3><ul>${paths || "<li>—</li>"}</ul>
${ctc ? `<h3>Estimated cash to close</h3><p><b>${money(ctc.estimatedCashToClose)}</b> (down ${money(ctc.downPayment)} + closing ${money(ctc.closingCosts)})<br>Est. payment ${money(ctc.monthlyPayment)}/mo</p>` : ""}
<h3>Missing fields</h3><p>${(lead.missingFields || []).join(", ") || "none"}</p>
<h3>Lead routing</h3><p><b>Lead source:</b> ${lead.leadSource || "WCCI AI Mortgage Strategy Review"}<br><b>Conversation stage:</b> ${lead.conversationStage || "—"}<br><b>Recommended resource path:</b> ${(lead.recommendedResourcePath || []).join(", ") || "—"}</p>
<p style="font-size:11px;color:#888"><i>One ${"West Coast Capital Mortgage Inc."} team handles this inquiry. Contact data is not distributed to multiple outside lenders.</i></p>
<h3>Original message</h3><p style="color:#555">${(lead.originalMessage || "").replace(/</g, "&lt;")}</p>
${lead.utm ? `<h3>UTM</h3><pre>${JSON.stringify(lead.utm)}</pre>` : ""}
<hr><p style="font-size:11px;color:#666"><i>Estimated / planning only. Not an application, approval, or commitment. MLO review required.</i></p>
<p style="font-size:11px;color:#888;line-height:1.6">${LICENSE_HTML}</p>`;
}

async function sendStructuredEmail(lead) {
  const API_KEY = process.env.RESEND_API_KEY;
  const TO = process.env.LEAD_EMAIL_TO || "akanevsky1967@gmail.com";
  const FROM = process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
  if (!API_KEY) { console.error("RESEND_API_KEY not configured"); return false; }
  const name = (lead.contact && lead.contact.name) || "Unknown";
  try {
    const r = await postJSON("https://api.resend.com/emails", {
      from: FROM, to: [TO],
      subject: `🧭 WCCI Strategy Review — ${name}`,
      html: structuredLeadHtml(lead),
    }, { Authorization: `Bearer ${API_KEY}` });
    if (r.status >= 400) console.error("Structured lead email error:", r.status, r.body);
    return r.status < 400;
  } catch (e) { console.error("Structured lead email failed:", e.message); return false; }
}

// ── AI-QUALIFIED COMPLETED LEAD — model-triggered, server-validated ──
// The send + payload builder live in a .cjs module so they are unit-testable.
const { sendAiQualifiedEmail, buildAiQualifiedEmailPayload } = require("./lib/ai-qualified-email.cjs");

const { validateCompletedLead } = require("./lib/lead-validation.cjs");
const {
  claimCompletedLead, markSending, markDelivered, markSendingUnknown, markFailed, canonicalLeadHash,
} = require("./lib/idempotency.cjs");

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const payload = JSON.parse(event.body);
    const { messages, updateNumber, structuredLead, aiQualifiedLead } = payload;

    // AI-QUALIFIED COMPLETED LEAD — the ONE authoritative completed-lead delivery
    // function. Both model signals (SCENARIO_COMPLETE and CONVO_META
    // automatic_lead) converge here via the client; chat.js never sends. The
    // server independently validates, then claims the completedLeadEventId in a
    // durable store so exactly one email is ever sent per qualifying scenario —
    // no matter how many times the same event is delivered.
    if (aiQualifiedLead) {
      const check = validateCompletedLead(aiQualifiedLead);
      if (!check.ok) {
        console.warn("AI-qualified lead REJECTED:", check.errors);
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: "validation failed", details: check.errors }) };
      }
      const eventId = aiQualifiedLead.completedLeadEventId;
      // Canonical hash of the MATERIAL payload, pinned at claim time. A later
      // attempt whose material content changed under the same id is rejected so a
      // mismatched email can never be sent under a promised-stable idempotency key.
      const payloadHash = canonicalLeadHash(aiQualifiedLead);
      const claim = await claimCompletedLead(eventId, { payloadHash });

      if (claim.payloadMismatch) {
        console.warn("AI-qualified lead payload MISMATCH for existing event id:", { eventId });
        return { statusCode: 409, body: JSON.stringify({ ok: false, error: "payload changed for existing event id" }) };
      }
      if (claim.alreadyDelivered) {
        console.log("AI-qualified lead already delivered:", { eventId, mode: claim.mode });
        return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyDelivered: true, idempotencyMode: claim.mode }) };
      }
      if (claim.inflightBusy) {
        // A fresh concurrent attempt already holds the claim — do NOT send a
        // second time. The winner's Resend idempotency key also backstops this.
        console.log("AI-qualified lead in-flight, skipping duplicate send:", { eventId, mode: claim.mode });
        return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyDelivered: true, inFlight: true, idempotencyMode: claim.mode }) };
      }
      // firstTime OR retry (sending_unknown / failed_retryable) — send (or re-send)
      // with the SAME event id + Resend idempotency key + identical material payload.
      await markSending(eventId, claim.backend, claim.etag);
      const send = await sendAiQualifiedEmail(aiQualifiedLead, { idempotencyKey: eventId });

      if (send.outcome === "delivered") {
        await markDelivered(eventId, claim.backend, { channel: "email", doNotContact: !!aiQualifiedLead.doNotContact });
        console.log("AI-qualified lead delivered:", { eventId, mode: claim.mode, retry: claim.retry, doNotContact: aiQualifiedLead.doNotContact });
        return { statusCode: 200, body: JSON.stringify({ ok: true, email: true, alreadyDelivered: false, idempotencyMode: claim.mode }) };
      }
      if (send.outcome === "ambiguous") {
        // AMBIGUOUS — Resend may already hold the request. KEEP the claim; a retry
        // reuses the same event id + Resend idempotency key and resolves to the
        // original delivery (never a second email).
        await markSendingUnknown(eventId, claim.backend, { lastError: send.error });
        console.error("AI-qualified lead delivery UNKNOWN, claim kept for idempotent retry:", { eventId });
        return { statusCode: 504, body: JSON.stringify({ ok: false, error: "delivery outcome unknown; retry is idempotent", retryable: true, idempotencyMode: claim.mode }) };
      }
      // Definitive failure with a real HTTP rejection (or no API key) → no email
      // was accepted, so it is safe to release the claim for a clean retry.
      await markFailed(eventId, claim.backend);
      console.error("AI-qualified lead send FAILED (no request accepted), claim released:", { eventId, status: send.status });
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "email delivery failed" }) };
    }

    // Structured Strategy Review lead from the profile panel (user-initiated).
    if (structuredLead) {
      const em = await sendStructuredEmail(structuredLead);
      console.log("Structured lead delivery:", { email: em });
      return { statusCode: 200, body: JSON.stringify({ ok: em, email: em }) };
    }

    if (!Array.isArray(messages)) return { statusCode: 400, body: "Invalid payload" };

    const extracted = extractFromConversation(messages);
    if (!extracted.email && !extracted.phone) {
      return { statusCode: 200, body: JSON.stringify({ skipped: "no contact yet" }) };
    }

    const em = await sendEmail(extracted, updateNumber || 1);
    console.log("Partial lead delivery:", { email: em, updateNumber: updateNumber || 1 });
    return { statusCode: 200, body: JSON.stringify({ email: em }) };
  } catch (e) {
    console.error("Partial lead error:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
