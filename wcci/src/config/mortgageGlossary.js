// ─────────────────────────────────────────────────────────────────────────────
// CENTRALIZED MORTGAGE GLOSSARY — professionally-reviewed terminology.
//
// One place for mortgage terms so translations stay consistent everywhere
// (prompts, UI, resource cards, estimates). Keyed by a stable English term id,
// each entry maps a locale → the reviewed term. Structured so Traditional
// Chinese ("zh-Hant") — or any future locale — is added by filling one more key,
// NOT by rewriting call sites.
//
// These are reviewed for NATURAL mortgage usage, not literal word-for-word
// translation. Company names, legal identifiers (NMLS, DRE), URLs, and proper
// names are NEVER translated — see companyFacts.js.
// ─────────────────────────────────────────────────────────────────────────────

// Locales this glossary currently ships. zh-Hant is intentionally listed as a
// planned locale with no entries yet — adding it later is additive only.
export const GLOSSARY_LOCALES = ['en', 'zh-CN'];
export const PLANNED_LOCALES = ['zh-Hant'];

// term id → { en, 'zh-CN', ... }
export const MORTGAGE_GLOSSARY = {
  mortgage: { en: 'mortgage', 'zh-CN': '房屋贷款' },
  purchase: { en: 'purchase', 'zh-CN': '购房贷款' },
  refinance: { en: 'refinance', 'zh-CN': '再融资' },
  cash_out: { en: 'cash-out refinance', 'zh-CN': '套现再融资' },
  down_payment: { en: 'down payment', 'zh-CN': '首付款' },
  closing_costs: { en: 'closing costs', 'zh-CN': '过户费用' },
  interest_rate: { en: 'interest rate', 'zh-CN': '利率' },
  monthly_payment: { en: 'monthly payment', 'zh-CN': '每月还款' },
  cash_to_close: { en: 'cash to close', 'zh-CN': '过户所需现金' },
  loan_amount: { en: 'loan amount', 'zh-CN': '贷款金额' },
  primary_residence: { en: 'primary residence', 'zh-CN': '自住房' },
  second_home: { en: 'second home', 'zh-CN': '第二套住房' },
  investment_property: { en: 'investment property', 'zh-CN': '投资房产' },
  self_employed: { en: 'self-employed', 'zh-CN': '自雇人士' },
  w2: { en: 'W-2 employee', 'zh-CN': '受薪雇员' },
  bank_statement_loan: { en: 'bank statement loan', 'zh-CN': '银行流水贷款' },
  jumbo_loan: { en: 'jumbo loan', 'zh-CN': '超额贷款' },
  conforming_loan: { en: 'conforming loan', 'zh-CN': '符合标准贷款' },
  dscr_loan: { en: 'DSCR loan', 'zh-CN': '债务偿付覆盖率贷款' },
  fha_loan: { en: 'FHA loan', 'zh-CN': 'FHA 贷款' },
  va_loan: { en: 'VA loan', 'zh-CN': 'VA 退伍军人贷款' },
  credit_score: { en: 'credit score', 'zh-CN': '信用评分' },
  pre_approval: { en: 'pre-approval', 'zh-CN': '预先审批' },
  licensed_professional: { en: 'licensed mortgage professional', 'zh-CN': '持牌房贷专业人士' },
  planning_estimate: { en: 'planning estimate', 'zh-CN': '规划估算' },
  not_a_rate_quote: { en: 'not a rate quote', 'zh-CN': '并非正式利率报价' },
  not_an_approval: { en: 'not a loan approval', 'zh-CN': '并非贷款批准' },
  loan_purpose: { en: 'loan purpose', 'zh-CN': '贷款用途' },
  property_type: { en: 'property type', 'zh-CN': '房产类型' },
  occupancy: { en: 'occupancy', 'zh-CN': '居住用途' },
  reserves: { en: 'reserves', 'zh-CN': '储备金' },
  income_documentation: { en: 'income documentation', 'zh-CN': '收入证明文件' },
  points: { en: 'discount points', 'zh-CN': '折扣点' },
};

// Look up a term for a locale; falls back to English if the locale has no entry
// yet (so a partially-added future locale never renders an empty string).
export function term(id, locale = 'en') {
  const e = MORTGAGE_GLOSSARY[id];
  if (!e) return id;
  return e[locale] || e.en || id;
}

// The prompt-facing glossary block: the model uses THESE renderings so the chat
// wording matches the UI. Emitted only for locales we ship.
export function glossaryPromptBlock(locale) {
  if (locale === 'en' || !GLOSSARY_LOCALES.includes(locale)) return '';
  const lines = Object.values(MORTGAGE_GLOSSARY)
    .map((e) => (e[locale] ? `- ${e.en} → ${e[locale]}` : null))
    .filter(Boolean);
  return lines.join('\n');
}
