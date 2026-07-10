const https = require("https");

// Canonical licensing footer (company NMLS #2817729 and broker NMLS #2775380 are
// distinct — never interchange them).
const LICENSE_HTML = 'West Coast Capital Mortgage Inc. · CA DRE Corporation License #02440065 · NMLS #2817729<br>Anatoliy Kanevsky · California Real Estate Broker · CA DRE Broker License #01385024 · NMLS #2775380';

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

// Secure document hand-off.
//
// A borrower can attach a document (e.g., a bank statement). It is emailed
// straight to the licensed team as an attachment and is NEVER sent to the AI /
// Anthropic — the file content does not leave this function except to the team's
// inbox. This keeps sensitive PII out of the model and avoids any underwriting
// or licensing exposure.
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB raw

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const { filename, contentType, dataBase64, contact, note } = JSON.parse(event.body || "{}");
    if (!filename || !dataBase64) return { statusCode: 400, body: JSON.stringify({ error: "missing file" }) };

    // Guard size (base64 is ~4/3 of raw bytes).
    const approxBytes = Math.floor(dataBase64.length * 3 / 4);
    if (approxBytes > MAX_BYTES) return { statusCode: 413, body: JSON.stringify({ error: "file too large" }) };

    const API_KEY = process.env.RESEND_API_KEY;
    const TO = process.env.LEAD_EMAIL_TO || "akanevsky1967@gmail.com";
    const FROM = process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
    if (!API_KEY) { console.error("RESEND_API_KEY not configured"); return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "email not configured" }) }; }

    const c = contact || {};
    const safe = (s) => String(s == null ? "—" : s).replace(/</g, "&lt;");
    const html = `<h2>📎 WCCI — Borrower document upload</h2>
<p><i>A borrower attached a document in the Loan Strategy chat. It is attached to this email and was NOT shared with the AI.</i></p>
<h3>Contact</h3>
<p><b>Name:</b> ${safe(c.name)}<br><b>Phone:</b> ${safe(c.phone)}<br><b>Email:</b> ${safe(c.email)}</p>
${note ? `<h3>Scenario context</h3><p>${safe(note)}</p>` : ""}
<p><b>File:</b> ${safe(filename)}</p>
<hr><p style="font-size:11px;color:#666"><i>Handle per your secure document policy (Arive). Preliminary — MLO review required.</i></p>
<p style="font-size:11px;color:#888;line-height:1.6">${LICENSE_HTML}</p>`;

    const r = await postJSON("https://api.resend.com/emails", {
      from: FROM,
      to: [TO],
      subject: `📎 WCCI document — ${c.name || "Borrower"} — ${filename}`,
      html,
      attachments: [{ filename, content: dataBase64 }],
    }, { Authorization: `Bearer ${API_KEY}` });

    if (r.status >= 400) { console.error("Upload email error:", r.status, r.body); return { statusCode: 200, body: JSON.stringify({ ok: false }) }; }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("Upload error:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
