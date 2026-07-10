// Lead submission adapter layer.
//
// Builds a structured lead object and routes it through a pluggable set of
// adapters (email, Telegram, CRM, Arive/LOS, Google Sheet, webhook/Zapier).
// Nothing is wired to a live backend by default — a safe placeholder logs the
// structured lead and reports success so the UI can show its success state.
// Flip `enabled: true` (and implement `send`) to connect a real channel later.

function readUTM() {
  try {
    const q = new URLSearchParams(window.location.search);
    const utm = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = q.get(k);
      if (v) utm[k] = v;
    }
    return Object.keys(utm).length ? utm : undefined;
  } catch { return undefined; }
}

// Assemble the full structured lead object the spec requires.
export function buildLead({
  originalMessage, parsedScenario, profile, missingFields,
  loanPaths, cashToClose, strategySummary, borrowerGoal, timestamp,
}) {
  return {
    originalMessage: originalMessage || '',
    parsedScenario: parsedScenario || {},
    scenarioProfile: profile || {},
    missingFields: missingFields || [],
    loanPathMatches: (loanPaths || []).map(p => ({
      id: p.id, label: p.label, status: p.status, why: p.why,
      estimatedMonthlyPayment: p.estimate ? p.estimate.monthlyPayment : null,
      estimatedCashToClose: p.estimate ? p.estimate.estimatedCashToClose : null,
    })),
    cashToClose: cashToClose || null,
    strategySummary: strategySummary || '',
    borrowerGoal: borrowerGoal || (profile && profile.borrowerGoal) || '',
    contact: {
      name: profile && profile.name, phone: profile && profile.phone, email: profile && profile.email,
    },
    timestamp: timestamp || new Date().toISOString(),
    sourcePage: (typeof window !== 'undefined' && window.location) ? window.location.href : 'wcci.online',
    utm: readUTM() || null,
  };
}

// ── Adapter registry — all disabled until a backend is connected ──
export const LEAD_ADAPTERS = {
  // Server email (Resend via Netlify function). This is the one real path today;
  // it is invoked through the existing chat/partial-lead functions on the server,
  // so the client adapter posts the structured lead to a single endpoint.
  email: {
    enabled: true,
    endpoint: '/.netlify/functions/partial-lead',
    async send(lead) {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredLead: lead, messages: lead.__messages || [] }),
      });
      return res.ok;
    },
  },
  telegram: { enabled: false, async send() { return false; } },
  crm: { enabled: false, async send() { return false; } },
  arive: { enabled: false, async send() { return false; } },
  googleSheet: { enabled: false, async send() { return false; } },
  webhook: { enabled: false, endpoint: '', async send() { return false; } },
};

// Placeholder used when no adapter is enabled or all fail: log safely + succeed.
function placeholderSubmit(lead) {
  try {
    // Never log full contact PII to the console in production noise; keep it minimal.
    // eslint-disable-next-line no-console
    console.info('[leadAdapter] placeholder captured lead:', {
      price: lead.scenarioProfile.purchasePrice,
      paths: lead.loanPathMatches.map(p => p.label),
      hasContact: !!(lead.contact.email || lead.contact.phone),
      timestamp: lead.timestamp,
    });
  } catch {}
  return { ok: true, via: 'placeholder', delivered: false };
}

// Submit through every enabled adapter; fall back to the placeholder.
export async function submitLead(lead, { messages } = {}) {
  const payload = { ...lead, __messages: messages || [] };
  const attempted = [];
  let anyDelivered = false;

  for (const [name, adapter] of Object.entries(LEAD_ADAPTERS)) {
    if (!adapter.enabled) continue;
    attempted.push(name);
    try {
      const ok = await adapter.send(payload);
      if (ok) anyDelivered = true;
    } catch {
      // swallow — we always resolve to a success state for the user
    }
  }

  if (!anyDelivered) {
    const ph = placeholderSubmit(lead);
    return { ok: true, delivered: false, via: 'placeholder', attempted };
  }
  return { ok: true, delivered: true, via: attempted, attempted };
}
