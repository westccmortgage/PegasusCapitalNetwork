// Deterministic resource-routing engine (runs BEFORE any LLM reranking).
//
// Input: the conversation state (geography, topics, objections, stage,
// audience, loan facts). Output: 0–5 scored candidate resources with reason
// keys. The model may then pick 0–3 of these by ID — it can never introduce a
// resource the router didn't offer, and the validator enforces that.
//
// Routing order (spec):
//   1. safety / legal eligibility   → hard gates, exclusions, audience
//   2. trust or privacy concern     → trust bundle
//   3. geography                    → city > county > state
//   4. loan topic                   → topic overlap
//   5. borrower type                → audience fit
//   6. conversation stage           → stage fit
//   7. tone preference              → plain-english boost
//   8. handoff readiness            → secure application gating
// A hard exclusion or audience mismatch overrides every positive score.

import { allResources } from './site-registry.js';
import { audienceAllowed, isUrlAllowed } from './resource-validator.js';
import { isSupportedState } from '../../config/companyFacts.js';
import { classifyLoanSize } from '../../config/conformingLimits.js';

const TRUST_OBJECTIONS = ['identity', 'licensing', 'privacy', 'company_background'];

// Broad educational / state-brand categories that must NOT interrupt an active
// data-gathering conversation (discovery / profile_building / clarification /
// calculation) unless the user asked, a tool is needed, or it is trust/licensing.
const BROAD_EDU_CATEGORIES = new Set(['mortgage_education', 'state_mortgage']);

// Topics tied to the conforming-vs-jumbo question (used for resolution cleanup).
export const JUMBO_TOPICS = ['jumbo', 'conforming', 'county_limit', 'high_balance'];

// Where a recommended resource should render — inline (directly answers the
// current message) vs. sidebar (passive next-step). A given resource lands in
// exactly ONE place so it is never duplicated across both surfaces.
const INLINE_REASONS = new Set(['trust', 'licensing', 'privacy', 'topic', 'apply',
  'private_capital', 'investor', 'tokenization', 'network', 'development', 'professional_tool']);
export function placementFor(reasonKey) {
  return INLINE_REASONS.has(reasonKey) ? 'inline' : 'sidebar';
}

// BeforeJumboLoan is materially useful ONLY in specific cases. It is NOT a
// generic "large loan / California / used the word conforming" recommendation,
// and once the classification is resolved as conforming it is suppressed.
export function beforeJumboEligible(ctx = {}, size = null) {
  const t = ctx.topics || [];
  const s = size || classifyLoanSize({ loanAmount: ctx.loanAmount, units: ctx.units });
  const resolved = new Set(ctx.resolvedTopics || []);
  const topicRaised = JUMBO_TOPICS.some(x => t.includes(x));
  const wantsStructure = ctx.wantsStructureCompare || t.includes('buydown') || t.includes('interest_only') || t.includes('points');
  const explicitCompare = !!ctx.explicitResourceRequest && topicRaised;

  // Resolved as conforming → suppress unless they now want a structure comparison.
  if (resolved.has('jumbo') || resolved.has('conforming')) return wantsStructure;
  // KNOWN conforming by loan size → not jumbo by size; only structure/explicit keeps it.
  if (s.conformingBySize) return wantsStructure || explicitCompare;
  // KNOWN jumbo by loan size.
  if (s.jumboBySize) return true;
  // Loan size UNKNOWN → genuine jumbo uncertainty (topic) or a structure ask.
  return topicRaised || wantsStructure;
}

// Cities/counties gates: these local brands may ONLY appear on a real
// geography match — never as generic state fallbacks.
const GEO_GATED = new Set([
  'kwest-home', 'kwest-about', 'kwest-scenario-studio', 'kwest-disclosures',
  'belair-home', 'lunadabay-home',
]);

// Resources that exist purely to answer trust questions: only offered when a
// trust concern (or explicit trust stage) is actually present.
const TRUST_ONLY = new Set(['wccm-about', 'wccm-home', 'nmls-consumer-access', 'suncoast-about', 'kwest-about', 'californiamtg-about', 'kwest-disclosures', 'californiardp-home', 'wccm-contact']);

