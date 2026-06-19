const https = require("https");

function postJSON(url, data, headers = {}) {
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
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractFromConversation(messages) {
  const allText = messages.map(m => m.content).join("\n");
  const emailMatch = allText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  const phoneMatch = allText.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
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
<p style="font-size:11px;color:#666"><i>Partial information only. Reach out promptly — they may still complete.</i></p>`;

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

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const { messages, updateNumber } = JSON.parse(event.body);
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
