/**
 * leadSubmission.js
 * Clean, reusable lead-capture layer. The UI builds a lead payload that always
 * carries the full strategy snapshot, so sales receives context, not just a name.
 *
 * Validation here is a soft client-side gate; the Netlify function re-validates.
 */

import { DEFAULTS } from '../config/defaults.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {Object} lead     { name, email, phone, message }
 * @param {Object} snapshot engine snapshot (optional but recommended)
 * @returns {{ valid:boolean, errors:Object }}
 */
export function validateLead(lead) {
  const errors = {};
  for (const field of DEFAULTS.lead.requiredFields) {
    if (!lead[field] || String(lead[field]).trim() === '') {
      errors[field] = 'Required';
    }
  }
  if (lead.email && !EMAIL_RE.test(lead.email)) {
    errors.email = 'Enter a valid email';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Build the canonical payload sent to the backend.
 */
export function buildLeadPayload(lead, snapshot) {
  return {
    source: DEFAULTS.lead && 'BeforeJumboLoan.com',
    submittedAt: new Date().toISOString(),
    contact: {
      name: (lead.name || '').trim(),
      email: (lead.email || '').trim(),
      phone: (lead.phone || '').trim(),
      message: (lead.message || '').trim(),
    },
    // The full scenario travels with the lead — this is the product's edge.
    scenario: snapshot
      ? {
          summary: snapshot.aiContext,
          inputs: snapshot.inputs,
          jumboGap: snapshot.jumboGap,
          paymentStack: { total: snapshot.paymentStack.total, ltv: snapshot.paymentStack.ltv },
        }
      : null,
  };
}

/**
 * Submit the lead. Returns a normalized result the UI can render.
 * @returns {Promise<{ ok:boolean, status:number, data?:any, error?:string }>}
 */
export async function submitLead(lead, snapshot, endpoint = DEFAULTS.lead.endpoint) {
  const { valid, errors } = validateLead(lead);
  if (!valid) {
    return { ok: false, status: 0, error: 'validation', errors };
  }

  const payload = buildLeadPayload(lead, snapshot);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: String(err && err.message) || 'network' };
  }
}

export default submitLead;
