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

function fmt(label, val) { return `${label}: ${val || "—"}`; }

// Mirror of client-side checklist logic (App.jsx). Keep in sync.
function buildDocumentChecklist(scenario) {
  const s = scenario || {};
  const income = (s.incomeType || "").toLowerCase();
  const purpose = (s.loanPurpose || "").toLowerCase();
  const concern = (s.concern || "").toLowerCase();
  const occupancy = (s.occupancy || "").toLowerCase();

  const buckets = [];
  const needsBankStmt = concern.includes("bank statement") || concern.includes("tax returns too low");
  const isInvestor = purpose.includes("investment") || occupancy.includes("investment") || income.includes("investor") || concern.includes("dscr");
  const isSelfEmp = income.includes("self-employed") || income.includes("1099") || income.includes("business owner") || income.includes("commission");
  const isW2 = income.includes("w-2") || income.includes("w2");
  const isRefi = purpose.includes("refinance") || purpose.includes("cash-out");

  if (needsBankStmt) {
    buckets.push({ label: "Bank statement / non-QM", items: [
      "12 or 24 months personal or business bank statements",
      "Business verification (license, CPA letter, or website)",
      "Government-issued ID",
      "Asset statements (savings, retirement, reserves)",
    ]});
  } else if (isInvestor) {
    buckets.push({ label: "DSCR / investor", items: [
      "Lease agreement or market rent estimate",
      "Property expenses (insurance, taxes, HOA estimate)",
      "Entity documents if applicable (LLC, trust)",
      "Asset statements",
      "Government-issued ID",
    ]});
  } else if (isSelfEmp) {
    buckets.push({ label: "Self-employed / business owner", items: [
      "Last 2 years personal tax returns",
      "Business tax returns if applicable",
      "Year-to-date profit and loss statement",
      "Business bank statements",
      "Government-issued ID",
      "Asset statements",
    ]});
  } else if (isW2) {
    buckets.push({ label: "W-2 borrower", items: [
      "Recent paystubs (last 30 days)",
      "Last 2 years W-2s",
      "Government-issued ID",
      "Recent bank statements",
      "Purchase contract if available",
    ]});
  } else {
    buckets.push({ label: "Standard starting list", items: [
      "Government-issued ID",
      "Recent paystubs or income documentation",
      "Last 2 years tax returns",
      "Recent bank and asset statements",
    ]});
  }

  if (isRefi) {
    buckets.push({ label: "Refinance", items: [
      "Current mortgage statement",
      "Homeowners insurance declaration page",
      "Property tax bill",
      "Payoff statement if available",
      "HELOC or second mortgage statement if applicable",
    ]});
  }

  const seen = new Set();
  const items = [];
  for (const b of buckets) {
    for (const it of b.items) {
      const key = it.toLowerCase();
      if (!seen.has(key)) { seen.add(key); items.push(it); }
    }
  }
  return { primaryLabel: buckets.map(b => b.label).join(" + "), items };
}

async function sendEmail(scenario) {
  const API_KEY = process.env.RESEND_API_KEY;
  const TO = process.env.LEAD_EMAIL_TO || "akanevsky1967@gmail.com";
  const FROM = process.env.LEAD_EMAIL_FROM || "onboarding@resend.dev";
  if (!API_KEY) { console.error("RESEND_API_KEY not configured"); return false; }
  const s = scenario;
  const checklist = buildDocumentChecklist(s);
  const checklistHtml = checklist.items.map(i => `<li>${i}</li>`).join("");
  const html = `<h2>NEW WCCI MORTGAGE AI LEAD</h2>
<h3>Contact</h3>
<p><b>Name:</b> ${s.name || "—"}<br><b>Phone:</b> ${s.phone || "—"}<br><b>Email:</b> ${s.email || "—"}<br><b>Preferred contact:</b> ${s.preferredContact || "—"}</p>
<h3>Scenario</h3>
<p><b>Loan purpose:</b> ${s.loanPurpose || "—"}<br><b>State:</b> ${s.state || "—"}<br><b>Property address:</b> ${s.propertyAddress || "—"}<br><b>Purchase price / value:</b> ${s.purchasePrice || "—"}<br><b>Desired loan amount:</b> ${s.loanAmount || "—"}<br><b>Down payment / equity:</b> ${s.downPayment || "—"}<br><b>Occupancy:</b> ${s.occupancy || "—"}<br><b>Property type:</b> ${s.propertyType || "—"}</p>
<h3>Borrower</h3>
<p><b>Income type:</b> ${s.incomeType || "—"}<br><b>Documentation type:</b> ${s.docType || "—"}<br><b>First-time buyer:</b> ${s.firstTimeBuyer || "—"}<br><b>Reserves / assets:</b> ${s.reserves || "—"}<br><b>Credit score range:</b> ${s.creditScore || "—"}<br><b>Timeline:</b> ${s.timeline || "—"}<br><b>Biggest concern:</b> ${s.concern || "—"}</p>
<h3>AI Preliminary Notes</h3>
<p><b>Risk flag:</b> ${s.riskFlag || "—"}<br><b>Main concern:</b> ${s.mainConcern || "—"}<br><b>Possible path:</b> ${s.possiblePath || "—"}<br><b>Documents likely needed:</b> ${s.documentsNeeded || "—"}<br><b>Recommended next step:</b> ${s.nextStep || "—"}</p>
<h3>Document Handoff</h3>
<ul>
  <li>Document upload handled in Arive: <b>Yes</b></li>
  <li>Borrower shown document checklist: <b>Yes</b></li>
  <li>Borrower instructed not to email sensitive documents: <b>Yes</b></li>
  <li>Recommended next step: MLO call, then send secure Arive Client Needs / document request</li>
</ul>
<h3>Likely Documents to Request <span style="font-weight:normal;color:#666;font-size:13px">(${checklist.primaryLabel})</span></h3>
<ul>${checklistHtml}</ul>
<hr>
<p style="font-size:11px;color:#666"><i>Preliminary scenario only. MLO review required. No approval, pricing, or commitment issued by AI.</i></p>
<p style="font-size:11px;color:#888;line-height:1.6">${LICENSE_HTML}</p>`;

  try {
    const r = await postJSON("https://api.resend.com/emails", {
      from: FROM, to: [TO], subject: `🏠 New WCCI Lead — ${s.name || "Unknown"} · ${s.loanPurpose || ""} · ${s.state || ""}`, html
    }, { Authorization: `Bearer ${API_KEY}` });
    if (r.status >= 400) console.error("Resend error:", r.status, r.body);
    return r.status < 400;
  } catch (e) { console.error("Email failed:", e.message); return false; }
}


exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const r = await postJSON("https://api.anthropic.com/v1/messages", event.body, {
      "x-api-key": process.env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    });
    const data = JSON.parse(r.body);
    
    // Check if scenario complete — send email lead
    const fullText = (data.content || []).map(b => b.text || "").join("");
    let delivery = null;
    if (fullText.includes("SCENARIO_COMPLETE:")) {
      try {
        const jsonLine = fullText.split("SCENARIO_COMPLETE:")[1].split("\n")[0].trim();
        const scenario = JSON.parse(jsonLine);
        const em = await sendEmail(scenario);
        delivery = { email: em, anyDelivered: em };
        console.log("Lead delivery:", delivery);
      } catch (e) {
        console.error("Lead delivery error:", e.message);
        delivery = { email: false, anyDelivered: false, error: e.message };
      }
    }
    
    // Attach delivery status to response body so client can show fallback on total failure
    if (delivery) data._leadDelivery = delivery;
    
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
  } catch (e) {
    console.error("Chat function error:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