// Specialty resources that require their explicit topic to ever appear.
const TOPIC_GATED = {
  'privatenotecapital-home': ['notes_investing', 'trust_deed', 'first_lien', 'private_credit', 'interest_income'],
  'pegasusprivate-home': ['tokenization', 'digital_assets', 'rwa', 'kyc_aml', 'digital_ownership'],
  'pegasuscapital-home': ['capital_network', 'deal_rooms', 'fund', 'introductions'],
  'grcrm-home': ['crm', 'pipeline', 'lead_management'],
  'cadeed-home': ['bridge', 'fix_and_flip', 'construction', 'construction_completion', 'ground_up', 'second_lien', 'business_purpose', 'private_money', 'bank_decline'],
  'californiardp-home': ['development', 'construction_experience', 'portfolio'],
  'ourmtg-portal': ['apply', 'documents', 'loan_status'],
};

function geoMatch(resource, ctx) {
  const city = (ctx.city || '').toLowerCase();
  const county = (ctx.county || '').toLowerCase().replace(/\s*county$/, '');
  const st = (ctx.state || '').toUpperCase();
  if (city && (resource.cities || []).some(c => city.includes(c) || c.includes(city))) return 'city';
  if (county && (resource.counties || []).some(c => c === county)) return 'county';
  if (st && (resource.states || []).includes(st)) return 'state';
  return null;
}

/**
 * @param {Object} ctx conversation context
 *  { audience, state, county, city, topics: string[], objections: string[],
 *    stage, loanAmount, wantsApply, tonePreference }
 * @returns {{candidates: Array<{id, score, reasonKey}>, handoffAppropriate: boolean}}
 */
