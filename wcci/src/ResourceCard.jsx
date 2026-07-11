import React from 'react';
import { getResource } from './lib/resources/site-registry.js';
import { track } from './lib/analytics.js';

// Contextual resource recommendation card. Renders a verified registry
// resource as a safe, clickable card — never a raw URL. Trust label, brand,
// one-sentence reason, accessible action button, safe target/rel.

const NAVY = '#0a2463';
const BLUE = '#2563eb';
const GOLD = '#b08d3a';
const LINE = '#e7ebf3';

// Category → localized trust label + accent.
const LABELS = {
  corporate_trust: { accent: NAVY, en: 'Company information', es: 'Información de la compañía', ru: 'Информация о компании' },
  state_mortgage: { accent: BLUE, en: 'State resource', es: 'Recurso estatal', ru: 'Региональный ресурс' },
  local_mortgage: { accent: BLUE, en: 'Local resource', es: 'Recurso local', ru: 'Локальный ресурс' },
  mortgage_education: { accent: '#0ea5e9', en: 'Education', es: 'Educación', ru: 'Обучение' },
  scenario_tool: { accent: '#7c3aed', en: 'Scenario tool', es: 'Herramienta de escenarios', ru: 'Инструмент сценариев' },
  secure_application: { accent: '#137a43', en: 'Secure application', es: 'Solicitud segura', ru: 'Защищённая заявка' },
  private_real_estate_capital: { accent: GOLD, en: 'Private capital', es: 'Capital privado', ru: 'Частный капитал' },
  investor_capital: { accent: GOLD, en: 'Investor information', es: 'Información para inversionistas', ru: 'Для инвесторов' },
  professional_network: { accent: '#475569', en: 'Professional network', es: 'Red profesional', ru: 'Профсеть' },
  digital_assets: { accent: '#7c3aed', en: 'Digital assets', es: 'Activos digitales', ru: 'Цифровые активы' },
  development_proof: { accent: GOLD, en: 'Development portfolio', es: 'Portafolio de desarrollo', ru: 'Портфолио девелопмента' },
  internal_platform: { accent: '#475569', en: 'Professional platform', es: 'Plataforma profesional', ru: 'Профессиональная платформа' },
};

const pick = (obj, lang) => (obj && (obj[lang] || obj.en)) || '';

export function ResourceCard({ rec, lang = 'en' }) {
  // `rec` is a validated recommendation: {id, url, brand, title, category, actionLabel, shortDescription, reason}
  const r = getResource(rec.id);
  if (!r) return null; // never render an unknown/unverified id
  const label = LABELS[rec.category] || LABELS.mortgage_education;
  const reason = rec.reason || pick(rec.shortDescription, lang);
  const host = (() => { try { return new URL(rec.url).hostname.replace(/^www\./, ''); } catch { return rec.brand; } })();

  return (
    <a
      href={rec.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={() => track('resource_clicked', { resourceId: rec.id, category: rec.category, reasonKey: rec.reasonKey })}
      style={{
        display: 'block', textDecoration: 'none', border: `1px solid ${LINE}`, borderLeft: `3px solid ${label.accent}`,
        borderRadius: 10, background: 'white', padding: '10px 12px', boxShadow: '0 1px 3px rgba(10,36,99,0.05)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 3px 10px rgba(10,36,99,0.10)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(10,36,99,0.05)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: label.accent }}>
          {pick(label, lang)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#9aa6b8' }}>{host} ↗</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>{r.brand}</div>
      <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.5, marginTop: 3 }}>{reason}</div>
      <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: BLUE }}>
        {pick(rec.actionLabel, lang)} <span aria-hidden="true">→</span>
      </div>
    </a>
  );
}

// A row of cards (used inline under an AI message and in the sidebar block).
export function ResourceCardList({ recs, lang = 'en', title }) {
  const list = (recs || []).slice(0, 3);
  if (!list.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {title && (
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: GOLD }}>{title}</div>
      )}
      {list.map(rec => <ResourceCard key={rec.id} rec={rec} lang={lang} />)}
    </div>
  );
}

export default ResourceCard;
