import React, { useState, useEffect, useRef } from 'react';
import { SYSTEM_PROMPT, langDirective, localeFor } from './systemPrompt.js';
import { T, LANGS, LANG_LABELS, LANG_NATIVE, DISCLAIMER, STRATEGY_DISCLAIMER, strategyUI, UPLOAD_UI, RESOURCE_UI, CONTACT_UI, LICENSE_FOOTER, COMPANY_NAME, COMPANY_LICENSE, BROKER_NAME, BROKER_TITLE, BROKER_LICENSE, COMPANY_NMLS, COMPANY_DRE, BROKER_NMLS, BROKER_DRE, OFFICE_PHONE, OFFICE_PHONE_HREF, DIRECT_PHONE, DIRECT_PHONE_HREF, COMPANY_EMAIL, COMPANY_EMAIL_HREF, PRIMARY_WEBSITES, getInitialMessage } from './i18n.js';
import { shouldSendOnEnter } from './lib/imeSend.js';

// Shared font stack — includes Simplified Chinese system faces so zh-CN renders
// crisply without shipping font files. Never uppercase or letter-space Chinese.
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', 'Noto Sans SC', sans-serif";

// Standard verification destination (public regulator) — safe for "Verify Licensing".
const NMLS_CONSUMER_ACCESS = 'https://www.nmlsconsumeraccess.org/';
// Owner-approved corporate site (for "Meet the Broker").
const COMPANY_FACTS_PRIMARY = PRIMARY_WEBSITES[0];