export function routeResources(ctx = {}) {
  const audience = ctx.audience || 'consumer_borrower';
  const topics = ctx.topics || [];
  const objections = ctx.objections || [];
  const hasTrustConcern = objections.some(o => TRUST_OBJECTIONS.includes(o)) || ctx.stage === 'trust_building';
  const wantsDevProof = topics.includes('development') || topics.includes('construction_experience');
  // Stage/eligibility gating inputs.
  const size = classifyLoanSize({ loanAmount: ctx.loanAmount, units: ctx.units });
  const dataGathering = !!ctx.dataGathering;              // still collecting core scenario fields
  const explicitReq = !!ctx.explicitResourceRequest;      // user explicitly asked for a link/resource
  const wantsCalculator = !!ctx.wantsCalculator;
  const wantsCaliforniaResources = !!ctx.wantsCaliforniaResources;
  const scored = [];

  for (const r of allResources()) {
    // 1. Safety & eligibility gates (override everything).
    if (!r.verified || !r.autoRoute) continue;
    if (!audienceAllowed(r, audience)) continue;
    if (!isUrlAllowed(r.canonicalUrl)) continue;

    const geo = geoMatch(r, ctx);

    // Locality-gated brands need a genuine local match — Boca Raton must never
    // see K West just because both are Florida.
    if (GEO_GATED.has(r.id) && geo !== 'city' && geo !== 'county') continue;

    // Wrong-state hard gate: a state-scoped resource never shows for a
    // borrower known to be elsewhere.
    if (ctx.state && r.states && r.states.length && !r.states.includes(String(ctx.state).toUpperCase())) continue;

    // Topic-gated specialty resources require their explicit topic.
    const gate = TOPIC_GATED[r.id];
    if (gate && !gate.some(t => topics.includes(t))) continue;

    // A privacy policy is only a useful recommendation when privacy is the concern.
    if (r.id === 'californiamtg-privacy' && !objections.includes('privacy')) continue;

    // ── Conforming-threshold correction: BeforeJumboLoan materiality gate ──
    // Never recommend it merely because a loan is "large" or in CA; suppress it
    // once the loan is known conforming by size or the question is resolved.
    if (r.id === 'beforejumbo-home' && !beforeJumboEligible(ctx, size)) continue;

    // ── CaliforniaMTG must not appear merely because state = CA, and not while
    // still collecting core fields unless the user explicitly asked or a tool /
    // completed scenario / trust context makes it material.
    if (r.id === 'californiamtg-home') {
      const material = explicitReq || wantsCaliforniaResources || wantsCalculator ||
        ctx.stage === 'strategy_complete' || ctx.stage === 'human_review_ready' || ctx.stage === 'handoff_requested' ||
        hasTrustConcern;
      if (dataGathering && !material) continue;
    }

    // ── Stage gate: don't interrupt active data-gathering with broad education /
    // state-brand resources. Exempt: explicit request, trust/licensing, a needed
    // calculator/tool, and BeforeJumboLoan (which already passed its own
    // materiality gate for the current jumbo question).
    if (dataGathering && BROAD_EDU_CATEGORIES.has(r.category) && r.id !== 'beforejumbo-home') {
      const allow = explicitReq || hasTrustConcern || wantsCalculator ||
        (r.topics || []).includes('calculator') || wantsCaliforniaResources;
      if (!allow) continue;
    }

    // Orange Mortgage is the friendly-education brand for Orange County and
    // first-time/plain-English borrowers — never a generic fallback elsewhere
    // ("No Orange County assumption" for other markets).
    if (r.id === 'orange-home' || r.id === 'orange-about') {
      const ocMatch = geo === 'city' || geo === 'county';
      const toneMatch = ctx.tonePreference === 'plain_english' ||
        topics.includes('first_time_buyer') || topics.includes('plain_english') || topics.includes('calculator');
      if (!ocMatch && !toneMatch) continue;
    }

    // Trust-only resources require an actual trust concern (or dev-proof ask).
    if (TRUST_ONLY.has(r.id)) {
      if (r.id === 'californiardp-home') { if (!wantsDevProof && !objections.includes('development')) continue; }
      else if (r.id === 'wccm-contact') { if (!hasTrustConcern && !ctx.wantsApply && ctx.stage !== 'human_review_ready' && ctx.stage !== 'handoff_requested') continue; }
      else if (!hasTrustConcern) continue;
    }

    // Secure application only with real readiness — and only supported states.
    if (r.category === 'secure_application') {
      const ready = ctx.wantsApply || ctx.stage === 'handoff_requested' || ctx.stage === 'human_review_ready';
      if (!ready) continue;
      if (ctx.state && !isSupportedState(ctx.state)) continue;
    }

    // 2–8. Scoring.
    let score = 0;
    let reasonKey = 'education';

    // Trust / privacy concern (routing priority 2).
    const trustHits = (r.trustIntents || []).filter(ti =>
      objections.includes(ti) ||
      (ti === 'identity' && objections.includes('ai_skepticism')) ||
      (ti === 'company_background' && objections.includes('identity'))).length;
    if (hasTrustConcern && trustHits) { score += 50 + 10 * trustHits; reasonKey = 'trust'; }
    if (objections.includes('licensing') && (r.trustIntents || []).includes('licensing')) { score += 15; reasonKey = 'licensing'; }
    if (objections.includes('privacy') && (r.trustIntents || []).includes('privacy')) { score += 20; reasonKey = 'privacy'; }

    // Geography (routing priority 3).
    if (geo === 'city') { score += 40; if (reasonKey === 'education') reasonKey = 'local_market'; }
    else if (geo === 'county') { score += 30; if (reasonKey === 'education') reasonKey = 'local_market'; }
    else if (geo === 'state') { score += 15; }
    // Trust + matching geography beats generic corporate trust (FL identity → Suncoast first).
    if (hasTrustConcern && trustHits && (geo === 'state' || geo === 'city' || geo === 'county')) score += 12;
    // State-specialist bonus: a brand dedicated to exactly the borrower's state
    // outranks multi-state corporate pages — but ONLY on a city/county match, so
    // a bare state match can never clear the bar on geography alone.
    if ((geo === 'city' || geo === 'county') && r.states && r.states.length === 1) score += 10;
    // Explicit "show me California resources" surfaces the CA state brand.
    if (wantsCaliforniaResources && r.category === 'state_mortgage' && geo) { score += 30; if (reasonKey === 'education') reasonKey = 'local_market'; }

    // Loan topic (routing priority 4).
    const topicHits = (r.topics || []).filter(t => topics.includes(t)).length;
    score += Math.min(topicHits, 3) * 12;
    if (topicHits && reasonKey === 'education') reasonKey = 'topic';

    // Borrower type / specialty categories (routing priority 5).
    if (r.category === 'private_real_estate_capital' && topicHits) { score += 25; reasonKey = 'private_capital'; }
    if (r.category === 'investor_capital' && topicHits) { score += 40; reasonKey = 'investor'; }
    if (r.category === 'digital_assets' && topicHits) { score += 40; reasonKey = 'tokenization'; }
    if (r.category === 'professional_network' && topicHits) { score += 35; reasonKey = 'network'; }
    if (r.category === 'development_proof' && wantsDevProof) { score += 45; reasonKey = 'development'; }
    if (r.category === 'internal_platform' && topicHits) { score += 30; reasonKey = 'professional_tool'; }

    // Conversation stage (6) + tone (7).
    if ((r.stages || []).includes(ctx.stage)) score += 8;
    if (ctx.tonePreference === 'plain_english' && (r.topics || []).includes('plain_english')) score += 18;
    if (topics.includes('first_time_buyer') && (r.topics || []).includes('first_time_buyer')) score += 15;

    // Handoff readiness (8).
    if (r.category === 'secure_application') { score += 30; reasonKey = 'apply'; }

    // Registry priority as a gentle tiebreaker.
    score += (r.priority || 0) / 10;

    // STATE MATCH ALONE IS NEVER SUFFICIENT. If geography is the only positive
    // signal (bare state, no city/county, topic, trust, tone, or specialty), the
    // resource is excluded unless the user explicitly asked for it.
    const nonGeoSignal = topicHits > 0 || trustHits > 0 || geo === 'city' || geo === 'county' ||
      (ctx.tonePreference === 'plain_english' && (r.topics || []).includes('plain_english')) ||
      (topics.includes('first_time_buyer') && (r.topics || []).includes('first_time_buyer')) ||
      r.category === 'secure_application';
    if (geo === 'state' && !nonGeoSignal && !explicitReq && !wantsCaliforniaResources) continue;

    if (score >= 20) scored.push({ id: r.id, score: Math.round(score * 10) / 10, reasonKey });
  }

  scored.sort((a, b) => b.score - a.score);

  // Generic-education trim: resources that matched on nothing specific only
  // pad the list when there are fewer than two signal-bearing candidates.
  const signalCount = scored.filter(c => c.reasonKey !== 'education').length;

  // Diversity: at most 2 resources per domain in the candidate set.
  const perDomain = new Map();
  const candidates = [];
  let educationKept = 0;
  for (const c of scored) {
    if (c.reasonKey === 'education' && signalCount >= 2) continue;
    if (c.reasonKey === 'education' && ++educationKept > 3) continue;
    const dom = allResources().find(r => r.id === c.id).domain;
    const n = perDomain.get(dom) || 0;
    if (n >= 2) continue;
    perDomain.set(dom, n + 1);
    candidates.push(c);
    if (candidates.length >= 5) break;
  }

  const handoffAppropriate = !!(ctx.wantsApply || ctx.stage === 'human_review_ready' || ctx.stage === 'handoff_requested');
  return { candidates, handoffAppropriate };
}

