// TEST 15 — multilingual behavior. The trust and contact-refusal scenarios must
// work identically in English, Spanish, and Russian: detectors fire, consent
// sticks, routing is language-independent, and resource cards localize.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialConversationState, updateStateFromUserMessage } from '../src/lib/conversationIntelligence.js';
import { routeResources } from '../src/lib/resources/resource-router.js';
import { getResource } from '../src/lib/resources/site-registry.js';

// Trust scenario in each language (Florida identity + privacy).
const TRUST = {
  en: ["I'm buying in Boca Raton, Florida", "I don't want every lender calling me", 'Who are you people? Where can I read about the company?'],
  es: ['Estoy comprando en Boca Raton, Florida', 'No quiero que todos los prestamistas me llamen', '¿Quiénes son ustedes? ¿Dónde puedo leer sobre la empresa real?'],
  ru: ['Я покупаю дом в Boca Raton, Флорида', 'Не хочу, чтобы все кредиторы мне звонили', 'Кто вы такие? Где почитать о компании?'],
};

// Contact refusal in each language.
const REFUSAL = {
  en: "I'm not giving you my information",
  es: 'No voy a dar mis datos',
  ru: 'Я не дам вам свои данные, не звоните мне',
};

for (const lang of ['en', 'es', 'ru']) {
  test(`[${lang}] trust scenario detects identity/privacy + declines, routes to FL trust resources`, () => {
    let s = initialConversationState();
    for (const m of TRUST[lang]) s = updateStateFromUserMessage(s, m, { state: 'FL' }, lang);
    assert.equal(s.language, lang, 'language persisted');
    assert.ok(s.objections.includes('identity'), 'identity objection detected');
    assert.ok(s.objections.includes('privacy'), 'privacy objection detected');
    assert.equal(s.stage, 'trust_building');
    const r = routeResources({ audience: s.audience, state: s.state, city: s.city, county: s.county, topics: s.topics, objections: s.objections, stage: s.stage });
    const ids = r.candidates.map(c => c.id);
    assert.ok(ids.includes('suncoast-about'), 'Florida About routed');
    assert.ok(ids.includes('wccm-about'), 'corporate About routed');
    assert.ok(!ids.includes('kwest-home'), 'no Keys resource for Boca Raton');
  });

  test(`[${lang}] contact refusal → sticky declined`, () => {
    let s = initialConversationState();
    s = updateStateFromUserMessage(s, REFUSAL[lang], {}, lang);
    assert.equal(s.contactConsent, 'declined', `${lang} refusal recognized`);
    s = updateStateFromUserMessage(s, 'ok', {}, lang);
    assert.equal(s.contactConsent, 'declined', 'stays declined');
  });

  test(`[${lang}] resource cards localize (label + description + reason exist)`, () => {
    const r = getResource('suncoast-about');
    assert.ok(r.actionLabel[lang] && r.actionLabel[lang].length > 0, 'localized action label');
    assert.ok(r.shortDescription[lang] && r.shortDescription[lang].length > 0, 'localized description');
  });
}

// Legal license identifiers must never be translated — they stay as-is in every language.
test('license identifiers are language-independent', () => {
  const r = getResource('nmls-consumer-access');
  for (const lang of ['en', 'es', 'ru']) {
    assert.ok(/2817729/.test(r.shortDescription[lang]), `${lang} keeps company NMLS number`);
    assert.ok(/2775380/.test(r.shortDescription[lang]), `${lang} keeps broker NMLS number`);
  }
});
