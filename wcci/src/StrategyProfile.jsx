import React, { useState } from 'react';
import { PROFILE_FIELDS, profileStatus, fieldFor } from './lib/scenarioProfile.js';
import { nextBestQuestion } from './lib/questionEngine.js';
import { evaluatePaths, STATUS } from './lib/strategyEngine.js';

// ── Design tokens (navy / slate / soft blue + subtle gold) ──
const NAVY = '#0a2463';
const SLATE = '#475569';
const BLUE = '#2563eb';
const GOLD = '#b08d3a';
const LINE = '#e7ebf3';

const money = (n) => (n == null || n === '' || isNaN(n)) ? '—'
  : '$' + Math.round(Number(n)).toLocaleString('en-US');
const pctText = (n) => (n == null ? '—' : `${n}%`);

const STATUS_STYLE = {
  [STATUS.STRONG]:      { bg: '#e9f7ef', fg: '#137a43', dot: '#1aa35a' },
  [STATUS.POSSIBLE]:    { bg: '#eaf1fe', fg: '#1d4ed8', dot: '#2563eb' },
  [STATUS.MORE_INFO]:   { bg: '#fbf3e2', fg: '#8a6d1b', dot: GOLD },
  [STATUS.HIGHER_RISK]: { bg: '#fdeee7', fg: '#b4531b', dot: '#e07a3a' },
  [STATUS.UNLIKELY]:    { bg: '#f1f3f7', fg: '#7a8598', dot: '#9aa6b8' },
};

function Pill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE[STATUS.MORE_INFO];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: s.bg, color: s.fg,
      borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />{status}
    </span>
  );
}