// Router-side localized fallback reasons (used when the model gives none).
const REASONS = {
  trust: { en: 'Company information you can verify yourself.', es: 'Información de la compañía que usted puede verificar.', ru: 'Информация о компании, которую можно проверить самостоятельно.' },
  licensing: { en: 'Official licensing verification.', es: 'Verificación oficial de licencias.', ru: 'Официальная проверка лицензий.' },
  privacy: { en: 'How your information is handled.', es: 'Cómo se maneja su información.', ru: 'Как обрабатываются ваши данные.' },
  local_market: { en: 'Local guidance for your specific market.', es: 'Orientación local para su mercado específico.', ru: 'Локальная информация именно по вашему рынку.' },
  topic: { en: 'Directly relevant to what you asked about.', es: 'Directamente relevante a su pregunta.', ru: 'Напрямую относится к вашему вопросу.' },
  education: { en: 'Helpful background for your scenario.', es: 'Contexto útil para su escenario.', ru: 'Полезный контекст для вашего сценария.' },
  private_capital: { en: 'Private, non-bank financing for this kind of scenario.', es: 'Financiamiento privado no bancario para este tipo de escenario.', ru: 'Частное небанковское финансирование для такого сценария.' },
  investor: { en: 'Investor-side information (not a borrower application).', es: 'Información para inversionistas (no es una solicitud de préstamo).', ru: 'Информация для инвесторов (не заявка на кредит).' },
  tokenization: { en: 'Education on tokenized real-asset ownership.', es: 'Educación sobre propiedad tokenizada de activos reales.', ru: 'Обучение токенизированному владению реальными активами.' },
  network: { en: 'Professional capital-network resource.', es: 'Recurso de red profesional de capital.', ru: 'Ресурс профессиональной сети капитала.' },
  development: { en: 'Real development track record behind the team.', es: 'Historial real de desarrollo del equipo.', ru: 'Реальный девелоперский опыт команды.' },
  professional_tool: { en: 'Platform for mortgage and real-estate professionals.', es: 'Plataforma para profesionales hipotecarios e inmobiliarios.', ru: 'Платформа для ипотечных и риелторских специалистов.' },
  apply: { en: 'The secure portal for when you are ready to apply.', es: 'El portal seguro para cuando esté listo para aplicar.', ru: 'Защищённый портал — когда будете готовы подать заявку.' },
};

export function fallbackReason(reasonKey, lang = 'en') {
  const r = REASONS[reasonKey] || REASONS.education;
  return r[lang] || r.en;
}
