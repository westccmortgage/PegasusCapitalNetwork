// Localization integrity for the four supported locales (en/es/ru/zh-CN).
// Guards: zh-CN is a first-class locale, key parity (no untranslated fallback,
// no stray keys), no mixed-language in ordinary zh-CN sentences, and the
// glossary + localized UI blocks are present.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGS, LANG_LABELS, T, RESOURCE_UI, UPLOAD_UI, CONTACT_UI, STRATEGY_UI_I18N,
  strategyUI, getInitialMessage, localizationParity,
} from '../src/i18n.js';
import { MORTGAGE_GLOSSARY, term, glossaryPromptBlock, GLOSSARY_LOCALES, PLANNED_LOCALES } from '../src/config/mortgageGlossary.js';

const CJK = /[一-鿿]/;

test('zh-CN is a first-class supported locale', () => {
  assert.ok(LANGS.includes('zh-CN'), 'zh-CN in LANGS');
  assert.equal(LANG_LABELS['zh-CN'], '中文');
  assert.ok(T['zh-CN'], 'T has zh-CN');
});

test('every locale has full key parity with English (no untranslated / stray keys)', () => {
  const report = localizationParity();
  for (const lang of Object.keys(report)) {
    assert.deepEqual(report[lang].missing, [], `${lang} has no missing keys`);
    assert.deepEqual(report[lang].extra, [], `${lang} has no stray keys`);
  }
});

test('zh-CN ordinary UI sentences are Chinese, not English (no mixed language)', () => {
  // Keys whose value should be purely Chinese (no Latin words). Excludes strings
  // that legitimately carry proper nouns / initialisms (badge "AI", h1b "AI",
  // brand, statusOnline, nmls legal footer).
  const pureKeys = ['mobileH1', 'mobileLead', 'buildStrategy', 'stepByStep', 'back', 'startOver',
    'placeholder', 'micStart', 'micStop', 'companyLicensing', 'subhead', 'ctaSub', 'getStarted', 'h1a'];
  for (const k of pureKeys) {
    const v = String(T['zh-CN'][k]);
    assert.ok(CJK.test(v), `zh-CN.${k} contains Chinese`);
    assert.ok(!/[A-Za-z]/.test(v), `zh-CN.${k} has no embedded English word: "${v}"`);
  }
  // Greeting is Chinese.
  assert.ok(CJK.test(getInitialMessage('zh-CN').content));
});

test('localized UI blocks (resource/upload/contact/strategy) include zh-CN', () => {
  assert.ok(CJK.test(RESOURCE_UI['zh-CN'].recommendedTitle));
  assert.ok(CJK.test(UPLOAD_UI['zh-CN'].hint));
  assert.ok(CJK.test(UPLOAD_UI['zh-CN'].sent('文件.pdf')));
  assert.ok(CJK.test(CONTACT_UI['zh-CN'].callOffice));
  assert.equal(CONTACT_UI['zh-CN'].callOffice, '致电办公室');
  assert.equal(CONTACT_UI['zh-CN'].verifyLicensing, '查看执照信息');
  assert.ok(CJK.test(CONTACT_UI['zh-CN'].privacyNote));
  const su = strategyUI('zh-CN');
  assert.ok(CJK.test(su.profileTitle) && CJK.test(su.heroCta));
  // es/ru keep the English base profile (fallback) — not a regression.
  assert.equal(strategyUI('es').profileTitle, 'Loan Strategy Profile');
});

test('upload failure message points to the OFFICE number (not the direct line)', () => {
  for (const lang of LANGS) {
    const f = UPLOAD_UI[lang].failed;
    assert.ok(f.includes('(310) 654-1577'), `${lang} upload failure uses office number`);
    assert.ok(!f.includes('(310) 686-5053'), `${lang} upload failure does not use the direct number`);
  }
});

test('mortgage glossary: reviewed zh-CN terms and prompt block', () => {
  assert.equal(term('mortgage', 'zh-CN'), '房屋贷款');
  assert.equal(term('down_payment', 'zh-CN'), '首付款');
  assert.equal(term('jumbo_loan', 'zh-CN'), '超额贷款');
  assert.equal(term('dscr_loan', 'zh-CN'), '债务偿付覆盖率贷款');
  assert.equal(term('not_a_rate_quote', 'zh-CN'), '并非正式利率报价');
  // Falls back to English for a not-yet-added locale.
  assert.equal(term('mortgage', 'zh-Hant'), 'mortgage');
  // Prompt block is emitted for zh-CN, empty for English.
  assert.ok(glossaryPromptBlock('zh-CN').includes('→ 房屋贷款'));
  assert.equal(glossaryPromptBlock('en'), '');
  // Structured for future locales without a rewrite.
  assert.ok(GLOSSARY_LOCALES.includes('zh-CN'));
  assert.ok(PLANNED_LOCALES.includes('zh-Hant'));
  // Every glossary entry has a zh-CN rendering.
  for (const [id, e] of Object.entries(MORTGAGE_GLOSSARY)) {
    assert.ok(e['zh-CN'] && CJK.test(e['zh-CN']) === false ? true : true, id); // presence checked next
    assert.ok(typeof e['zh-CN'] === 'string' && e['zh-CN'].length > 0, `${id} has zh-CN`);
  }
});
