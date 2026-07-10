import React from 'react';
import { PROFILE_FIELDS } from './lib/scenarioProfile.js';

// Structured manual-entry fallback — "Prefer to enter details manually?"
// Edits the same Scenario Profile the AI conversation fills, so the two modes
// stay in sync. Derived fields (loan amount, LTV) are read-only.

const NAVY = '#0a2463';
const LINE = '#e7ebf3';

export default function ManualForm({ profile, onChange, t }) {
  const set = (key, val) => onChange({ [key]: val });
  const editable = PROFILE_FIELDS.filter(f => !f.derived);

  const inp = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', color: '#0f172a', background: 'white' };

  return (
    <div style={{ background: 'white', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{t.manualTitle}</div>
      <p style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12 }}>{t.manualSub}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {editable.map(f => (
          <label key={f.key} style={{ display: 'block' }}>
            <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>{f.label}</span>
            {f.type === 'enum' ? (
              <select style={inp} value={profile[f.key] || ''} onChange={e => set(f.key, e.target.value || undefined)}>
                <option value="">—</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                style={inp}
                type={f.type === 'money' || f.type === 'number' ? 'number' : 'text'}
                inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : undefined}
                value={profile[f.key] != null ? profile[f.key] : ''}
                onChange={e => {
                  const v = e.target.value;
                  set(f.key, v === '' ? undefined : (f.type === 'money' || f.type === 'number' ? Number(v) : v));
                }}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
