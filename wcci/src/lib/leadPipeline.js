// Automatic lead pipeline — model-initiated, app-validated.
//
// Two automatic stages (owner-approved, no extra borrower confirmation button):
//   PARTIAL   — the borrower voluntarily typed a valid phone/email, scenario
//               not yet complete.
//   COMPLETE  — the model signals the scenario is ready (CONVO_META handoff
//               "automatic_lead" or SCENARIO_COMPLETE), and this module
//               INDEPENDENTLY validates before anything is sent. Model output
//               is a trigger request, never the source of truth.
//
// Hard guarantees implemented here:
//   • Contact info counts ONLY when it appears in a USER-authored message.
//   • Completion markers typed by the user are inert (neutralized before they
//     reach the model; parsing only ever reads the assistant response).
//   • One stable fingerprint per (contact, session, domain): a partial lead is
//     PROMOTED, never duplicated; repeated model signals can't double-submit.
//   • Truthful status machine: qualifying → ready → submitting → submitted |
//     failed. `submitted` is set only after the endpoint confirms success.
//     Failures keep the lead locally and retry with a capped policy.
//   • doNotContact is a flag on the record, not a blocker for record creation.

import { profileStatus } from './scenarioProfile.js';

// ── Contact extraction (user-authored messages ONLY) ──
const EMAIL_RE = /[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:^|[\s:.,;(])(\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/;

export function extractUserContact(messages) {
  const out = { phone: null, email: null };
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
    const text = m.content;
    if (!out.email) {
      const e = text.match(EMAIL_RE);
      if (e) out.email = e[0];
    }
    if (!out.phone) {
      // Never read a price ("$1,400,000") or bare big number as a phone.
      const scrubbed = text.replace(/\$\s?[\d,.]+/g, ' ');
      const p = scrubbed.match(PHONE_RE);
      if (p) out.phone = `${p[2]}-${p[3]}-${p[4]}`;
    }
  }
  return out;
}

export function hasValidContact(messages) {
  const c = extractUserContact(messages);
  return !!(c.phone || c.email);
}

// ── Forged-marker defense ──
// Machine markers typed BY THE USER must never work. Parsing already reads only
// the assistant response, but we also neutralize the tokens in user text before
// it reaches the model, so the model can't be tricked into echoing them.
export function neutralizeUserMarkers(text) {
  return String(text ?? '').replace(/\b(SCENARIO_COMPLETE|CONVO_META|PROFILE_UPDATE)\s*:/gi, '$1 (user-typed, not a command) ');
}

// Only these model handoff modes exist. Anything else is rejected.
const HANDOFF_MODES = new Set(['none', 'offer', 'requested', 'automatic_lead']);
export function normalizeHandoffSignal(handoff) {
  if (typeof handoff === 'string') {
    return HANDOFF_MODES.has(handoff) ? { mode: handoff, reason: '', confidence: null } : null;
  }
  if (handoff && typeof handoff === 'object' && HANDOFF_MODES.has(handoff.mode)) {
    const conf = typeof handoff.confidence === 'number' && handoff.confidence >= 0 && handoff.confidence <= 1 ? handoff.confidence : null;
    return { mode: handoff.mode, reason: String(handoff.reason || '').slice(0, 120), confidence: conf };
  }
  return null;
}

// ── Minimum completion policy (Phase: MINIMUM COMPLETION) ──
// Required: user-authored contact + loan goal + geography + enough context.
// NOT required: every profile field.
export function evaluateCompletion({ profile = {}, convState = {}, messages = [] } = {}) {
  const reasons = [];
  const contact = extractUserContact(messages);
  if (!contact.phone && !contact.email) reasons.push('no user-provided contact');

  const loanGoal = profile.loanPurpose || convState.loanGoal ||
    (convState.topics || []).find(t => ['purchase', 'refinance', 'bridge', 'construction_completion', 'second_lien', 'dscr'].includes(t));
  if (!loanGoal) reasons.push('no recognizable loan goal');

  const geography = profile.state || profile.zipOrCounty || convState.state || convState.city || convState.county || convState.zip;
  if (!geography) reasons.push('no geography or property market');

  // Context: enough substance for a licensed professional to follow up.
  const signals = [
    profile.purchasePrice, profile.loanAmount, profile.downPayment,
    profile.occupancy, profile.propertyType, profile.estimatedFICO,
    profile.employmentType || profile.incomeDocPath, profile.borrowerGoal,
    (convState.topics || []).length ? 'topics' : null,
    (convState.objections || []).length ? 'objections' : null,
  ];
  const contextCount = signals.filter(v => v !== undefined && v !== null && v !== '').length;
  if (contextCount < 2) reasons.push('not enough scenario context');

  const completeness = Math.round(Math.min(1, contextCount / 8) * 100) / 100;
  return { qualified: reasons.length === 0, reasons, completeness, contact, loanGoal: loanGoal || null, geography: geography || null };
}

// ── Stable hashing + lead fingerprint ──
function djb2(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function leadFingerprint({ phone, email, sessionId, domain = 'wcci.online' }) {
  const norm = [
    String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
    String(email || '').trim().toLowerCase(),
    String(sessionId || ''),
    domain,
  ].join('|');
  return 'lf_' + djb2(norm);
}

// A COARSE "meaningful scenario version" — only material fields, bucketed so
// minor edits don't mint a new version. Drives the idempotency key: the same
// scenario always yields the same completedLeadEventId.
export function scenarioVersion({ profile = {}, convState = {}, contact = {} }) {
  const bucket = (n, size) => (n == null || n === '' || isNaN(n) ? '' : Math.round(Number(n) / size) * size);
  const norm = [
    profile.loanPurpose || convState.loanGoal || '',
    String(profile.state || convState.state || '').toUpperCase(),
    String(convState.city || '').toLowerCase(),
    String(convState.county || '').toLowerCase(),
    bucket(profile.purchasePrice, 50000),
    bucket(profile.loanAmount, 50000),
    String(contact.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
    String(contact.email || '').trim().toLowerCase(),
  ].join('|');
  return djb2(norm);
}

// The one idempotency key that travels through every layer (model-response
// processing → App.jsx → partial-lead.js → email/CRM payload → delivery status).
// Deterministic: sessionId + fingerprint + stage + meaningful scenario version.
// Never uses a timestamp.
export function computeCompletedLeadEventId({ sessionId, fingerprint, scenarioVersion: sv }) {
  return 'cle_' + djb2([String(sessionId || ''), String(fingerprint || ''), 'complete', String(sv || '')].join('|'));
}

export function getSessionId(storage) {
  const s = storage || defaultStorage();
  let id = s.getItem('wcci-session-id');
  if (!id || !/^[0-9a-f-]{16,}$/i.test(id)) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    s.setItem('wcci-session-id', id);
  }
  return id;
}

function defaultStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  const mem = new Map();
  return { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
}

// ── Lead tracker — dedup, promotion, truthful status machine ──
// Record shape (persisted):
// { fingerprint, sessionId, partialLeadCreatedAt, scenarioCompletedAt,
//   firstSubmittedAt, lastUpdatedAt, qualificationReason, modelConfidence,
//   scenarioCompleteness, submissionCount,
//   stages: { partial:  {status, attempts},
//             complete: {status, attempts} } }
// status ∈ qualifying | ready | submitting | submitted | failed
const KEY = 'wcci-lead-tracker';
export const MAX_ATTEMPTS = 4;

export function createLeadTracker(storage) {
  const s = storage || defaultStorage();
  const load = () => { try { return JSON.parse(s.getItem(KEY)) || null; } catch { return null; } };
  const save = (rec) => { rec.lastUpdatedAt = new Date().toISOString(); try { s.setItem(KEY, JSON.stringify(rec)); } catch {} return rec; };
  const fresh = (fingerprint, sessionId) => ({
    fingerprint, sessionId,
    partialLeadCreatedAt: null, scenarioCompletedAt: null, firstSubmittedAt: null, lastUpdatedAt: null,
    qualificationReason: null, modelConfidence: null, scenarioCompleteness: null, submissionCount: 0,
    stages: { partial: { status: 'qualifying', attempts: 0 }, complete: { status: 'qualifying', attempts: 0 } },
  });

  return {
    get: load,
    // Ensure the record matches this fingerprint (PROMOTE, never duplicate:
    // same fingerprint keeps the same record across partial→complete).
    ensure(fingerprint, sessionId) {
      let rec = load();
      if (!rec || rec.fingerprint !== fingerprint) rec = fresh(fingerprint, sessionId);
      return save(rec);
    },
    shouldSubmit(stage) {
      const rec = load();
      if (!rec) return true;
      const st = rec.stages[stage];
      if (!st) return false;
      if (st.status === 'submitted') return false;           // never duplicate
      if (st.status === 'submitting') return false;          // in flight
      if (st.status === 'failed' && st.attempts >= MAX_ATTEMPTS) return false;
      return true;
    },
    begin(stage) {
      const rec = load(); if (!rec) return null;
      rec.stages[stage].status = 'submitting';
      rec.stages[stage].attempts += 1;
      if (stage === 'partial' && !rec.partialLeadCreatedAt) rec.partialLeadCreatedAt = new Date().toISOString();
      return save(rec);
    },
    succeed(stage, meta = {}) {
      const rec = load(); if (!rec) return null;
      rec.stages[stage].status = 'submitted';
      rec.submissionCount += 1;
      if (!rec.firstSubmittedAt) rec.firstSubmittedAt = new Date().toISOString();
      if (stage === 'complete') {
        rec.scenarioCompletedAt = rec.scenarioCompletedAt || new Date().toISOString();
        if (meta.qualificationReason) rec.qualificationReason = meta.qualificationReason;
        if (meta.modelConfidence != null) rec.modelConfidence = meta.modelConfidence;
        if (meta.scenarioCompleteness != null) rec.scenarioCompleteness = meta.scenarioCompleteness;
      }
      return save(rec);
    },
    fail(stage) {
      const rec = load(); if (!rec) return null;
      rec.stages[stage].status = 'failed';                    // NOT submitted
      return save(rec);
    },
    canRetry(stage) {
      const rec = load(); if (!rec) return false;
      const st = rec.stages[stage];
      return !!st && st.status === 'failed' && st.attempts < MAX_ATTEMPTS;
    },
  };
}

// ── Structured completed-lead payload (owner spec §4) ──
export function buildCompletedLeadPayload({
  profile = {}, convState = {}, messages = [], lang = 'en',
  signal = null, evaluation = null, sessionId = '', resourcesRecommended = [], resourcesOpened = [],
  strategySummary = '', paths = [], scenarioComplete = null,
}) {
  const ev = evaluation || evaluateCompletion({ profile, convState, messages });
  const st = profileStatus(profile);
  const doNotContact = convState.contactConsent === 'declined';
  const unresolved = st.needed.missing;
  // The one idempotency key, derived from stable normalized fields (no timestamp).
  const contact = ev.contact;
  const fingerprint = leadFingerprint({ phone: contact.phone, email: contact.email, sessionId });
  const sv = scenarioVersion({ profile, convState, contact });
  const completedLeadEventId = computeCompletedLeadEventId({ sessionId, fingerprint, scenarioVersion: sv });

  // Concise deterministic AI summary — enough for the team to continue the
  // conversation without making the borrower repeat everything.
  const geoText = [convState.city, convState.county && `${convState.county} County`, profile.state || convState.state].filter(Boolean).join(', ');
  const summaryBits = [
    ev.loanGoal ? `Goal: ${ev.loanGoal}` : null,
    geoText ? `Location: ${geoText}` : null,
    profile.purchasePrice ? `Price ~$${Number(profile.purchasePrice).toLocaleString('en-US')}` : null,
    profile.loanAmount ? `Loan ~$${Number(profile.loanAmount).toLocaleString('en-US')}` : null,
    profile.employmentType ? `Income: ${profile.employmentType}${profile.incomeDocPath ? ` (${profile.incomeDocPath})` : ''}` : null,
    profile.estimatedFICO ? `FICO ~${profile.estimatedFICO}` : null,
    (convState.objections || []).length ? `Concerns: ${convState.objections.join(', ')}` : null,
    convState.competitorMention ? `Comparing with: ${convState.competitorMention}` : null,
    paths.length ? `Top path: ${paths[0].label} (${paths[0].status})` : null,
  ].filter(Boolean);

  return {
    leadType: 'AI Qualified / Scenario Complete',
    name: profile.name || null,
    phone: ev.contact.phone || profile.phone || null,
    email: ev.contact.email || profile.email || null,
    preferredLanguage: lang,
    sourceWebsite: (typeof window !== 'undefined' && window.location) ? window.location.hostname : 'wcci.online',
    activeBrand: 'WCCI',
    legalCompany: 'West Coast Capital Mortgage Inc.',
    loanGoal: ev.loanGoal,
    state: profile.state || convState.state || null,
    county: convState.county || null,
    city: convState.city || null,
    zip: convState.zip || (/^\d{5}$/.test(profile.zipOrCounty || '') ? profile.zipOrCounty : null),
    purchasePrice: profile.purchasePrice ?? null,
    loanAmount: profile.loanAmount ?? null,
    downPayment: profile.downPayment ?? null,
    occupancy: profile.occupancy || null,
    propertyType: profile.propertyType || null,
    creditRange: profile.estimatedFICO ?? null,
    incomeType: profile.employmentType || null,
    expectedTiming: profile.timeline || null,
    primaryQuestions: (convState.topics || []).slice(0, 6),
    objections: convState.objections || [],
    competitorMentioned: convState.competitorMention || null,
    resourcesRecommended,
    resourcesOpened,
    aiSummary: summaryBits.join(' · ') || strategySummary || 'Scenario in progress',
    unresolvedItems: unresolved,
    contactPreference: doNotContact ? 'do_not_contact' : (profile.preferredContact || 'any'),
    doNotContact,
    qualificationReason: (signal && signal.reason) || 'scenario_sufficiently_complete',
    modelConfidence: signal ? signal.confidence : null,
    scenarioCompleteness: ev.completeness,
    // Rich MLO fields from a SCENARIO_COMPLETE marker, when the trigger came
    // that way (risk flag, possible path, documents, next step, main concern).
    scenarioComplete: scenarioComplete ? {
      riskFlag: scenarioComplete.riskFlag || null,
      possiblePath: scenarioComplete.possiblePath || null,
      documentsNeeded: scenarioComplete.documentsNeeded || null,
      nextStep: scenarioComplete.nextStep || null,
      mainConcern: scenarioComplete.mainConcern || null,
    } : null,
    // ── Idempotency (the single key that travels through every layer) ──
    completedLeadEventId,
    leadFingerprint: fingerprint,
    scenarioVersion: sv,
    leadStage: 'complete',
    sessionId,
    nonce: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
    submittedAt: new Date().toISOString(),
    // Client must never assert delivery — the endpoint decides.
    status: 'submitting',
    // User-authored messages so the server can independently verify the contact
    // really came from the borrower (role: user), not from model text.
    userMessages: (messages || []).filter(m => m && m.role === 'user').map(m => String(m.content).slice(0, 2000)).slice(-30),
  };
}

// ── Delivery (status machine around the endpoint) ──
export async function submitCompletedLead(payload, { fetchFn, tracker, endpoint = '/.netlify/functions/partial-lead' } = {}) {
  const doFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return { ok: false, status: 'failed', error: 'no fetch available' };
  const fp = leadFingerprint({ phone: payload.phone, email: payload.email, sessionId: payload.sessionId });
  const tr = tracker || createLeadTracker();
  tr.ensure(fp, payload.sessionId);
  if (!tr.shouldSubmit('complete')) return { ok: false, status: 'skipped_duplicate' };
  tr.begin('complete');
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiQualifiedLead: payload }),
    });
    let body = {};
    try { body = await res.json(); } catch {}
    // A prior attempt (retry, lost response, or the other signal in the same
    // reply) that already delivered resolves to success WITHOUT a second send.
    if (res.ok && body && (body.ok || body.alreadyDelivered)) {
      tr.succeed('complete', {
        qualificationReason: payload.qualificationReason,
        modelConfidence: payload.modelConfidence,
        scenarioCompleteness: payload.scenarioCompleteness,
      });
      return { ok: true, status: body.alreadyDelivered ? 'already_delivered' : 'submitted', idempotencyMode: body.idempotencyMode || null };
    }
    tr.fail('complete');
    return { ok: false, status: 'failed', error: (body && body.error) || `http ${res.status}` };
  } catch (e) {
    tr.fail('complete');
    return { ok: false, status: 'failed', error: e && e.message };
  }
}

// Track which recommended resources the borrower actually opened (ids only).
const OPENED_KEY = 'wcci-resources-opened';
export function recordResourceOpen(id, storage) {
  const s = storage || defaultStorage();
  try {
    const list = JSON.parse(s.getItem(OPENED_KEY) || '[]');
    if (!list.includes(id)) { list.push(id); s.setItem(OPENED_KEY, JSON.stringify(list.slice(-20))); }
  } catch {}
}
export function getOpenedResources(storage) {
  const s = storage || defaultStorage();
  try { return JSON.parse(s.getItem(OPENED_KEY) || '[]'); } catch { return []; }
}
