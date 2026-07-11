// Server-side independent validation for AI-qualified leads.
//
// The model's completion signal is a TRIGGER REQUEST, not the source of truth.
// Before any lead email is sent, this module re-checks everything the spec
// requires — a forged marker typed by a user, a hallucinated contact, or a
// client-asserted "submitted" status can never cause delivery.

const EMAIL_RE = /^[\w.+\-]+@[\w\-]+\.[a-z]{2,}$/i;
const PHONE_DIGITS = (v) => String(v || '').replace(/\D/g, '');

function validPhone(v) {
  const d = PHONE_DIGITS(v);
  return d.length === 10 || (d.length === 11 && d.startsWith('1'));
}
function validEmail(v) { return EMAIL_RE.test(String(v || '').trim()); }

// The contact must originate from a USER-authored message — the payload carries
// the user messages, and we verify the phone digits / email actually appear
// there. Model-invented contact info never validates.
function contactInUserMessages(payload) {
  const userText = (Array.isArray(payload.userMessages) ? payload.userMessages : []).join('\n').toLowerCase();
  if (!userText) return false;
  if (payload.email && validEmail(payload.email) && userText.includes(String(payload.email).toLowerCase())) return true;
  if (payload.phone && validPhone(payload.phone)) {
    const digits = PHONE_DIGITS(payload.phone).replace(/^1(?=\d{10}$)/, '');
    const userDigits = userText.replace(/\D/g, '');
    if (userDigits.includes(digits)) return true;
  }
  return false;
}

const KNOWN_LEAD_TYPES = new Set(['AI Qualified / Scenario Complete']);
const UUIDISH = /^[0-9a-z-]{16,64}$/i;

/**
 * Validate an AI-qualified completed-lead payload.
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateCompletedLead(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['no payload'] };

  // Schema / trigger sanity.
  if (!KNOWN_LEAD_TYPES.has(payload.leadType)) errors.push('unknown lead type');
  if (payload.status === 'submitted') errors.push('client-supplied submitted status rejected');
  if (!payload.sessionId || !UUIDISH.test(payload.sessionId)) errors.push('invalid session id');
  if (!payload.nonce || String(payload.nonce).length < 8) errors.push('missing nonce');

  // Contact: valid AND user-authored.
  const hasValid = (payload.phone && validPhone(payload.phone)) || (payload.email && validEmail(payload.email));
  if (!hasValid) errors.push('no valid contact method');
  else if (!contactInUserMessages(payload)) errors.push('contact not found in user-authored messages');

  // Scenario minimums: loan goal + geography + some context.
  if (!payload.loanGoal) errors.push('no loan goal');
  if (!payload.state && !payload.city && !payload.county && !payload.zip) errors.push('no geography');
  const context = ['purchasePrice', 'loanAmount', 'downPayment', 'occupancy', 'propertyType', 'creditRange', 'incomeType']
    .filter(k => payload[k] !== null && payload[k] !== undefined && payload[k] !== '').length +
    ((payload.primaryQuestions || []).length ? 1 : 0);
  if (context < 2) errors.push('insufficient scenario context');

  return { ok: errors.length === 0, errors };
}

// Validate the completed-lead marker came from the ASSISTANT response text —
// callers pass ONLY the model's reply here; anything found in user-authored
// text must be ignored by construction. This helper double-checks that a
// scenario echoed verbatim from a user message (identical text present in
// userMessages) does not count.
function completionEchoedFromUser(scenarioJsonLine, userMessages) {
  if (!scenarioJsonLine) return false;
  const needle = String(scenarioJsonLine).replace(/\s+/g, '');
  return (Array.isArray(userMessages) ? userMessages : [])
    .some(m => String(m).replace(/\s+/g, '').includes(needle));
}

module.exports = { validateCompletedLead, contactInUserMessages, completionEchoedFromUser, validPhone, validEmail };