// WCCI brand mark — a bronze "W" drawn as rooftop peaks in a warm ivory tile
// (premium mortgage/capital tone). Pure SVG so it scales from favicon to drawer.
function BrandMark({ size = 34, title = 'WCCI' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}>
      <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="10" fill="#ffffff" stroke="#171717" strokeWidth="1.7" />
      <path d="M9 12.5 L14.5 27.5 L20 18 L25.5 27.5 L31 12.5" fill="none"
        stroke="#171717" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M20 18 L25.5 27.5 L31 12.5" fill="none"
        stroke="#141414" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
import { parseScenario } from './lib/parser.js';
import { mergeProfile, profileStatus } from './lib/scenarioProfile.js';
import { evaluatePaths } from './lib/strategyEngine.js';
import { buildLead, submitLead } from './lib/leadAdapter.js';
import { initialConversationState, updateStateFromUserMessage, applyStatePatch, grantContactConsent, buildIntelContext, detectResourceIntents } from './lib/conversationIntelligence.js';
import { neutralizeUserMarkers, hasValidContact, extractUserContact, normalizeHandoffSignal, evaluateCompletion, buildCompletedLeadPayload, submitCompletedLead, createLeadTracker, leadFingerprint, getSessionId, getOpenedResources } from './lib/leadPipeline.js';
import { routeResources, fallbackReason, placementFor, JUMBO_TOPICS } from './lib/resources/resource-router.js';
import { classifyLoanSize, CONFORMING_YEAR } from './config/conformingLimits.js';
import { validateRecommendations } from './lib/resources/resource-validator.js';
import { getResource } from './lib/resources/site-registry.js';
import { track } from './lib/analytics.js';
import StrategyProfile from './StrategyProfile.jsx';
import ManualForm from './ManualForm.jsx';
import { ResourceCardList } from './ResourceCard.jsx';

function loadSession() {
  try {
    const raw = localStorage.getItem('wcci-session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.messages) || !s.messages.length) return null;
    return s;
  } catch { return null; }
}

function buildDocumentChecklist(scenario) {
  const s = scenario || {};
  const income = (s.incomeType || '').toLowerCase();
  const purpose = (s.loanPurpose || '').toLowerCase();
  const concern = (s.concern || '').toLowerCase();
  const occupancy = (s.occupancy || '').toLowerCase();
  const buckets = [];

  const needsBankStmt = concern.includes('bank statement') || concern.includes('tax returns too low');
  const isInvestor = purpose.includes('investment') || occupancy.includes('investment') || income.includes('investor') || concern.includes('dscr');
  const isSelfEmp = income.includes('self-employed') || income.includes('1099') || income.includes('business owner') || income.includes('commission');
  const isW2 = income.includes('w-2') || income.includes('w2');
  const isRefi = purpose.includes('refinance') || purpose.includes('cash-out');

  if (needsBankStmt) {
    buckets.push({ label: 'Bank statement / non-QM', items: [
      '12 or 24 months personal or business bank statements',
      'Business verification (license, CPA letter, or website)',
      'Government-issued ID',
      'Asset statements (savings, retirement, reserves)',
    ]});
  } else if (isInvestor) {
    buckets.push({ label: 'DSCR / investor', items: [
      'Lease agreement or market rent estimate',
      'Property expenses (insurance, taxes, HOA estimate)',
      'Entity documents if applicable (LLC, trust)',
      'Asset statements',
      'Government-issued ID',
    ]});
  } else if (isSelfEmp) {
    buckets.push({ label: 'Self-employed / business owner', items: [
      'Last 2 years personal tax returns',
      'Business tax returns if applicable',
      'Year-to-date profit and loss statement',
      'Business bank statements',
      'Government-issued ID',
      'Asset statements',
    ]});
  } else if (isW2) {
    buckets.push({ label: 'W-2 borrower', items: [
      'Recent paystubs (last 30 days)',
      'Last 2 years W-2s',
      'Government-issued ID',
      'Recent bank statements',
      'Purchase contract if available',
    ]});
  } else {
    buckets.push({ label: 'Standard starting list', items: [
      'Government-issued ID',
      'Recent paystubs or income documentation',
      'Last 2 years tax returns',
      'Recent bank and asset statements',
    ]});
  }

  if (isRefi) {
    buckets.push({ label: 'Refinance', items: [
      'Current mortgage statement',
      'Homeowners insurance declaration page',
      'Property tax bill',
      'Payoff statement if available',
      'HELOC or second mortgage statement if applicable',
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
  return { primaryLabel: buckets.map(b => b.label).join(' + '), items };
}

const money0 = (n) => (n == null || isNaN(n)) ? null : '$' + Math.round(Number(n)).toLocaleString('en-US');

// Extract a `MARKER:{...}` machine line from an AI reply using string-aware
// balanced-brace scanning (regex can't match nested braces, and CONVO_META
// always nests state:{...} / resources:[{...}]). Returns { obj, cleaned } where
// `cleaned` is the visible text with the marker + its JSON removed — so a
// machine line can never leak into the chat bubble even if its JSON is invalid.
function extractMarker(text, marker) {
  const tag = marker + ':';
  const idx = text.indexOf(tag);
  if (idx === -1) return null;
  const braceStart = text.indexOf('{', idx);
  if (braceStart === -1) {
    // Marker present but no JSON — still strip the marker token itself.
    return { obj: null, cleaned: (text.slice(0, idx) + text.slice(idx + tag.length)).trim() };
  }
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = braceStart; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) end = text.length; // unterminated — drop the rest of the tail
  let obj = null;
  try { obj = JSON.parse(text.slice(braceStart, end)); } catch {}
  const before = text.slice(0, idx).replace(/\s*$/, '');
  const after = text.slice(end).replace(/^\s*/, '');
  const cleaned = (before && after ? before + '\n' + after : before + after).trim();
  return { obj, cleaned };
}

// Build the CURRENT ESTIMATES context block appended to the system prompt so the
// AI can SPEAK the same numbers shown on the Strategy Profile card. Numbers come
// from the deterministic engine (labeled estimates), never invented by the AI.
function buildEstimatesContext(profile) {
  const st = profileStatus(profile);
  if (!st.hasCoreScenario) {
    return `\n\n=== CURRENT APP-COMPUTED ESTIMATES ===\nNot available yet — still missing: ${st.needed.missing.join(', ') || 'price/down/state'}. Ask for what's missing; do not invent numbers.`;
  }
  const strat = evaluatePaths(profile);
  const ranked = (strat.topPaths.length ? strat.topPaths : strat.paths).slice(0, 3);
  const primary = ranked[0] || strat.paths[0];
  const e = primary && primary.estimate;
  const lines = [];
  lines.push('=== CURRENT APP-COMPUTED ESTIMATES (planning only — share conversationally when asked about payment, cash to close, or costs; ALWAYS call them "estimated"/"for planning", NEVER a quote, lock, or approval) ===');
  if (e) {
    lines.push(`Loan amount: ${money0(e.loanAmount)} (LTV ${e.ltv}%).`);
    // Deterministic conforming-by-size check so the assistant answers threshold
    // questions with the verified number BEFORE offering any resource.
    const size = classifyLoanSize({ loanAmount: e.loanAmount, units: profile.units || 1 });
    if (size.known) {
      lines.push(size.conformingBySize
        ? `Conforming check: this loan (${money0(e.loanAmount)}) is AT/BELOW the ${CONFORMING_YEAR} national baseline conforming limit of ${money0(size.baseline)} for a one-unit property, so it is NOT jumbo based on loan size alone. Say this plainly if asked. County may still affect high-balance classification, pricing, or program structure — but NOT the fact that it is below the national baseline. Do not say the county decides whether it is conforming or jumbo here.`
        : `Conforming check: this loan (${money0(e.loanAmount)}) is ABOVE the ${CONFORMING_YEAR} national baseline conforming limit of ${money0(size.baseline)} for a one-unit property; whether it is high-balance vs. jumbo then depends on the county-specific limit (the licensed team confirms the current county figure).`);
    }
    lines.push(`Estimated monthly payment (principal, interest, taxes, insurance): about ${money0(e.monthlyPayment)}/month.`);
    lines.push(`Estimated cash to close: about ${money0(e.estimatedCashToClose)} — that's your down payment ${money0(e.downPayment)} plus about ${money0(e.closingCosts)} in estimated closing costs.`);
    lines.push('Itemized closing-cost ASSUMPTIONS (each is a separate category — NEVER merge points into "lender fees"):');
    lines.push(`  • Origination-side (originator comp ${money0(e.originatorComp)} + application fee ${money0(e.applicationFee)}) = ${money0(e.totalLenderFees)}. This EXCLUDES discount points.`);
    lines.push(`  • Discount points (ASSUMPTION — none selected yet): ${money0(e.pointsAmount)}. One point would be 1% of the loan = ${money0(e.onePointExample)} (example, not a quote).`);
    lines.push(`  • Third-party (appraisal/credit): ${money0(e.thirdPartyFees)}; Title/escrow: ${money0(e.titleEscrowFees)}; Government/recording: ${money0(e.governmentFees)}; Prepaid interest: ${money0(e.prepaidInterest)}; Escrow reserves (taxes+insurance): ${money0(e.escrowReserves)}.`);
    lines.push(`CRITICAL: No lender has quoted this scenario (lenderQuoteKnown=false). Do NOT present any figure as an actual lender fee. If asked, say lender charges and discount points are not known yet until a lender and a rate/point combination are selected. If the borrower challenges a fee, correct it — do not defend it.`);
    lines.push(`Assumptions behind these numbers: ${(e.assumptions || []).join('; ')}.`);
  }
  if (ranked.length) {
    lines.push('Top possible paths (estimates):');
    for (const p of ranked) {
      const pe = p.estimate;
      lines.push(`- ${p.label} — ${p.status}${pe ? `, about ${money0(pe.monthlyPayment)}/mo, cash to close about ${money0(pe.estimatedCashToClose)}` : ''}.`);
    }
  }
  lines.push('When the borrower asks "how much do I need" or "what\'s my payment/closing cost", ANSWER with these estimated numbers in plain language, then add the one-line caution that final numbers depend on the lender and full review. Do NOT just tell them to wait for the team.');
  return '\n\n' + lines.join('\n');
}

export default function App() {
  const [saved] = useState(loadSession);
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('wcci-lang') || 'en'; } catch { return 'en'; }
  });
  const [screen, setScreen] = useState(() => {
    // DEFAULT ENTRY = the strategy workspace (the product). The old marketing
    // landing is preserved only as an opt-in route: wcci.online/?intro
    let wantsIntro = false;
    try { wantsIntro = new URLSearchParams(window.location.search).has('intro'); } catch {}
    if (!saved) return wantsIntro ? 'landing' : 'chat';
    if (saved.screen === 'capture') return 'capture';
    // Resume an in-progress conversation so it never looks "cleared" on reload.
    if (Array.isArray(saved.messages) && saved.messages.length > 1) return 'chat';
    if (saved.screen === 'landing') return wantsIntro ? 'landing' : 'chat';
    return saved.screen || 'chat';
  });
  // Sanitize restored messages: guarantee every message has string content so a
  // corrupted entry can never crash the render (which would wipe the chat).
  // Preserve any validated `resources` recommendations on assistant messages.
  const [messages, setMessages] = useState(() => {
    const restored = saved?.messages?.length
      ? saved.messages.filter(m => m && typeof m === 'object').map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
          ...(Array.isArray(m.resources) && m.resources.length ? { resources: m.resources } : {}),
        }))
      : null;
    return (restored && restored.length) ? restored : [getInitialMessage(lang)];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scenario, setScenario] = useState(saved?.scenario || null);
  const [confirmed, setConfirmed] = useState(saved?.confirmed || false);
  const [partialLeadCount, setPartialLeadCount] = useState(saved?.partialLeadCount || 0);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [listening, setListening] = useState(false);
  // AI Mortgage Strategy Review state
  const [profile, setProfile] = useState(saved?.profile || {});
  const [heroInput, setHeroInput] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [leadSent, setLeadSent] = useState(saved?.leadSent || false);
  const [profileOpenMobile, setProfileOpenMobile] = useState(false);
  // Unified bottom-sheet system: one sheet open at a time (accessible modal).
  const [sheet, setSheet] = useState(null);                 // null | 'lang' | 'contact' | 'menu' | 'trust' | 'confirm'
  const [privacyOpen, setPrivacyOpen] = useState(false);    // inline "Privacy & AI Use" note inside the drawer
  const [confirmCfg, setConfirmCfg] = useState(null);       // { title, body, confirmLabel, onConfirm }
  const sheetRef = useRef(null);
  const sheetCloseRef = useRef(null);
  const closeSheet = () => { setSheet(null); setPrivacyOpen(false); };
  const [winWidth, setWinWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const composingRef = useRef(false);                        // true while an IME composition is active
  // Durable conversation intelligence + the latest contextual resource cards.
  const [convState, setConvState] = useState(saved?.convState || initialConversationState());
  const [sidebarRecs, setSidebarRecs] = useState(saved?.sidebarRecs || []);
  // Automatic lead pipeline: session id + truthful status tracker (dedup/promotion/retry).
  const leadTrackerRef = useRef(null);
  if (!leadTrackerRef.current) leadTrackerRef.current = createLeadTracker();
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) { try { sessionIdRef.current = getSessionId(); } catch { sessionIdRef.current = 'fallback-' + Math.random().toString(36).slice(2, 18); } }
  const manualKeysRef = useRef(new Set()); // fields the user typed by hand — protected from AI overwrite
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const micTokenRef = useRef(0);
  const micActiveRef = useRef(false);   // true while the user wants the mic on
  const micBaseRef = useRef('');        // text already committed before current recognition run

  const t = T[lang] || T.en;
  const su = strategyUI(lang);
  const uu = UPLOAD_UI[lang] || UPLOAD_UI.en;
  const cu = CONTACT_UI[lang] || CONTACT_UI.en;
  const speechSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const isWide = winWidth >= 900;

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the document language in sync for accessibility + correct CJK shaping.
  useEffect(() => { try { document.documentElement.lang = lang; } catch {} }, [lang]);

  // Any open bottom sheet is an accessible modal: focus moves in on open, Escape
  // closes, Tab is trapped, and focus returns to the trigger on close.
  useEffect(() => {
    if (!sheet) return;
    const prev = document.activeElement;
    setTimeout(() => { try { (sheetCloseRef.current || sheetRef.current)?.focus?.(); } catch {} }, 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const root = sheetRef.current;
      if (!root) return;
      const f = root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); try { prev && prev.focus && prev.focus(); } catch {} };
  }, [sheet]);

  // Keep the input box sized to its content (covers typing, voice, and clearing).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input, screen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (screen === 'chat') setTimeout(() => inputRef.current?.focus(), 200);
  }, [screen]);

  // Resume-later: persist the session so a returning visitor picks up where they left off.
  const sessionRef = useRef(null);
  useEffect(() => {
    const snapshot = { messages, scenario, confirmed, screen, partialLeadCount, profile, leadSent, convState, sidebarRecs };
    sessionRef.current = snapshot;
    try {
      localStorage.setItem('wcci-session', JSON.stringify(snapshot));
    } catch {}
  }, [messages, scenario, confirmed, screen, partialLeadCount, profile, leadSent, convState, sidebarRecs]);

  // Safety net for mobile Safari, which can skip the final save when the tab is
  // backgrounded or closed. Flush the latest snapshot on hide/pagehide.
  useEffect(() => {
    const flush = () => {
      try {
        if (sessionRef.current) localStorage.setItem('wcci-session', JSON.stringify(sessionRef.current));
      } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Stop any active mic session on unmount.
  useEffect(() => () => stopMicInternal(), []);

  function stopMicInternal() {
    micActiveRef.current = false;
    micTokenRef.current++; // invalidate any late onresult / onend callbacks
    try { recognitionRef.current && recognitionRef.current.stop(); } catch {}
    try { recognitionRef.current && recognitionRef.current.abort(); } catch {}
  }

  function stopMic() {
    stopMicInternal();
    setListening(false);
  }

  function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    micActiveRef.current = true;
    // Whatever is already typed becomes the base we append dictation onto.
    micBaseRef.current = input ? input.trim() + ' ' : '';
    setListening(true);
    launchRecognition();
  }

  // Start a single recognition run. Because mobile browsers end recognition
  // after each pause, we auto-restart it as long as the user still wants the
  // mic on (micActiveRef).
  //
  // micBaseRef holds text COMMITTED from earlier (ended) recognition runs. In
  // continuous mode e.results is CUMULATIVE for the current run, so we rebuild
  // this run's transcript from e.results every event (never accumulating across
  // events — that caused runaway duplication). On end we commit this run's finals
  // to micBaseRef exactly once, then restart fresh.
  function launchRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !micActiveRef.current) return;
    const rec = new SR();
    const token = ++micTokenRef.current;
    let runFinal = '';
    rec.lang = localeFor(lang);
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      if (token !== micTokenRef.current) return; // guard against stale callbacks
      let finalTxt = '';
      let interimTxt = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript;
        else interimTxt += r[0].transcript;
      }
      runFinal = finalTxt; // this run's finalized text so far (not accumulated)
      setInput((micBaseRef.current + finalTxt + interimTxt).replace(/\s+/g, ' ').trim());
    };
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' are transient — let onend handle restart.
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        micActiveRef.current = false;
        setListening(false);
      }
    };
    rec.onend = () => {
      if (token !== micTokenRef.current) return;
      // Commit this run's finals ONCE, then continue if the user still wants it.
      if (runFinal.trim()) micBaseRef.current = (micBaseRef.current + runFinal + ' ').replace(/\s+/g, ' ');
      if (micActiveRef.current) { try { launchRecognition(); } catch { setListening(false); } }
      else setListening(false);
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* already starting — ignore */ }
  }

  function toggleMic() { listening ? stopMic() : startMic(); }

  function changeLang(next) {
    setLang(next);
    try { localStorage.setItem('wcci-lang', next); } catch {}
    if (listening) stopMic();
    // If the conversation hasn't started yet, swap the greeting to the new language.
    setMessages(prev => (prev.length === 1 && prev[0].role === 'assistant') ? [getInitialMessage(next)] : prev);
  }

  function resetSession() {
    if (listening) stopMic();
    setMessages([getInitialMessage(lang)]);
    setScenario(null);
    setConfirmed(false);
    setPartialLeadCount(0);
    setDeliveryFailed(false);
    setInput('');
    setProfile({});
    setLeadSent(false);
    setManualOpen(false);
    setConvState(initialConversationState());
    setSidebarRecs([]);
    manualKeysRef.current = new Set();
    setScreen('chat');
    try {
      localStorage.removeItem('wcci-session');
      localStorage.removeItem('wcci-lead-tracker');     // new scenario → new lead lifecycle
      localStorage.removeItem('wcci-resources-opened');
    } catch {}
    leadTrackerRef.current = createLeadTracker();
  }

  // Merge freeform text into the live Scenario Profile (client-side parser).
  // Fill-only: the parser gives instant feedback but never overwrites a value
  // the AI (with full context) or the user already set — it only fills blanks.
  function absorbIntoProfile(text) {
    const parsed = parseScenario(text);
    if (Object.keys(parsed).length) setProfile(prev => mergeProfile(prev, parsed, { fillOnly: true }));
  }

  // Manual-form / direct edits into the profile — authoritative, protected from
  // the AI overwriting them.
  function updateProfile(patch) {
    Object.keys(patch).forEach(k => manualKeysRef.current.add(k));
    setProfile(prev => mergeProfile(prev, patch));
  }

  // Apply an AUTHORITATIVE profile update from the AI (it has full conversation
  // context and disambiguates, e.g. "Montana" the surname vs. the state). It may
  // overwrite wrong earlier guesses, and clear a field by sending null/"unknown".
  // Fields the user typed by hand are never overwritten.
  function applyAiProfile(upd) {
    if (!upd || typeof upd !== 'object') return;
    const CLEAR = new Set([null, '', 'unknown', 'n/a', 'none', 'na', '—']);
    setProfile(prev => {
      const next = { ...prev };
      const toApply = {};
      for (const [k, v] of Object.entries(upd)) {
        if (manualKeysRef.current.has(k)) continue;         // user-entered wins
        if (v === null || CLEAR.has(typeof v === 'string' ? v.trim().toLowerCase() : v)) {
          delete next[k];                                    // explicit clear/correction
        } else {
          toApply[k] = v;                                    // overwrite
        }
      }
      return mergeProfile(next, toApply);
    });
  }

  // Landing hero: "Analyze My Scenario" — seed the conversation and prefill.
  function analyzeScenario(text) {
    const msg = (text || '').trim();
    if (!msg) return;
    absorbIntoProfile(msg);
    setScreen('chat');
    setHeroInput('');
    setTimeout(() => sendMessage(msg), 60);
  }

  // Value-first lead capture from the Strategy Profile panel. Submitting the
  // form IS an explicit consent grant + handoff — a human-review OFFER is not.
  async function handleSubmitLead(contact) {
    const merged = mergeProfile(profile, contact);
    setProfile(merged);
    setConvState(prev => ({ ...grantContactConsent(prev), handoff: 'submitted' }));
    const st = profileStatus(merged);
    const strat = st.hasCoreScenario ? evaluatePaths(merged) : { paths: [], topPaths: [] };
    const top = strat.topPaths[0] || strat.paths[0] || null;
    const lead = buildLead({
      originalMessage: messages.find(m => m.role === 'user')?.content || '',
      parsedScenario: profile,
      profile: merged,
      missingFields: st.needed.missing,
      loanPaths: strat.paths,
      cashToClose: top ? top.estimate : null,
      strategySummary: top ? `${top.label}: ${top.status}` : '',
      timestamp: new Date().toISOString(),
    });
    // Mark the lead source and the recommended resource path for the team.
    lead.leadSource = 'WCCI AI Mortgage Strategy Review';
    lead.recommendedResourcePath = sidebarRecs.map(r => r.id);
    lead.conversationStage = convState.stage;
    try {
      await submitLead(lead, { messages: messages.map(m => ({ role: m.role, content: m.content })) });
    } catch {}
    track('handoff_submitted', { stage: convState.stage, language: lang });
    // A user-initiated submission also satisfies the automatic pipeline —
    // record it so the model's automatic_lead can never create a duplicate.
    try {
      const c = extractUserContact(messages);
      const fp = leadFingerprint({ phone: c.phone || contact.phone, email: c.email || contact.email, sessionId: sessionIdRef.current });
      leadTrackerRef.current.ensure(fp, sessionIdRef.current);
      leadTrackerRef.current.begin('complete');
      leadTrackerRef.current.succeed('complete', { qualificationReason: 'user_submitted_form' });
    } catch {}
    setLeadSent(true);
    return true;
  }

  // MODEL-INITIATED AUTOMATIC LEAD: the model signaled readiness; the app
  // independently validates (contact from user-authored messages, loan goal,
  // geography, context) and submits without any extra confirmation button.
  // The tracker guarantees promotion-not-duplication and truthful status.
  async function maybeAutoSubmitLead({ signal, evalProfile, state, allMessages, recommended, scenarioComplete }) {
    try {
      const evaluation = evaluateCompletion({ profile: evalProfile, convState: state, messages: allMessages });
      if (!evaluation.qualified) return { ok: false, why: evaluation.reasons };
      const fp = leadFingerprint({ phone: evaluation.contact.phone, email: evaluation.contact.email, sessionId: sessionIdRef.current });
      const tracker = leadTrackerRef.current;
      tracker.ensure(fp, sessionIdRef.current);
      // Client-side guard #1: once complete is submitted, never trigger again
      // (owner material-change policy is disabled by default). Combined with the
      // server idempotency key, this makes double-delivery impossible.
      if (!tracker.shouldSubmit('complete')) return { ok: false, why: ['already submitted or in flight'] };
      const st = profileStatus(evalProfile);
      const strat = st.hasCoreScenario ? evaluatePaths(evalProfile) : { paths: [], topPaths: [] };
      const payload = buildCompletedLeadPayload({
        profile: evalProfile, convState: state, messages: allMessages, lang,
        signal, evaluation, sessionId: sessionIdRef.current,
        resourcesRecommended: recommended, resourcesOpened: getOpenedResources(),
        paths: strat.topPaths.length ? strat.topPaths : strat.paths,
        scenarioComplete: scenarioComplete || null,
      });
      // submitCompletedLead carries payload.completedLeadEventId to the single
      // authoritative endpoint; a duplicate resolves to already_delivered.
      const res = await submitCompletedLead(payload, { tracker });
      if (res.ok) { track('handoff_submitted', { stage: state.stage, language: lang }); setLeadSent(true); setDeliveryFailed(false); }
      else if (!tracker.canRetry('complete')) setDeliveryFailed(true);
      return res;
    } catch (e) {
      return { ok: false, why: [e && e.message] };
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || ''); // strip data: prefix
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Secure document hand-off: the file goes ONLY to the licensed team (via the
  // upload function → email). It is never sent to the AI. We just post a warm
  // confirmation into the chat.
  async function attachFile(file) {
    if (!file || uploading) return;
    const okType = /\.(pdf|jpe?g|png|heic|heif|webp|gif|docx?|txt|csv|xlsx?)$/i.test(file.name) ||
      /^(image\/|application\/pdf|text\/|application\/msword|application\/vnd)/.test(file.type || '');
    if (!okType) { setMessages(prev => [...prev, { role: 'assistant', content: uu.badType }]); return; }
    if (file.size > 8 * 1024 * 1024) { setMessages(prev => [...prev, { role: 'assistant', content: uu.tooLarge }]); return; }

    setUploading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: uu.sending }]);
    try {
      const dataBase64 = await fileToBase64(file);
      const p = profile || {};
      const note = [p.purchasePrice ? `Price ~$${Number(p.purchasePrice).toLocaleString('en-US')}` : null,
        p.state, p.zipOrCounty, p.occupancy, p.employmentType, p.incomeDocPath].filter(Boolean).join(' · ');
      const res = await fetch('/.netlify/functions/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name, contentType: file.type, dataBase64,
          contact: { name: p.name, phone: p.phone, email: p.email }, note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMessages(prev => [...prev, { role: 'assistant', content: data.ok ? uu.sent(file.name) : uu.failed }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: uu.failed }]);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    if (listening) stopMic();
    micBaseRef.current = '';
    setInput('');
    setLoading(true);
    absorbIntoProfile(text);
    // Forged-marker defense: machine tokens typed BY THE USER are neutralized
    // before they reach the model, so they can never trigger lead delivery.
    const safeText = neutralizeUserMarkers(text);
    const updated = [...messages, { role: 'user', content: safeText }];
    setMessages(updated);

    // Feed the AI the SAME numbers shown on the Strategy Profile card so it can
    // voice them in conversation instead of deflecting. Compute from the freshest
    // profile (accumulated + this message's parse).
    const liveProfile = mergeProfile(profile, parseScenario(text), { fillOnly: true });
    const estimatesBlock = buildEstimatesContext(liveProfile);

    // Conversation intelligence: update durable state from the WHOLE conversation,
    // then run the DETERMINISTIC router to pick candidate resources. The model may
    // only choose from these ids — it can never introduce a new URL.
    const nextState = updateStateFromUserMessage(convState, text, liveProfile, lang);
    for (const o of nextState.objections) if (!convState.objections.includes(o)) track('trust_objection_detected', { objection: o, stage: nextState.stage, language: lang });
    if (nextState.userRequestedHuman && !convState.userRequestedHuman) track('human_review_requested', { stage: nextState.stage, language: lang });

    // ── Conforming-threshold + stage-aware routing inputs ──
    const size = classifyLoanSize({ loanAmount: liveProfile.loanAmount, units: liveProfile.units || 1 });
    const intents = detectResourceIntents(text);
    const pst = profileStatus(liveProfile);
    // Still gathering core scenario fields (and the user hasn't asked for a link)?
    const dataGathering = pst.needed.missing.length > 0 && !intents.explicit &&
      !['trust_building', 'human_review_ready', 'handoff_requested'].includes(nextState.stage);
    // Resolution: once the loan is known conforming BY SIZE and a jumbo-class topic
    // was raised, the conforming-vs-jumbo question is settled → mark it resolved.
    let resolvedTopics = nextState.resolvedTopics || [];
    if (size.conformingBySize && JUMBO_TOPICS.some(x => (nextState.topics || []).includes(x))) {
      resolvedTopics = Array.from(new Set([...resolvedTopics, 'jumbo', 'conforming']));
    }
    nextState.resolvedTopics = resolvedTopics;
    const jumboResolved = resolvedTopics.includes('jumbo') || resolvedTopics.includes('conforming');

    const routed = routeResources({
      audience: nextState.audience, state: nextState.state, county: nextState.county, city: nextState.city,
      topics: nextState.topics, objections: nextState.objections, stage: nextState.stage,
      wantsApply: nextState.wantsApply, tonePreference: nextState.tonePreference,
      loanAmount: liveProfile.loanAmount, units: liveProfile.units || 1,
      dataGathering, resolvedTopics,
      explicitResourceRequest: intents.explicit, wantsCalculator: intents.calculator,
      wantsCaliforniaResources: intents.california, wantsStructureCompare: intents.structure,
    });
    setConvState(nextState);
    // Resolution-aware cleanup: a settled jumbo question removes any stale
    // BeforeJumboLoan card already sitting in the sidebar.
    if (jumboResolved) setSidebarRecs(prev => prev.filter(r => r.id !== 'beforejumbo-home'));
    const trackerRec = leadTrackerRef.current.get();
    const completeStatus = trackerRec ? trackerRec.stages.complete.status : 'qualifying';
    const intelBlock = buildIntelContext(nextState, routed.candidates, lang, getResource, {
      leadSubmitted: completeStatus === 'submitted',
      leadFailed: completeStatus === 'failed',
    });

    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT + langDirective(lang) + estimatesBlock + intelBlock,
          messages: updated.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const fullText = (data.content || []).map(b => b.text || '').join('') || 'Connection error. Please try again.';

      let displayText = fullText;
      let parsedScenario = null;
      let resources = [];

      // Structured output: pull CONVO_META (resource picks + state patch + handoff)
      // via balanced-brace extraction, validate every id against the registry, and
      // strip it from display. Because extractMarker strips the whole marker even
      // when the JSON is invalid, a machine line can never leak into the bubble.
      const cm = extractMarker(displayText, 'CONVO_META');
      let handoffSignal = null;
      if (cm) {
        displayText = cm.cleaned;
        const meta = cm.obj;
        if (meta && typeof meta === 'object') {
          const allowed = routed.candidates.map(c => c.id);
          const recs = (Array.isArray(meta.resources) ? meta.resources : []).map(rr => {
            const cand = routed.candidates.find(c => c.id === (rr && rr.id));
            return { id: rr && rr.id, reason: rr && rr.reason, reasonKey: cand ? cand.reasonKey : '' };
          });
          resources = validateRecommendations(recs, {
            audience: nextState.audience, allowedIds: allowed,
            onReject: (id, why) => track('broken_resource_detected', { resourceId: id, reasonKey: why }),
          }).map(r => ({ ...r, reason: r.reason || fallbackReason(r.reasonKey, lang) }));
          if (meta.state) setConvState(prev => applyStatePatch(prev, meta.state));
          if (meta.state && meta.state.contactConsent === 'declined') track('contact_declined', { stage: nextState.stage, language: lang });
          // Handoff signal: unknown modes are rejected; only whitelisted modes act.
          handoffSignal = normalizeHandoffSignal(meta.handoff);
          if (handoffSignal && handoffSignal.mode === 'offer') track('contact_offer_shown', { stage: nextState.stage, language: lang });
          for (const r of resources) track('resource_recommended', { resourceId: r.id, category: r.category, reasonKey: r.reasonKey, stage: nextState.stage, language: lang });
        }
      }
      // ── No duplicate presentation ── each recommended resource renders in
      // exactly ONE surface: inline (directly answers this message) OR sidebar
      // (passive next-step). Never both.
      var inlineRecs = resources.filter(r => placementFor(r.reasonKey) === 'inline');
      var passiveRecs = resources.filter(r => placementFor(r.reasonKey) === 'sidebar');
      const inlineIds = new Set(inlineRecs.map(r => r.id));
      setSidebarRecs(prev => {
        // Drop stale (resolved-topic) cards and anything now shown inline.
        const kept = prev.filter(r => !(jumboResolved && r.id === 'beforejumbo-home') && !inlineIds.has(r.id));
        const merged = [...kept];
        for (const r of passiveRecs) {
          if (jumboResolved && r.id === 'beforejumbo-home') continue;
          if (!merged.some(x => x.id === r.id)) merged.push(r);
        }
        return merged.slice(-4);
      });

      // Live profile sync: pull the AI's PROFILE_UPDATE line (fill-only merge so
      // the deterministic parser / manual entries stay authoritative).
      const pu = extractMarker(displayText, 'PROFILE_UPDATE');
      if (pu) {
        displayText = pu.cleaned;
        if (pu.obj) applyAiProfile(pu.obj);
      }

      const sc = extractMarker(displayText, 'SCENARIO_COMPLETE');
      if (sc) {
        displayText = sc.cleaned;      // keeps the thank-you text that follows
        if (sc.obj) parsedScenario = sc.obj;
      }

      const reply = { role: 'assistant', content: displayText, ...(inlineRecs && inlineRecs.length ? { resources: inlineRecs } : {}) };
      const final = [...updated, reply];
      setMessages(final);
      for (const r of resources) track('resource_impression', { resourceId: r.id, category: r.category, stage: nextState.stage, language: lang });

      // Profile the evaluators see this turn: live profile + this turn's AI patch.
      const evalProfile = pu && pu.obj ? mergeProfile(liveProfile, pu.obj) : liveProfile;
      const recommendedIds = resources.map(r => r.id);

      // ── ONE unified completed-lead trigger ──
      // Both compatibility signals converge here: SCENARIO_COMPLETE (server
      // qualified it, no send) and CONVO_META automatic_lead. Whichever fires,
      // the client makes EXACTLY ONE call to the single authoritative endpoint,
      // guarded by the local tracker + the server idempotency key. chat.js never
      // sends, so there is no second channel.
      const serverQual = data._leadQualification;                       // from chat.js SCENARIO_COMPLETE validation
      const autoSignal = handoffSignal && handoffSignal.mode === 'automatic_lead' ? handoffSignal : null;
      const scenarioQualified = parsedScenario && serverQual && serverQual.qualified;
      const completionTrigger = autoSignal ||
        (scenarioQualified ? { mode: 'automatic_lead', reason: 'scenario_complete_marker', confidence: null } : null);

      if (completionTrigger) {
        maybeAutoSubmitLead({
          signal: completionTrigger, evalProfile, state: nextState, allMessages: final,
          recommended: recommendedIds, scenarioComplete: parsedScenario || null,
        }).catch(() => {});
      } else if (leadTrackerRef.current.canRetry('complete')) {
        // Controlled retry of a previously failed delivery — SAME eventId, so a
        // first delivery that actually succeeded resolves to already_delivered.
        maybeAutoSubmitLead({
          signal: { mode: 'automatic_lead', reason: 'retry_after_failure', confidence: null },
          evalProfile, state: nextState, allMessages: final, recommended: recommendedIds,
        }).catch(() => {});
      }

      // SCENARIO_COMPLETE still drives the capture-screen UX (independent of delivery).
      if (parsedScenario) {
        setScenario(parsedScenario);
        setTimeout(() => setScreen('capture'), 1800);
      }

      // PARTIAL LEAD: user-authored contact only; promoted via updateNumber,
      // never duplicated once the completed lead has been submitted.
      const completeRec = leadTrackerRef.current.get();
      const completeDone = completeRec && completeRec.stages.complete.status === 'submitted';
      if (!completionTrigger && !completeDone && hasValidContact(final) && partialLeadCount < 2) {
        setPartialLeadCount(c => c + 1);
        try {
          const c = extractUserContact(final);
          const fp = leadFingerprint({ phone: c.phone, email: c.email, sessionId: sessionIdRef.current });
          leadTrackerRef.current.ensure(fp, sessionIdRef.current);
          leadTrackerRef.current.begin('partial');
        } catch {}
        fetch('/.netlify/functions/partial-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: final.map(m => ({ role: m.role, content: m.content })),
            updateNumber: partialLeadCount + 1,
          }),
        }).then(r => r.json()).then(b => {
          if (b && b.email) leadTrackerRef.current.succeed('partial');
          else leadTrackerRef.current.fail('partial');
        }).catch(() => { try { leadTrackerRef.current.fail('partial'); } catch {} });
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please refresh and try again.' }]);
    }
    setLoading(false);
  }

  function handleKeyDown(e) {
    // Never submit while a Chinese/Japanese/Korean IME is composing — Enter there
    // confirms a candidate, not the message.
    if (shouldSendOnEnter(e, composingRef.current)) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  // Grow the input box with the text so people can see everything they type.
  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  // ── Open handlers ──
  function openLang() { setSheet('lang'); }
  function openContact() { setSheet('contact'); }
  function openMenu() { setSheet('menu'); }
  function openTrust() { setSheet('trust'); }
  function openPrivacy() { setPrivacyOpen(true); setSheet('trust'); }
  function confirmStartNew() {
    setConfirmCfg({ title: cu.confirmNewTitle, body: cu.confirmNewBody, confirmLabel: cu.startNewScenario, onConfirm: () => resetSession() });
    setSheet('confirm');
  }
  function confirmClearSaved() {
    setConfirmCfg({
      title: cu.clearSavedTitle, body: cu.clearSavedBody, confirmLabel: cu.clearSaved,
      onConfirm: () => { try { localStorage.removeItem('wcci-session-id'); } catch {} resetSession(); },
    });
    setSheet('confirm');
  }

  // Compact language control (🌐 + current label) — opens the language sheet.
  function LangButton({ dark }) {
    return (
      <button onClick={openLang} aria-haspopup="dialog" aria-label={cu.selectLanguageAria}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 44, padding: '0 11px', borderRadius: 10, cursor: 'pointer',
          background: dark ? 'rgba(255,255,255,0.12)' : '#f2efe7', border: dark ? '1px solid rgba(255,255,255,0.25)' : '1px solid #d6d0c2',
          color: dark ? '#ffffff' : '#141414', fontSize: 13, fontWeight: 700 }}>
        <span aria-hidden="true">🌐</span>{LANG_LABELS[lang] || 'EN'}<span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
    );
  }
  // Consistent 44×44 icon button.
  function iconBtnStyle(active) {
    return { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
      background: active ? '#e9e4d8' : '#ffffff', border: '1px solid #ddd7c9', borderRadius: 10, color: '#141414', cursor: 'pointer', textDecoration: 'none' };
  }

  // ── Bottom-sheet shell (accessible modal; focus handled by the sheet effect) ──
  function sheetShell(titleId, title, body, { brand = false, maxWidth = 460 } = {}) {
    return (
      <div onClick={closeSheet}
        style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,18,15,0.42)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }}>
        <div ref={sheetRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId}
          style={{ background: '#ffffff', width: '100%', maxWidth, maxHeight: '90dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '18px 18px 0 0', padding: '16px clamp(16px,4vw,24px)', paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {brand && <BrandMark size={30} />}
              <span id={titleId} style={{ fontSize: 16, fontWeight: 700, color: '#141414', letterSpacing: '0.01em' }}>{title}</span>
            </div>
            <button ref={sheetCloseRef} onClick={closeSheet} aria-label={cu.close}
              style={{ background: '#efece3', border: '1px solid #ddd7c9', borderRadius: 9, width: 40, height: 40, fontSize: 16, cursor: 'pointer', color: '#837f74', flexShrink: 0 }}>✕</button>
          </div>
          {body}
        </div>
      </div>
    );
  }

  const rowBtn = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 48, padding: '11px 12px', borderRadius: 10, background: 'none', border: 'none', textAlign: 'left', color: '#141414', fontSize: 15, fontWeight: 500, cursor: 'pointer' };
  const rowLink = { ...rowBtn, textDecoration: 'none' };
  const actionCell = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, textAlign: 'center', textDecoration: 'none', background: '#efece3', border: '1px solid #d6d0c2', borderRadius: 10, color: '#141414', fontSize: 13.5, fontWeight: 600, padding: '10px 12px' };

  // Language sheet
  function renderLangSheet() {
    return sheetShell('lang-title', cu.langTitle, (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {LANGS.map(l => {
          const active = l === lang;
          return (
            <button key={l} lang={l} onClick={() => { changeLang(l); closeSheet(); }}
              aria-label={LANG_NATIVE[l]} aria-pressed={active}
              style={{ ...rowBtn, justifyContent: 'space-between', background: active ? '#f2efe7' : 'none', border: active ? '1px solid #d6d0c2' : '1px solid transparent', fontWeight: active ? 700 : 500 }}>
              <span>{LANG_NATIVE[l]}</span>
              {active && <span aria-hidden="true" style={{ color: '#171717' }}>✓</span>}
            </button>
          );
        })}
      </div>
    ));
  }

  // Contact sheet — user chooses Office / Direct / Email (never auto-dials).
  function renderContactSheet() {
    return sheetShell('contact-title', cu.contactTitle, (
      <div>
        <div style={{ fontSize: 13.5, lineHeight: 1.9, color: '#333333' }}>
          <div style={{ color: '#9a958a', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{cu.officeLabel}</div>
          <a href={OFFICE_PHONE_HREF} style={{ color: '#171717', fontWeight: 700, textDecoration: 'none', fontSize: 16 }}>{OFFICE_PHONE}</a>
          <div style={{ color: '#9a958a', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10 }}>{cu.directContactLabel}</div>
          <a href={DIRECT_PHONE_HREF} style={{ color: '#171717', fontWeight: 700, textDecoration: 'none', fontSize: 16 }}>{DIRECT_PHONE}</a>
          <div style={{ color: '#9a958a', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10 }}>{cu.emailLabel}</div>
          <a href={COMPANY_EMAIL_HREF} style={{ color: '#171717', fontWeight: 700, textDecoration: 'none', fontSize: 15 }}>{COMPANY_EMAIL}</a>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
          <a href={OFFICE_PHONE_HREF} style={{ ...actionCell }}>📞 {cu.callOffice}</a>
          <a href={DIRECT_PHONE_HREF} style={{ ...actionCell }}>📱 {cu.callAnatoliy}</a>
        </div>
        <div style={{ marginTop: 8 }}>
          <a href={COMPANY_EMAIL_HREF} style={{ ...actionCell }}>✉️ {cu.sendEmail}</a>
        </div>
      </div>
    ));
  }

  // Header/composer menu — all destinations in one place.
  function renderMenuSheet() {
    const items = [];
    const pct = profileStatus(profile).percent;
    if (!isWide) items.push({ key: 'profile', icon: '📋', label: `${su.profileTitle} · ${pct}%`, on: () => { closeSheet(); setProfileOpenMobile(true); } });
    items.push(
      { key: 'new', icon: '✨', label: cu.startNewScenario, on: () => { closeSheet(); confirmStartNew(); } },
      { key: 'company', icon: '🛡️', label: cu.companyAndLicensing, on: () => { openTrust(); } },
      { key: 'about', icon: '🏢', label: cu.aboutCompany, href: COMPANY_FACTS_PRIMARY },
      { key: 'privacy', icon: '🔒', label: cu.privacyAiUse, on: () => { openPrivacy(); } },
      { key: 'contact', icon: '📞', label: cu.contact, on: () => { openContact(); } },
      { key: 'clear', icon: '🗑️', label: cu.clearSaved, on: () => { closeSheet(); confirmClearSaved(); } },
    );
    return sheetShell('menu-title', cu.menuLabel, (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => it.href ? (
          <a key={it.key} role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => closeSheet()} style={rowLink}>
            <span aria-hidden="true" style={{ width: 22, textAlign: 'center' }}>{it.icon}</span>{it.label}
          </a>
        ) : (
          <button key={it.key} role="menuitem" onClick={it.on} style={rowBtn}>
            <span aria-hidden="true" style={{ width: 22, textAlign: 'center' }}>{it.icon}</span>{it.label}
          </button>
        ))}
      </div>
    ));
  }

  // Destructive-action confirmation.
  function renderConfirmSheet() {
    const c = confirmCfg || {};
    return sheetShell('confirm-title', c.title || '', (
      <div>
        <p style={{ fontSize: 14, color: '#6f6b62', lineHeight: 1.6, marginBottom: 16 }}>{c.body}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={closeSheet} style={{ flex: 1, minHeight: 46, borderRadius: 10, border: '1px solid #ddd7c9', background: '#ffffff', color: '#6f6b62', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{cu.cancel}</button>
          <button onClick={() => { closeSheet(); try { c.onConfirm && c.onConfirm(); } catch {} }} style={{ flex: 1, minHeight: 46, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #171717, #000000)', color: '#ffffff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{c.confirmLabel || cu.startNewScenario}</button>
        </div>
      </div>
    ));
  }

  // Company & Licensing drawer. Legal identifiers/NMLS/DRE/legal name never localized.
  function renderTrustPanel() {
    const Action = ({ href, onClick, children }) => (
      href
        ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" style={{ ...actionCell }}>{children}</a>
        : <button onClick={onClick} style={{ ...actionCell, width: '100%', cursor: 'pointer' }}>{children}</button>
    );
    return sheetShell('cl-drawer-title', cu.companyAndLicensing, (
      <div>
        <p style={{ fontSize: 12.5, color: '#6f6b62', lineHeight: 1.6, marginBottom: 12 }}>{cu.platformExplainer}</p>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: '#333333', borderTop: '1px solid #e9e4d8', paddingTop: 12 }}>
          <div style={{ fontWeight: 700, color: '#141414' }}>{COMPANY_NAME}</div>
          <div>CA DRE Corporation License #{COMPANY_DRE}</div>
          <div>NMLS #{COMPANY_NMLS}</div>
          <div style={{ fontWeight: 700, color: '#141414', marginTop: 8 }}>{BROKER_NAME}</div>
          <div>{BROKER_TITLE}</div>
          <div>CA DRE Broker License #{BROKER_DRE}</div>
          <div>NMLS #{BROKER_NMLS}</div>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.9, color: '#333333', marginTop: 12, borderTop: '1px solid #e9e4d8', paddingTop: 12 }}>
          <div><b>{cu.officeLabel}:</b> <a href={OFFICE_PHONE_HREF} style={{ color: '#171717', fontWeight: 600 }}>{OFFICE_PHONE}</a></div>
          <div><b>{cu.directLabel}:</b> <a href={DIRECT_PHONE_HREF} style={{ color: '#171717', fontWeight: 600 }}>{DIRECT_PHONE}</a></div>
          <div><b>{cu.emailLabel}:</b> <a href={COMPANY_EMAIL_HREF} style={{ color: '#171717', fontWeight: 600 }}>{COMPANY_EMAIL}</a></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <Action href={OFFICE_PHONE_HREF}>📞 {cu.callOffice}</Action>
          <Action href={DIRECT_PHONE_HREF}>📱 {cu.callAnatoliy}</Action>
          <Action href={COMPANY_FACTS_PRIMARY}>👤 {cu.meetBroker}</Action>
          <Action href={NMLS_CONSUMER_ACCESS}>✅ {cu.verifyLicensing}</Action>
        </div>
        <div style={{ marginTop: 8 }}>
          <Action onClick={() => setPrivacyOpen(o => !o)}>🔒 {cu.privacyAiUse}</Action>
        </div>
        {privacyOpen && (
          <p style={{ fontSize: 12.5, color: '#6f6b62', lineHeight: 1.7, marginTop: 10, background: '#f2efe7', border: '1px solid #e9e4d8', borderRadius: 10, padding: '12px' }}>{cu.privacyNote}</p>
        )}
      </div>
    ), { brand: true });
  }

  // All sheets render here (one at a time).
  function renderSheets() {
    if (sheet === 'lang') return renderLangSheet();
    if (sheet === 'contact') return renderContactSheet();
    if (sheet === 'menu') return renderMenuSheet();
    if (sheet === 'trust') return renderTrustPanel();
    if (sheet === 'confirm') return renderConfirmSheet();
    return null;
  }

  // ─── Landing ───
  if (screen === 'landing') {
    return (
      <div style={{ minHeight: '100dvh', background: '#f2efe7', fontFamily: FONT, color: '#171717' }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #171717, #000000, #333333)' }} />

        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.95)', borderBottom: '1px solid #ddd7c9', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 100 }}>
          {/* Brand lockup — WCCI, by the legal company (never positioned as an AI tech company) */}
          <a href="https://wcci.online" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 1, minWidth: 0 }}>
            <BrandMark size={34} />
            <div style={{ minWidth: 0, lineHeight: 1.15 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#141414', letterSpacing: '0.03em' }}>WCCI</div>
              <div style={{ fontSize: 10.5, color: '#837f74', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.brandBy} {COMPANY_NAME}</div>
            </div>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <LangButton />
            <button onClick={openContact} aria-haspopup="dialog" aria-label={cu.contactTitle} title={cu.contact} style={iconBtnStyle(sheet === 'contact')}>📞</button>
          </div>
        </nav>

        <div style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(24px, 6vw, 72px) clamp(16px, 4vw, 40px) clamp(32px, 8vw, 80px)', textAlign: 'center' }}>
          {/* Badge — AI is SECONDARY (company is primary) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#edeae0', border: '1px solid #cfc9bc', borderRadius: 20, padding: '5px 12px', marginBottom: 18 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#171717', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 12.5, color: '#171717', fontWeight: 500 }}>{t.badge}</span>
          </div>

          {/* Mortgage-strategy headline (mobile-first; not an AI-company headline) */}
          <h1 style={{ fontSize: 'clamp(26px, 6vw, 56px)', fontWeight: 700, lineHeight: 1.18, letterSpacing: '-0.02em', marginBottom: 12 }}>
            {t.mobileH1}
          </h1>
          <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: '#6f6b62', lineHeight: 1.7, maxWidth: 520, margin: '0 auto 20px', padding: '0 4px' }}>
            {t.mobileLead}
          </p>

          {/* Scenario input — reachable without scrolling past a decorative hero */}
          <div style={{ maxWidth: 620, margin: '0 auto', background: 'white', border: '1px solid #ddd7c9', borderRadius: 16, boxShadow: '0 12px 40px rgba(20,20,20,0.10)', padding: 'clamp(14px, 3vw, 20px)', textAlign: 'left' }}>
            <textarea
              value={heroInput}
              onChange={e => setHeroInput(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !composingRef.current) { e.preventDefault(); analyzeScenario(heroInput); } }}
              placeholder={su.heroPlaceholder}
              rows={3}
              style={{ width: '100%', border: '1px solid #ddd7c9', borderRadius: 12, padding: '14px 16px', fontSize: 16, resize: 'vertical', fontFamily: FONT, lineHeight: 1.6, color: '#171717', background: '#fbfaf6', minHeight: 84 }}
            />
            <button
              onClick={() => analyzeScenario(heroInput)}
              disabled={!heroInput.trim()}
              style={{ width: '100%', minHeight: 48, marginTop: 12, background: heroInput.trim() ? 'linear-gradient(135deg, #141414, #171717)' : '#c7c2b6', color: 'white', border: 'none', borderRadius: 12, padding: '15px', fontSize: 16, fontWeight: 700, cursor: heroInput.trim() ? 'pointer' : 'default', boxShadow: heroInput.trim() ? '0 4px 20px rgba(20,20,20,0.22)' : 'none', transition: 'all 0.15s' }}
            >{t.buildStrategy}</button>
            {/* Manual step-by-step option */}
            <button
              onClick={() => { setScreen('chat'); setManualOpen(true); }}
              style={{ width: '100%', minHeight: 44, marginTop: 8, background: 'white', color: '#171717', border: '1.5px solid #cfc9bc', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >{t.stepByStep}</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {su.heroChips.map((chip, i) => (
                <button key={i} onClick={() => analyzeScenario(chip)}
                  style={{ background: '#efece3', border: '1px solid #ddd7c9', color: '#333333', borderRadius: 18, padding: '8px 12px', minHeight: 36, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#e9e4d8'; e.currentTarget.style.borderColor = '#cfc9bc'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#efece3'; e.currentTarget.style.borderColor = '#ddd7c9'; }}
                >{chip}</button>
              ))}
            </div>
          </div>
          <p style={{ marginTop: 14, fontSize: 13, color: '#9a958a' }}>{t.ctaSub}</p>

          {/* Compact trust & contact access — available BEFORE chatting */}
          <div style={{ marginTop: 14 }}>
            <button onClick={openTrust} aria-haspopup="dialog" aria-label={cu.companyAndLicensing}
              style={{ background: 'white', border: '1px solid #d6d0c2', borderRadius: 10, padding: '10px 16px', minHeight: 44, fontSize: 13, fontWeight: 600, color: '#141414', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              🛡️ {cu.companyAndLicensing}
            </button>
          </div>

          {/* Demo chat preview */}
          <div style={{ marginTop: 48, background: 'white', borderRadius: 16, border: '1px solid #ddd7c9', boxShadow: '0 20px 60px rgba(0,0,0,0.08)', padding: 'clamp(14px, 3vw, 24px)', maxWidth: 540, margin: '48px auto 0', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #efece3' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #171717, #000000)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>AI</div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loan Strategy AI</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5f7d55', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5f7d55', display: 'inline-block' }} />Online
              </span>
            </div>
            {t.demo.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.ai ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                <div style={{ background: msg.ai ? '#f2efe7' : 'linear-gradient(135deg, #171717, #000000)', color: msg.ai ? '#333333' : 'white', border: msg.ai ? '1px solid #ddd7c9' : 'none', borderRadius: msg.ai ? '4px 12px 12px 12px' : '12px 4px 12px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.6, maxWidth: '82%' }}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div style={{ background: 'white', borderTop: '1px solid #ddd7c9', padding: 'clamp(40px, 8vw, 72px) clamp(16px, 4vw, 40px)' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 20 }}>
            {t.features.map((f, i) => (
              <div key={i} style={{ padding: 'clamp(18px, 3vw, 28px)', borderRadius: 12, border: '1px solid #efece3', background: '#f2efe7' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: f.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 14 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: '#837f74', lineHeight: 1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer (English, legal) */}
        <div style={{ background: '#f2efe7', padding: '24px clamp(16px, 4vw, 40px)', borderTop: '1px solid #ddd7c9' }}>
          <p style={{ maxWidth: 800, margin: '0 auto', fontSize: 11, color: '#9a958a', lineHeight: 1.7, textAlign: 'center' }}>{DISCLAIMER}</p>
        </div>

        <footer style={{ textAlign: 'center', padding: '24px clamp(16px, 4vw, 40px)', borderTop: '1px solid #ddd7c9', fontSize: 12, color: '#9a958a', lineHeight: 1.9 }}>
          {/* Complete approved contact + licensing block */}
          <div style={{ marginBottom: 8 }}>
            <a href={OFFICE_PHONE_HREF} style={{ color: '#837f74', fontWeight: 600, textDecoration: 'none' }}>{cu.officeLabel}: {OFFICE_PHONE}</a>
            {' · '}
            <a href={DIRECT_PHONE_HREF} style={{ color: '#837f74', fontWeight: 600, textDecoration: 'none' }}>{cu.directLabel}: {DIRECT_PHONE}</a>
            {' · '}
            <a href={COMPANY_EMAIL_HREF} style={{ color: '#837f74', fontWeight: 600, textDecoration: 'none' }}>{COMPANY_EMAIL}</a>
          </div>
          <div>
            <a href={COMPANY_FACTS_PRIMARY} target="_blank" rel="noopener noreferrer" style={{ color: '#9a958a' }}>westcoastcapitalmortgage.com</a>
            {' · '}
            <a href="https://wcci.online" style={{ color: '#9a958a' }}>wcci.online</a>
          </div>
          <div style={{ marginTop: 8 }}>{COMPANY_NAME} · {COMPANY_LICENSE}</div>
          <div>{BROKER_NAME} · {BROKER_TITLE} · {BROKER_LICENSE}</div>
          <div style={{ marginTop: 8 }}>© 2026 {COMPANY_NAME} · Equal Housing Lender</div>
        </footer>
        {renderSheets()}
      </div>
    );
  }

  // ─── Chat ───
  if (screen === 'chat') {
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const lastIsAI = messages[messages.length - 1]?.role === 'assistant';
    const showChips = !loading && lastIsAI;
    const chips = userMsgCount === 0 ? t.starterChips : t.helperChips;
    const pstatus = profileStatus(profile);

    // The live Loan Strategy Profile panel (shared by desktop aside + mobile sheet).
    const profilePanel = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {manualOpen && <ManualForm profile={profile} onChange={updateProfile} t={su} />}
        <StrategyProfile
          profile={profile}
          onSubmitLead={handleSubmitLead}
          leadSent={leadSent}
          manualOpen={manualOpen}
          onManualToggle={() => setManualOpen(o => !o)}
          t={su}
        />
        {/* Contextual "Recommended for your situation" block — max 3, verified only. */}
        {sidebarRecs.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #ddd7c9', borderRadius: 12, padding: 14 }}>
            <ResourceCardList recs={sidebarRecs} lang={lang} title={(RESOURCE_UI[lang] || RESOURCE_UI.en).recommendedTitle} />
          </div>
        )}
        <p style={{ fontSize: 10, color: '#9a958a', lineHeight: 1.6, padding: '0 2px' }}>{STRATEGY_DISCLAIMER}</p>
      </div>
    );

    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#f2efe7', fontFamily: FONT }}>
        {/* Workspace header — company-first (WCCI is the product/domain identifier) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 14px', background: '#ffffff', borderBottom: '1px solid #ddd7c9', flexShrink: 0 }}>
          {/* Left: square logo mark. Desktop adds the company lockup; mobile is logo-only. */}
          {isWide ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <BrandMark size={38} />
              <div style={{ minWidth: 0, lineHeight: 1.18 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#141414', whiteSpace: 'nowrap' }}>{COMPANY_NAME}</div>
                <div style={{ fontSize: 10.5, color: '#9a958a', whiteSpace: 'nowrap' }}>WCCI · {su.profileTitle}</div>
              </div>
              <a href={OFFICE_PHONE_HREF} style={{ marginLeft: 6, fontSize: 12.5, color: '#6f6b62', textDecoration: 'none', whiteSpace: 'nowrap', borderLeft: '1px solid #ddd7c9', paddingLeft: 12 }}>
                <span style={{ color: '#9a958a' }}>{cu.officeLabel}:</span> <span style={{ fontWeight: 600, color: '#000000' }}>{OFFICE_PHONE}</span>
              </a>
            </div>
          ) : (
            <button onClick={() => { if (messages.length <= 1) setScreen('chat'); }} aria-label={COMPANY_NAME}
              style={{ background: 'none', border: 'none', padding: 0, cursor: messages.length <= 1 ? 'pointer' : 'default', display: 'flex', alignItems: 'center' }}>
              <BrandMark size={40} />
            </button>
          )}

          {/* Right: [Company & Licensing + Start Over on desktop] · language · phone · menu */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isWide ? 8 : 7, flexShrink: 0 }}>
            {isWide && messages.length > 1 && (
              <button onClick={confirmStartNew}
                style={{ background: 'none', border: '1px solid #ddd7c9', color: '#837f74', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '0 12px', borderRadius: 10, minHeight: 44 }}>{t.startOver}</button>
            )}
            {isWide && (
              <button onClick={openTrust} aria-haspopup="dialog" aria-label={cu.companyAndLicensing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#f2efe7', border: '1px solid #d6d0c2', color: '#141414', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '0 13px', borderRadius: 10, minHeight: 44, whiteSpace: 'nowrap' }}>
                <span aria-hidden="true">🛡️</span>{cu.companyAndLicensing}
              </button>
            )}
            <LangButton />
            <button onClick={openContact} aria-haspopup="dialog" aria-label={cu.contactTitle} title={cu.contact} style={iconBtnStyle(sheet === 'contact')}>📞</button>
            <button onClick={openMenu} aria-haspopup="dialog" aria-expanded={sheet === 'menu'} aria-label={cu.openMenuAria} title={cu.menuLabel} style={iconBtnStyle(sheet === 'menu')}>☰</button>
          </div>
        </div>

        {/* Body: conversation (left) + live profile (right, desktop) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>
          {messages.map((msg, i) => (
            <div key={i} className="chat-msg" style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
              {msg.role === 'assistant' && (
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #171717, #000000)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>AI</div>
              )}
              <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: msg.role === 'user' ? 'flex-end' : 'stretch' }}>
                <div style={{
                  background: msg.role === 'user' ? 'linear-gradient(135deg, #171717, #000000)' : '#ffffff',
                  color: msg.role === 'user' ? '#ffffff' : '#171717',
                  border: msg.role === 'assistant' ? '1px solid #e2ddd0' : 'none',
                  borderRadius: msg.role === 'user' ? '18px 6px 18px 18px' : '6px 18px 18px 18px',
                  padding: '11px 15px', fontSize: 14.5, lineHeight: 1.7,
                  boxShadow: msg.role === 'assistant' ? '0 1px 3px rgba(74,58,32,0.07)' : '0 2px 8px rgba(138,98,49,0.20)',
                }}>
                  {String(msg.content ?? '').split('\n').map((line, j, arr) => (
                    <span key={j}>{renderBold(line)}{j < arr.length - 1 && <br />}</span>
                  ))}
                </div>
                {/* Contextual resource cards (verified registry ids only). */}
                {msg.role === 'assistant' && Array.isArray(msg.resources) && msg.resources.length > 0 && (
                  <ResourceCardList recs={msg.resources} lang={lang} title={(RESOURCE_UI[lang] || RESOURCE_UI.en).inlineTitle} />
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #171717, #000000)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>AI</div>
              <div style={{ background: 'white', border: '1px solid #ddd7c9', borderRadius: '4px 16px 16px 16px', padding: '12px 16px', display: 'flex', gap: 5, alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {[0, 0.2, 0.4].map((d, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#171717', display: 'inline-block', animation: `pulse 1.2s ease-in-out ${d}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick-reply chips */}
        {showChips && (
          <div style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '0 12px 4px', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', flexShrink: 0 }}>
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => sendMessage(chip)}
                style={{ background: 'white', border: '1px solid #cfc9bc', color: '#171717', borderRadius: 18, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#edeae0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
              >{chip}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ background: 'white', borderTop: '1px solid #ddd7c9', padding: '10px 12px', paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))', flexShrink: 0 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.gif,.doc,.docx,.txt,.csv,.xls,.xlsx,image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={e => attachFile(e.target.files && e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploading}
              title={uu.hint}
              aria-label={uu.hint}
              style={{ width: 44, height: 44, background: '#efece3', border: '1px solid #ddd7c9', borderRadius: 22, color: uploading ? '#c7c2b6' : '#837f74', fontSize: 18, cursor: uploading ? 'default' : 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >📎</button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder={t.placeholder}
              rows={2}
              style={{ flex: 1, border: '1px solid #ddd7c9', borderRadius: 16, padding: '12px 16px', fontSize: 16, resize: 'none', fontFamily: FONT, lineHeight: 1.55, color: '#171717', background: '#f2efe7', transition: 'border-color 0.2s, box-shadow 0.2s', minHeight: 64, maxHeight: 160, overflowY: 'auto' }}
            />
            {speechSupported && (
              <button
                onClick={toggleMic}
                title={listening ? t.micStop : t.micStart}
                aria-label={listening ? t.micStop : t.micStart}
                style={{ width: 44, height: 44, background: listening ? '#a23b2a' : '#efece3', border: listening ? 'none' : '1px solid #ddd7c9', borderRadius: 22, color: listening ? 'white' : '#837f74', fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: listening ? 'pulse 1.4s ease-in-out infinite' : 'none' }}
              >🎤</button>
            )}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{ width: 44, height: 44, background: input.trim() ? 'linear-gradient(135deg, #171717, #000000)' : '#ddd7c9', border: 'none', borderRadius: 22, color: 'white', fontSize: 18, cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >→</button>
          </div>
          {/* Compact trust link instead of a heavy multiline legal block. */}
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <button onClick={openTrust} aria-haspopup="dialog" aria-label={cu.companyAndLicensing}
              style={{ background: 'none', border: 'none', color: '#9a958a', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px', minHeight: 28 }}>
              <span aria-hidden="true">🛡️</span>{cu.licensedInfo}
            </button>
          </div>
        </div>
        </div>{/* /conversation column */}

        {/* Desktop: live Loan Strategy Profile aside */}
        {isWide && (
          <aside style={{ width: 390, flexShrink: 0, borderLeft: '1px solid #ddd7c9', background: '#f6f4ee', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16 }}>
            {profilePanel}
          </aside>
        )}
        </div>{/* /body row */}

        {/* Mobile: collapsible Loan Strategy Profile sheet */}
        {!isWide && profileOpenMobile && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: 'rgba(15,23,42,0.35)' }}>
            <div style={{ marginTop: 'auto', maxHeight: '88%', background: '#f6f4ee', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'white', borderBottom: '1px solid #ddd7c9' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#141414' }}>{su.profileTitle}</span>
                <button onClick={() => setProfileOpenMobile(false)} style={{ background: '#efece3', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: '#837f74' }}>✕</button>
              </div>
              <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16, paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
                {profilePanel}
              </div>
            </div>
          </div>
        )}
        {renderSheets()}
      </div>
    );
  }

  // ─── Capture / Summary (English — borrower-facing legal summary) ───
  const s = scenario || {};
  const checklist = buildDocumentChecklist(s);

  return (
    <div style={{ minHeight: '100dvh', background: '#f2efe7', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 4vw, 40px) clamp(12px, 3vw, 20px)' }}>
      <div className="fade-up" style={{ background: 'white', maxWidth: 520, width: '100%', boxShadow: '0 12px 56px rgba(20,20,20,0.14)', overflow: 'hidden', borderRadius: 12 }}>
        {/* Header */}
        <div style={{ background: '#141414', padding: 'clamp(24px, 4vw, 36px) clamp(20px, 4vw, 40px) clamp(20px, 3vw, 32px)', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', color: 'white', fontSize: 20 }}>✓</div>
          <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 22, fontWeight: 400, color: 'white', marginBottom: 6, letterSpacing: '0.01em' }}>Loan Strategy Summary</h2>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>{COMPANY_NAME}</p>
        </div>

        {/* Delivery failure banner */}
        {deliveryFailed && (
          <div style={{ background: '#f4efe1', borderBottom: '1px solid #d9cfb0', padding: '12px clamp(20px, 4vw, 40px)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <p style={{ fontSize: 12, color: '#6f5a2a', lineHeight: 1.5 }}>
              We couldn't deliver your scenario automatically. Please call our office at <a href={OFFICE_PHONE_HREF} style={{ color: '#6f5a2a', fontWeight: 600 }}>{OFFICE_PHONE}</a> to connect with a strategist.
            </p>
          </div>
        )}

        {/* Scenario fields */}
        <div style={{ padding: '4px clamp(20px, 4vw, 40px) 0' }}>
          {[
            ['Name', s.name], ['Phone', s.phone], ['Email', s.email],
            ['Loan Purpose', s.loanPurpose], ['State', s.state],
            ['Purchase Price', s.purchasePrice], ['Loan Amount', s.loanAmount],
            ['Down Payment', s.downPayment], ['Occupancy', s.occupancy],
            ['Property Type', s.propertyType], ['Credit Score', s.creditScore],
            ['Income Type', s.incomeType], ['Doc Type', s.docType],
            ['First-Time Buyer', s.firstTimeBuyer], ['Timeline', s.timeline],
            ['Concern', s.concern],
          ].filter(([, v]) => v && v !== 'not provided').map(([label, val], i, arr) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderBottom: i < arr.length - 1 ? '1px solid #e9e4d8' : 'none' }}>
              <span style={{ fontSize: 10, color: '#9a958a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', flexShrink: 0 }}>{label}</span>
              <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, color: '#141414', textAlign: 'right', maxWidth: '58%', lineHeight: 1.4 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Possible path */}
        {s.possiblePath && (
          <div style={{ margin: '20px clamp(20px, 4vw, 40px) 0' }}>
            <div style={{ borderLeft: '3px solid #141414', background: '#f2efe7', padding: '13px 16px' }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, color: '#141414', lineHeight: 1.75, fontStyle: 'italic' }}>
                Possible path: {s.possiblePath}
              </p>
            </div>
          </div>
        )}

        {/* Document checklist */}
        <div style={{ margin: '20px clamp(20px, 4vw, 40px) 0' }}>
          <p style={{ fontSize: 10, color: '#9a958a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Documents Likely Needed ({checklist.primaryLabel})
          </p>
          {checklist.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, color: '#6f6b62' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid #c7c2b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0 }}>☐</span>
              {item}
            </div>
          ))}
        </div>

        {/* Next steps */}
        <div style={{ padding: 'clamp(16px, 3vw, 24px) clamp(20px, 4vw, 40px) clamp(24px, 4vw, 40px)' }}>
          {confirmed ? (
            <div style={{ textAlign: 'center', paddingTop: 8 }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 21, color: '#141414', marginBottom: 10 }}>You're all set.</p>
              <p style={{ fontSize: 14, color: '#837f74', lineHeight: 1.75, marginBottom: 24 }}>
                A licensed strategist from {COMPANY_NAME} will reach out within 1 business hour.
              </p>
              <button
                onClick={() => { setScreen('chat'); resetSession(); }}
                style={{ background: 'none', color: '#141414', border: '1px solid #141414', padding: '10px 22px', fontSize: 13, cursor: 'pointer', fontWeight: 500, letterSpacing: '0.02em' }}
              >Start New Scenario</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#918c80', marginBottom: 14, textAlign: 'center', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>How would you like to proceed?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => { window.open('https://calendly.com/westccmortgage', '_blank'); setConfirmed(true); }}
                  style={{ background: '#141414', color: 'white', border: 'none', padding: 14, fontSize: 14, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.03em' }}
                >Schedule a Call</button>
                <button
                  onClick={() => setConfirmed(true)}
                  style={{ background: 'white', color: '#141414', border: '1.5px solid #141414', padding: 14, fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em' }}
                >I'll Wait for a Call</button>
              </div>
            </>
          )}
        </div>

        {/* Disclaimer + licensing */}
        <div style={{ padding: '16px clamp(20px, 4vw, 40px) 20px', borderTop: '1px solid #e9e4d8' }}>
          <p style={{ fontSize: 10, color: '#b3aea1', lineHeight: 1.6, textAlign: 'center' }}>{DISCLAIMER}</p>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e9e4d8', textAlign: 'center', fontSize: 10, color: '#918c80', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: '#837f74' }}>{COMPANY_NAME}</div>
            <div>{COMPANY_LICENSE} · Equal Housing Lender</div>
            <div style={{ marginTop: 6, fontWeight: 600, color: '#837f74' }}>{BROKER_NAME} · {BROKER_TITLE}</div>
            <div>{BROKER_LICENSE}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