function ProgressBar({ percent }) {
  return (
    <div style={{ background: '#eef1f6', borderRadius: 20, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${percent}%`, height: '100%', borderRadius: 20,
        background: `linear-gradient(90deg, ${NAVY}, ${BLUE})`, transition: 'width 0.4s ease' }} />
    </div>
  );
}

const TIER_LABEL = { needed: 'Needed', helpful: 'Helpful', optional: 'Optional' };
const TIER_COLOR = { needed: '#c2410c', helpful: GOLD, optional: '#94a3b8' };

function FieldRow({ f, value }) {
  const filled = value !== undefined && value !== null && value !== '' && value !== 'unsure';
  const disp = f.type === 'money' ? money(value) : f.type === 'percent' ? pctText(value) : String(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: filled ? '#e9f7ef' : '#f1f3f7', color: filled ? '#1aa35a' : '#c3cad6', fontSize: 10, fontWeight: 700 }}>
          {filled ? '✓' : ''}
        </span>
        <span style={{ fontSize: 12.5, color: filled ? '#0f172a' : SLATE }}>{f.label}</span>
      </span>
      {filled
        ? <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, textAlign: 'right', maxWidth: '52%' }}>{disp}</span>
        : <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLOR[f.priority], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{TIER_LABEL[f.priority]}</span>}
    </div>
  );
}

function PathCard({ path }) {
  const [open, setOpen] = useState(false);
  const e = path.estimate;
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, marginBottom: 8, background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{path.label}</span>
        <Pill status={path.status} />
      </div>
      <p style={{ fontSize: 12, color: SLATE, lineHeight: 1.5, margin: '6px 0 0' }}>{path.why}</p>
      {e && (
        <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
          <div><div style={{ fontSize: 9.5, color: '#9aa6b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Est. payment</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{money(e.monthlyPayment)}<span style={{ fontSize: 10, color: '#9aa6b8', fontWeight: 500 }}>/mo</span></div></div>
          <div><div style={{ fontSize: 9.5, color: '#9aa6b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Est. cash to close</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{money(e.estimatedCashToClose)}</div></div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} style={{ marginTop: 8, background: 'none', border: 'none', color: BLUE, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? 'Hide details ▲' : 'Why / documents / risks ▼'}
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: SLATE, lineHeight: 1.6 }}>
          {path.missingData.length > 0 && <Detail label="Missing data" items={path.missingData.map(k => (fieldFor(k)?.label || k))} />}
          {path.documentation.length > 0 && <Detail label="Documentation" items={path.documentation} />}
          {path.risks.length > 0 && <Detail label="Major risks" items={path.risks} />}
          <KV k="PMI / MI risk" v={path.pmiRisk} />
          <KV k="Pricing risk" v={path.pricingRisk} />
          <KV k="Reserves" v={path.reserveNote} />
        </div>
      )}
    </div>
  );
}
function Detail({ label, items }) {
  return <div style={{ marginBottom: 5 }}>
    <span style={{ fontWeight: 700, color: '#334155' }}>{label}: </span>{items.join(' · ')}
  </div>;
}
function KV({ k, v }) {
  return <div style={{ marginBottom: 3 }}><span style={{ fontWeight: 700, color: '#334155' }}>{k}: </span>{v}</div>;
}

function CashToClose({ e }) {
  if (!e) return null;
  const rows = [
    ['Down payment', e.downPayment],
    ['Points', e.pointsAmount], ['Originator comp', e.originatorComp], ['Application fee', e.applicationFee],
    ['Title / escrow (est.)', e.titleEscrowFees], ['Third-party (est.)', e.thirdPartyFees],
    ['Government fees (est.)', e.governmentFees], ['Prepaid interest', e.prepaidInterest],
    ['Escrow reserves', e.escrowReserves],
  ];
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, background: '#fafbfd' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>Estimated cash to close</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{money(e.estimatedCashToClose)}</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11.5, color: SLATE }}>
          <span>{k}</span><span style={{ fontWeight: 600, color: '#334155' }}>{money(v)}</span>
        </div>
      ))}
      {e.sellerCredits > 0 && <CreditRow k="Seller credits" v={e.sellerCredits} />}
      {e.lenderCredits > 0 && <CreditRow k="Lender credits" v={e.lenderCredits} />}
      <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color: GOLD, fontWeight: 700 }}>Extra above down payment</span>
        <span style={{ fontWeight: 700, color: GOLD }}>{money(e.extraFundsAboveDownPayment)}</span>
      </div>
      <p style={{ fontSize: 9.5, color: '#9aa6b8', lineHeight: 1.5, marginTop: 8 }}>
        Estimated, based on planning assumptions (incl. an assumed rate) — not a quote, Loan Estimate, or commitment. Actual figures vary by lender, profile, property, and closing date.
      </p>
    </div>
  );
}
function CreditRow({ k, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11.5, color: '#137a43' }}>
    <span>{k}</span><span style={{ fontWeight: 600 }}>−{money(v)}</span>
  </div>;
}

function LeadCapture({ profile, onSubmit, sent, t }) {
  const [name, setName] = useState(profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [email, setEmail] = useState(profile.email || '');
  const [busy, setBusy] = useState(false);
  const canSend = name.trim() && (phone.trim() || email.trim());

  if (sent) {
    return (
      <div style={{ background: '#e9f7ef', border: '1px solid #b9e6cc', borderRadius: 10, padding: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 20, marginBottom: 4 }}>✓</div>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#137a43' }}>{t.leadSentTitle}</p>
        <p style={{ fontSize: 12, color: SLATE, marginTop: 4 }}>{t.leadSentBody}</p>
      </div>
    );
  }
  const inp = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px', fontSize: 13, marginBottom: 7, fontFamily: 'inherit', color: '#0f172a', background: 'white' };
  return (
    <div style={{ background: 'white', border: `1px solid ${GOLD}33`, borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 3 }}>{t.leadTitle}</p>
      <p style={{ fontSize: 11.5, color: SLATE, marginBottom: 10, lineHeight: 1.5 }}>{t.leadSub}</p>
      <input style={inp} placeholder={t.leadName} value={name} onChange={e => setName(e.target.value)} />
      <input style={inp} placeholder={t.leadPhone} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" />
      <input style={inp} placeholder={t.leadEmail} value={email} onChange={e => setEmail(e.target.value)} inputMode="email" />
      <button
        disabled={!canSend || busy}
        onClick={async () => { setBusy(true); await onSubmit({ name: name.trim(), phone: phone.trim(), email: email.trim() }); setBusy(false); }}
        style={{ width: '100%', marginTop: 4, background: canSend ? `linear-gradient(135deg, ${NAVY}, ${BLUE})` : '#cbd5e1',
          color: 'white', border: 'none', borderRadius: 8, padding: '11px', fontSize: 13.5, fontWeight: 700, cursor: canSend ? 'pointer' : 'default' }}
      >{busy ? '…' : t.leadCta}</button>
    </div>
  );
}

// ── Main panel ──
export default function StrategyProfile({ profile, onSubmitLead, leadSent, onManualToggle, manualOpen, t, embedded }) {
  const status = profileStatus(profile);
  const strat = status.hasCoreScenario ? evaluatePaths(profile) : null;
  const topEstimate = strat && strat.topPaths[0] ? strat.topPaths[0].estimate : (strat && strat.paths[0] ? strat.paths[0].estimate : null);
  const nextQ = nextBestQuestion(profile);
  const valueShown = !!strat; // value delivered once we can show possible paths

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Completion */}
      <div style={{ background: 'white', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{t.profileTitle}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: BLUE }}>{status.percent}%</span>
        </div>
        <ProgressBar percent={status.percent} />
        {nextQ && (
          <div style={{ marginTop: 10, background: '#f7f9fc', borderRadius: 8, padding: '9px 11px' }}>
            <div style={{ fontSize: 9.5, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 2 }}>{t.nextQuestion}</div>
            <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.45 }}>{nextQ.text}</div>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {PROFILE_FIELDS.filter(f => !f.contact).map(f => <FieldRow key={f.key} f={f} value={profile[f.key]} />)}
        </div>
        <button onClick={onManualToggle} style={{ marginTop: 10, background: 'none', border: 'none', color: BLUE, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          {manualOpen ? t.manualHide : t.manualOpen}
        </button>
      </div>

      {/* Strategy paths */}
      {strat ? (
        <div style={{ background: 'white', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 3 }}>{t.pathsTitle}</div>
          <p style={{ fontSize: 11, color: '#9aa6b8', marginBottom: 10 }}>{t.pathsSub}</p>
          {strat.paths.filter(p => p.status !== STATUS.UNLIKELY).map(p => <PathCard key={p.id} path={p} />)}
        </div>
      ) : (
        <div style={{ background: '#f7f9fc', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 12.5, color: SLATE, lineHeight: 1.5 }}>{t.pathsLocked}</p>
        </div>
      )}

      {/* Cash to close */}
      {topEstimate && <CashToClose e={topEstimate} />}

      {/* Lead capture — only after value is shown */}
      {valueShown && <LeadCapture profile={profile} onSubmit={onSubmitLead} sent={leadSent} t={t} />}
    </div>
  );
}
