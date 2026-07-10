import React, { useState, useEffect, useRef } from 'react';
import { SYSTEM_PROMPT, langDirective, localeFor } from './systemPrompt.js';
import { T, LANGS, DISCLAIMER, STRATEGY_DISCLAIMER, STRATEGY_UI, getInitialMessage } from './i18n.js';
import { parseScenario } from './lib/parser.js';
import { mergeProfile, profileStatus } from './lib/scenarioProfile.js';
import { evaluatePaths } from './lib/strategyEngine.js';
import { buildLead, submitLead } from './lib/leadAdapter.js';
import StrategyProfile from './StrategyProfile.jsx';
import ManualForm from './ManualForm.jsx';

function hasContactInfo(messages) {
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  return /[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i.test(userText) ||
    /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/.test(userText);
}

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

export default function App() {
  const [saved] = useState(loadSession);
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('wcci-lang') || 'en'; } catch { return 'en'; }
  });
  const [screen, setScreen] = useState(saved?.screen || 'landing');
  const [messages, setMessages] = useState(() => saved?.messages?.length ? saved.messages : [getInitialMessage(lang)]);
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
  const [winWidth, setWinWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const micTokenRef = useRef(0);
  const micActiveRef = useRef(false);   // true while the user wants the mic on
  const micBaseRef = useRef('');        // text already committed before current recognition run

  const t = T[lang] || T.en;
  const su = STRATEGY_UI;
  const speechSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const isWide = winWidth >= 900;

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (screen === 'chat') setTimeout(() => inputRef.current?.focus(), 200);
  }, [screen]);

  // Resume-later: persist the session so a returning visitor picks up where they left off.
  const sessionRef = useRef(null);
  useEffect(() => {
    const snapshot = { messages, scenario, confirmed, screen, partialLeadCount, profile, leadSent };
    sessionRef.current = snapshot;
    try {
      localStorage.setItem('wcci-session', JSON.stringify(snapshot));
    } catch {}
  }, [messages, scenario, confirmed, screen, partialLeadCount, profile, leadSent]);

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
  // mic on (micActiveRef). Finalized phrases are appended to micBaseRef so the
  // text accumulates instead of being overwritten on each restart.
  function launchRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !micActiveRef.current) return;
    const rec = new SR();
    const token = ++micTokenRef.current;
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
      if (finalTxt) micBaseRef.current = (micBaseRef.current + finalTxt).replace(/\s+/g, ' ');
      setInput((micBaseRef.current + interimTxt).replace(/\s+/g, ' ').trim());
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
      // If the user still wants the mic on, immediately start a new run.
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
    setScreen('chat');
    try { localStorage.removeItem('wcci-session'); } catch {}
  }

  // Merge freeform text into the live Scenario Profile (client-side parser).
  function absorbIntoProfile(text) {
    const parsed = parseScenario(text);
    if (Object.keys(parsed).length) setProfile(prev => mergeProfile(prev, parsed));
  }

  // Manual-form / direct edits into the profile.
  function updateProfile(patch) {
    setProfile(prev => mergeProfile(prev, patch));
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

  // Value-first lead capture from the Strategy Profile panel.
  async function handleSubmitLead(contact) {
    const merged = mergeProfile(profile, contact);
    setProfile(merged);
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
    try {
      await submitLead(lead, { messages: messages.map(m => ({ role: m.role, content: m.content })) });
    } catch {}
    setLeadSent(true);
    return true;
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    if (listening) stopMic();
    micBaseRef.current = '';
    setInput('');
    setLoading(true);
    absorbIntoProfile(text);
    const updated = [...messages, { role: 'user', content: text }];
    setMessages(updated);

    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT + langDirective(lang),
          messages: updated.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const fullText = (data.content || []).map(b => b.text || '').join('') || 'Connection error. Please try again.';

      let displayText = fullText;
      let parsedScenario = null;

      if (fullText.includes('SCENARIO_COMPLETE:')) {
        const parts = fullText.split('SCENARIO_COMPLETE:');
        try {
          parsedScenario = JSON.parse(parts[1].split('\n')[0].trim());
        } catch {}
        displayText = (parts[0].trim() + (parts[1].includes('\n') ? '\n' + parts[1].split('\n').slice(1).join('\n') : '')).trim();
      }

      const reply = { role: 'assistant', content: displayText };
      const final = [...updated, reply];
      setMessages(final);

      if (data._leadDelivery && !data._leadDelivery.anyDelivered) setDeliveryFailed(true);

      if (parsedScenario) {
        setScenario(parsedScenario);
        setTimeout(() => setScreen('capture'), 1800);
      } else if (hasContactInfo(final) && partialLeadCount < 2) {
        setPartialLeadCount(c => c + 1);
        fetch('/.netlify/functions/partial-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: final.map(m => ({ role: m.role, content: m.content })),
            updateNumber: partialLeadCount + 1,
          }),
        }).catch(() => {});
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please refresh and try again.' }]);
    }
    setLoading(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function LangSwitch({ dark }) {
    return (
      <div style={{ display: 'flex', gap: 2, background: dark ? 'rgba(255,255,255,0.12)' : '#f1f5f9', borderRadius: 8, padding: 2 }}>
        {LANGS.map(l => {
          const active = l === lang;
          return (
            <button
              key={l}
              onClick={() => changeLang(l)}
              style={{
                border: 'none', borderRadius: 6, padding: '5px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: active ? (dark ? 'white' : '#2563eb') : 'transparent',
                color: active ? (dark ? '#0f172a' : 'white') : (dark ? 'rgba(255,255,255,0.8)' : '#64748b'),
                transition: 'all 0.15s',
              }}
            >{l.toUpperCase()}</button>
          );
        })}
      </div>
    );
  }

  // ─── Landing ───
  if (screen === 'landing') {
    return (
      <div style={{ minHeight: 'calc(100vh - env(safe-area-inset-bottom, 0px))', background: '#f8fafc', fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #2563eb, #7c3aed, #0ea5e9)' }} />

        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.95)', borderBottom: '1px solid #e2e8f0', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 100 }}>
          <a href="https://wcci.online" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>W</div>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <LangSwitch />
            <a href="tel:+13106865053" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>(310) 686-5053</a>
            <button onClick={() => setScreen('chat')} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t.getStarted}</button>
          </div>
        </nav>

        <div style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(40px, 10vw, 88px) clamp(16px, 4vw, 40px) clamp(40px, 8vw, 80px)', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 20, padding: '6px 14px', marginBottom: 28 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 500 }}>{t.badge}</span>
          </div>

          <h1 style={{ fontSize: 'clamp(32px, 7vw, 70px)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: 20 }}>
            {t.h1a}<br />
            <span style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{t.h1b}</span>
          </h1>

          <p style={{ fontSize: 'clamp(15px, 2vw, 18px)', color: '#475569', lineHeight: 1.75, maxWidth: 520, margin: '0 auto 36px', padding: '0 8px' }}>
            {t.subhead}
          </p>

          {/* AI-first natural-language input */}
          <div style={{ maxWidth: 620, margin: '0 auto', background: 'white', border: '1px solid #dfe6f2', borderRadius: 16, boxShadow: '0 12px 40px rgba(10,36,99,0.10)', padding: 'clamp(14px, 3vw, 20px)', textAlign: 'left' }}>
            <textarea
              value={heroInput}
              onChange={e => setHeroInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); analyzeScenario(heroInput); } }}
              placeholder={su.heroPlaceholder}
              rows={3}
              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', fontSize: 15, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55, color: '#0f172a', background: '#fafbfd', minHeight: 84 }}
            />
            <button
              onClick={() => analyzeScenario(heroInput)}
              disabled={!heroInput.trim()}
              style={{ width: '100%', marginTop: 12, background: heroInput.trim() ? 'linear-gradient(135deg, #0a2463, #2563eb)' : '#cbd5e1', color: 'white', border: 'none', borderRadius: 12, padding: '15px', fontSize: 16, fontWeight: 700, cursor: heroInput.trim() ? 'pointer' : 'default', boxShadow: heroInput.trim() ? '0 4px 20px rgba(37,99,235,0.30)' : 'none', transition: 'all 0.15s' }}
            >{su.heroCta}</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {su.heroChips.map((chip, i) => (
                <button key={i} onClick={() => analyzeScenario(chip)}
                  style={{ background: '#f1f5fb', border: '1px solid #e2e8f0', color: '#334155', borderRadius: 18, padding: '7px 12px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#e8eef9'; e.currentTarget.style.borderColor = '#c7d2fe'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f1f5fb'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                >{chip}</button>
              ))}
            </div>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: '#94a3b8' }}>{t.ctaSub}</p>
          <p style={{ marginTop: 6, fontSize: 12.5, color: '#94a3b8' }}>
            <button onClick={() => { setScreen('chat'); setManualOpen(true); }} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: 12.5, padding: 0 }}>{su.manualOpen}</button>
          </p>

          {/* Demo chat preview */}
          <div style={{ marginTop: 48, background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.08)', padding: 'clamp(14px, 3vw, 24px)', maxWidth: 540, margin: '48px auto 0', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>AI</div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loan Strategy AI</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />Online
              </span>
            </div>
            {t.demo.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.ai ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                <div style={{ background: msg.ai ? '#f8fafc' : 'linear-gradient(135deg, #2563eb, #7c3aed)', color: msg.ai ? '#334155' : 'white', border: msg.ai ? '1px solid #e2e8f0' : 'none', borderRadius: msg.ai ? '4px 12px 12px 12px' : '12px 4px 12px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.6, maxWidth: '82%' }}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div style={{ background: 'white', borderTop: '1px solid #e2e8f0', padding: 'clamp(40px, 8vw, 72px) clamp(16px, 4vw, 40px)' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 20 }}>
            {t.features.map((f, i) => (
              <div key={i} style={{ padding: 'clamp(18px, 3vw, 28px)', borderRadius: 12, border: '1px solid #f1f5f9', background: '#fafafa' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: f.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 14 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer (English, legal) */}
        <div style={{ background: '#f8fafc', padding: '24px clamp(16px, 4vw, 40px)', borderTop: '1px solid #e2e8f0' }}>
          <p style={{ maxWidth: 800, margin: '0 auto', fontSize: 11, color: '#94a3b8', lineHeight: 1.7, textAlign: 'center' }}>{DISCLAIMER}</p>
        </div>

        <footer style={{ textAlign: 'center', padding: '24px clamp(16px, 4vw, 40px)', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8' }}>
          © 2026 West Coast Capital Mortgage · <a href="https://wcci.online" style={{ color: '#94a3b8' }}>wcci.online</a> · NMLS #2817729 · Equal Housing Lender
        </footer>
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
        <p style={{ fontSize: 10, color: '#9aa6b8', lineHeight: 1.6, padding: '0 2px' }}>{STRATEGY_DISCLAIMER}</p>
      </div>
    );

    return (
      <div style={{ height: 'calc(100vh - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>
        {/* Chat header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'white', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={() => setScreen('landing')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: '4px 8px' }}>{t.back}</button>
            {messages.length > 1 && (
              <button onClick={resetSession} style={{ background: 'none', border: '1px solid #e2e8f0', color: '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6 }}>{t.startOver}</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>AI</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Loan Strategy AI</div>
              <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />{t.statusOnline}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isWide && (
              <button onClick={() => setProfileOpenMobile(true)}
                style={{ background: 'linear-gradient(135deg, #0a2463, #2563eb)', color: 'white', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {su.profileTitle.split(' ')[0]} · {pstatus.percent}%
              </button>
            )}
            <LangSwitch />
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
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>AI</div>
              )}
              <div style={{
                background: msg.role === 'user' ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'white',
                color: msg.role === 'user' ? 'white' : '#1e293b',
                border: msg.role === 'assistant' ? '1px solid #e2e8f0' : 'none',
                borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                padding: '10px 14px', fontSize: 14, lineHeight: 1.65, maxWidth: '82%',
                boxShadow: msg.role === 'assistant' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              }}>
                {msg.content.split('\n').map((line, j, arr) => (
                  <span key={j}>{renderBold(line)}{j < arr.length - 1 && <br />}</span>
                ))}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>AI</div>
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px 16px 16px 16px', padding: '12px 16px', display: 'flex', gap: 5, alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {[0, 0.2, 0.4].map((d, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block', animation: `pulse 1.2s ease-in-out ${d}s infinite` }} />
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
                style={{ background: 'white', border: '1px solid #c7d2fe', color: '#2563eb', borderRadius: 18, padding: '7px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
              >{chip}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ background: 'white', borderTop: '1px solid #e2e8f0', padding: '10px 12px', paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))', flexShrink: 0 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.placeholder}
              rows={1}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 22, padding: '10px 16px', fontSize: 15, resize: 'none', fontFamily: "'Inter', sans-serif", lineHeight: 1.5, color: '#0f172a', background: '#f8fafc', transition: 'border-color 0.2s, box-shadow 0.2s', minHeight: 44 }}
            />
            {speechSupported && (
              <button
                onClick={toggleMic}
                title={listening ? t.micStop : t.micStart}
                aria-label={listening ? t.micStop : t.micStart}
                style={{ width: 44, height: 44, background: listening ? '#ef4444' : '#f1f5f9', border: listening ? 'none' : '1px solid #e2e8f0', borderRadius: 22, color: listening ? 'white' : '#64748b', fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: listening ? 'pulse 1.4s ease-in-out infinite' : 'none' }}
              >🎤</button>
            )}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{ width: 44, height: 44, background: input.trim() ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : '#e2e8f0', border: 'none', borderRadius: 22, color: 'white', fontSize: 18, cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >→</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 10, color: '#cbd5e1', marginTop: 6, marginBottom: 0 }}>{t.nmls}</p>
        </div>
        </div>{/* /conversation column */}

        {/* Desktop: live Loan Strategy Profile aside */}
        {isWide && (
          <aside style={{ width: 390, flexShrink: 0, borderLeft: '1px solid #e2e8f0', background: '#f4f6fb', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16 }}>
            {profilePanel}
          </aside>
        )}
        </div>{/* /body row */}

        {/* Mobile: collapsible Loan Strategy Profile sheet */}
        {!isWide && profileOpenMobile && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: 'rgba(15,23,42,0.35)' }}>
            <div style={{ marginTop: 'auto', maxHeight: '88%', background: '#f4f6fb', borderRadius: '18px 18px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0a2463' }}>{su.profileTitle}</span>
                <button onClick={() => setProfileOpenMobile(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', color: '#64748b' }}>✕</button>
              </div>
              <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16, paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
                {profilePanel}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Capture / Summary (English — borrower-facing legal summary) ───
  const s = scenario || {};
  const checklist = buildDocumentChecklist(s);

  return (
    <div style={{ minHeight: '100vh', background: '#eef0f4', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 4vw, 40px) clamp(12px, 3vw, 20px)' }}>
      <div className="fade-up" style={{ background: 'white', maxWidth: 520, width: '100%', boxShadow: '0 12px 56px rgba(10,36,99,0.14)', overflow: 'hidden', borderRadius: 12 }}>
        {/* Header */}
        <div style={{ background: '#0a2463', padding: 'clamp(24px, 4vw, 36px) clamp(20px, 4vw, 40px) clamp(20px, 3vw, 32px)', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', color: 'white', fontSize: 20 }}>✓</div>
          <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 22, fontWeight: 400, color: 'white', marginBottom: 6, letterSpacing: '0.01em' }}>Loan Strategy Summary</h2>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>West Coast Capital Mortgage</p>
        </div>

        {/* Delivery failure banner */}
        {deliveryFailed && (
          <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '12px clamp(20px, 4vw, 40px)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <p style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
              We couldn't deliver your scenario automatically. Please call <a href="tel:+13106865053" style={{ color: '#92400e', fontWeight: 600 }}>(310) 686-5053</a> to connect with a strategist.
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
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderBottom: i < arr.length - 1 ? '1px solid #f0f2f6' : 'none' }}>
              <span style={{ fontSize: 10, color: '#9aa3b2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', flexShrink: 0 }}>{label}</span>
              <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, color: '#0a2463', textAlign: 'right', maxWidth: '58%', lineHeight: 1.4 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Possible path */}
        {s.possiblePath && (
          <div style={{ margin: '20px clamp(20px, 4vw, 40px) 0' }}>
            <div style={{ borderLeft: '3px solid #0a2463', background: '#f7f8fc', padding: '13px 16px' }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, color: '#0a2463', lineHeight: 1.75, fontStyle: 'italic' }}>
                Possible path: {s.possiblePath}
              </p>
            </div>
          </div>
        )}

        {/* Document checklist */}
        <div style={{ margin: '20px clamp(20px, 4vw, 40px) 0' }}>
          <p style={{ fontSize: 10, color: '#9aa3b2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Documents Likely Needed ({checklist.primaryLabel})
          </p>
          {checklist.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, color: '#475569' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0 }}>☐</span>
              {item}
            </div>
          ))}
        </div>

        {/* Next steps */}
        <div style={{ padding: 'clamp(16px, 3vw, 24px) clamp(20px, 4vw, 40px) clamp(24px, 4vw, 40px)' }}>
          {confirmed ? (
            <div style={{ textAlign: 'center', paddingTop: 8 }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 21, color: '#0a2463', marginBottom: 10 }}>You're all set.</p>
              <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.75, marginBottom: 24 }}>
                A licensed strategist from West Coast Capital will reach out within 1 business hour.
              </p>
              <button
                onClick={() => { setScreen('chat'); resetSession(); }}
                style={{ background: 'none', color: '#0a2463', border: '1px solid #0a2463', padding: '10px 22px', fontSize: 13, cursor: 'pointer', fontWeight: 500, letterSpacing: '0.02em' }}
              >Start New Scenario</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#8a94a6', marginBottom: 14, textAlign: 'center', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>How would you like to proceed?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => { window.open('https://calendly.com/westccmortgage', '_blank'); setConfirmed(true); }}
                  style={{ background: '#0a2463', color: 'white', border: 'none', padding: 14, fontSize: 14, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.03em' }}
                >Schedule a Call</button>
                <button
                  onClick={() => setConfirmed(true)}
                  style={{ background: 'white', color: '#0a2463', border: '1.5px solid #0a2463', padding: 14, fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em' }}
                >I'll Wait for a Call</button>
              </div>
            </>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ padding: '16px clamp(20px, 4vw, 40px) 20px', borderTop: '1px solid #f0f2f6' }}>
          <p style={{ fontSize: 10, color: '#b0b8c9', lineHeight: 1.6, textAlign: 'center' }}>{DISCLAIMER}</p>
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
