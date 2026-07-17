// Natural-language scenario parser.
//
// Extracts as many Scenario Profile fields as it confidently can from a free
// text message like:
//   "I want to buy a $2M home in California. I'm self-employed and have $400k down."
// Anything it is unsure about is simply left undefined (the AI question engine
// fills the rest). It never guesses contact info.

const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};
const STATE_CODES = new Set(Object.values(STATE_ABBR));

// Title-case a location string ("santa clarita" → "Santa Clarita").
function titleCase(s) {
  return String(s).trim().replace(/\s+/g, ' ')
    .split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Parse a money-ish token → number. Handles $2M, 2 million, $2,000,000, 400k, $1.5m.
function parseMoney(raw) {
  if (raw == null) return undefined;
  let s = String(raw).toLowerCase().replace(/[$,\s]/g, '');
  let mult = 1;
  const millMatch = s.match(/^(\d*\.?\d+)(m|mm|mil|mill|million)$/);
  const kMatch = s.match(/^(\d*\.?\d+)(k|thousand)$/);
  if (millMatch) { mult = 1e6; s = millMatch[1]; }
  else if (kMatch) { mult = 1e3; s = kMatch[1]; }
  const n = parseFloat(s);
  if (!isFinite(n)) return undefined;
  return Math.round(n * mult);
}

// Find the first money amount that appears near one of the given keywords.
function moneyNear(text, keywords, { after = true } = {}) {
  const moneyRe = /\$?\s?\d[\d,]*\.?\d*\s?(?:m|mm|mil|mill|million|k|thousand)?/gi;
  for (const kw of keywords) {
    const idx = text.search(kw);
    if (idx === -1) continue;
    const window = after
      ? text.slice(idx, idx + 40)
      : text.slice(Math.max(0, idx - 30), idx + kw.source.length + 6);
    const m = window.match(moneyRe);
    if (m) {
      for (const cand of m) {
        const val = parseMoney(cand);
        if (val && val >= 1000) return val;
      }
    }
  }
  return undefined;
}

export function parseScenario(rawText) {
  const out = {};
  if (!rawText || typeof rawText !== 'string') return out;
  const text = rawText.toLowerCase();

  // ── State (full name, "City, ST", or a standalone code) ──
  // A full state name is only trusted when it appears as a LOCATION — never
  // from a person's name like "Tony Montana". Require a location cue right
  // before it, a comma right after it, or the whole message being the state.
  const LOC_CUE = /\b(in|at|to|near|from|into|within|property|home|house|located|state of|move to|buy(?:ing)? in|it'?s in)\s+$/;
  for (const [name, abbr] of Object.entries(STATE_ABBR)) {
    const m = new RegExp(`\\b${name}\\b`).exec(text);
    if (!m) continue;
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    const after = text.slice(m.index + name.length, m.index + name.length + 1);
    const wholeMsg = text.trim() === name;
    if (wholeMsg || LOC_CUE.test(before) || after === ',') { out.state = abbr; break; }
  }
  // "santa clarita, ca" or "..., CA" — a 2-letter token right after a comma.
  const commaST = rawText.match(/,\s*([A-Za-z]{2})\b/);
  if (!out.state && commaST && STATE_CODES.has(commaST[1].toUpperCase())) {
    out.state = commaST[1].toUpperCase();
  }
  // A standalone UPPERCASE code (avoid matching lowercase English words).
  if (!out.state) {
    const m = rawText.match(/\b([A-Z]{2})\b/);
    if (m && STATE_CODES.has(m[1])) out.state = m[1];
  }

  // ── ZIP / county / city ──
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) out.zipOrCounty = zip[1];
  else {
    const county = rawText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+county\b/i);
    if (county) out.zipOrCounty = titleCase(county[1]) + ' County';
  }
  // "City, ST" — capture the city as the location (the MLO maps it to a county).
  if (!out.zipOrCounty) {
    const cityST = rawText.match(/([A-Za-z][A-Za-z.'\-]+(?:\s+[A-Za-z.'\-]+){0,3})\s*,\s*([A-Za-z]{2})\b/);
    if (cityST && STATE_CODES.has(cityST[2].toUpperCase())) {
      const city = cityST[1].trim();
      // Guard against grabbing a trailing clause like "...720, ca".
      if (!/^\d+$/.test(city) && city.length >= 3) {
        out.zipOrCounty = titleCase(city);
        if (!out.state) out.state = cityST[2].toUpperCase();
      }
    }
  }

  // ── Loan purpose ──
  if (/\bcash[-\s]?out\b/.test(text)) out.loanPurpose = 'cash-out';
  else if (/\brefinanc|\brefi\b/.test(text)) out.loanPurpose = 'refinance';
  else if (/\binvest(ment|or)?\b/.test(text) && /\bbuy|purchase\b/.test(text)) out.loanPurpose = 'investment';
  else if (/\bbuy|purchas|home|house|property\b/.test(text)) out.loanPurpose = 'purchase';

  // ── Occupancy ──
  if (/\bsecond home|vacation home\b/.test(text)) out.occupancy = 'second home';
  else if (/\binvest(ment)?\s+(property|home|house)|\brental\b|\bdscr\b/.test(text)) out.occupancy = 'investment';
  else if (/\bprimary|live in|owner[-\s]?occup/.test(text)) out.occupancy = 'primary residence';

  // ── Employment type ──
  if (/\bforeign national\b/.test(text)) out.employmentType = 'foreign national';
  else if (/\bself[-\s]?employed\b/.test(text)) out.employmentType = 'self-employed';
  else if (/\bbusiness owner\b/.test(text)) out.employmentType = 'business owner';
  else if (/\b1099\b/.test(text)) out.employmentType = '1099';
  else if (/\bretir(ed|ee)\b/.test(text)) out.employmentType = 'retired';
  else if (/\binvestor\b/.test(text)) out.employmentType = 'investor';
  else if (/\bw[-\s]?2\b|\bsalaried\b|\bemployee\b/.test(text)) out.employmentType = 'W-2';

  // ── Income documentation path ──
  if (/\bbank statement\b/.test(text)) out.incomeDocPath = 'bank statements';
  else if (/\bp\s?&\s?l\b|profit and loss|profit & loss/.test(text)) out.incomeDocPath = 'P&L';
  else if (/\basset depletion|asset[-\s]?based\b/.test(text)) out.incomeDocPath = 'asset depletion';
  else if (/\bdscr\b/.test(text)) out.incomeDocPath = 'DSCR';
  else if (/\bfull[-\s]?doc|tax returns\b/.test(text)) out.incomeDocPath = 'full-doc tax returns';

  // ── FICO / credit ──
  const fico = text.match(/\b(?:fico|credit(?:\s+score)?)\D{0,12}(\d{3})\b/) ||
    text.match(/\b(\d{3})\+?\s*(?:fico|credit)\b/);
  if (fico) {
    const v = parseInt(fico[1], 10);
    if (v >= 300 && v <= 850) out.estimatedFICO = v;
  }

  // ── Borrower goal ──
  if (/\blowest payment|lower payment|smallest payment\b/.test(text)) out.borrowerGoal = 'lowest payment';
  else if (/\blowest cash|least cash|minimum down|less down\b/.test(text)) out.borrowerGoal = 'lowest cash to close';
  else if (/\beasiest approval|easy approval|just approv/.test(text)) out.borrowerGoal = 'easiest approval';
  else if (/\blong[-\s]?term|best.*cost\b/.test(text)) out.borrowerGoal = 'best long-term cost';
  else if (/\bfast(est)? clos|close quickly|quick clos/.test(text)) out.borrowerGoal = 'fastest close';
  else if (/\bcompare (all|options|everything)|best scenario|which is best\b/.test(text)) out.borrowerGoal = 'compare all';

  // ── Down payment (amount or percent) ──
  const pctDown = text.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*(?:down|dp)/) ||
    text.match(/(?:down|dp)\D{0,6}(\d{1,2}(?:\.\d+)?)\s*%/);
  const downAmt = moneyNear(text, [/down/, /cash/, /have\b/, /put(ting)?\s+down/], { after: false }) ||
    moneyNear(text, [/down payment/, /available cash/], { after: true });

  // ── Purchase price / value ──
  out.purchasePrice = moneyNear(text, [/\$?\s?[\d.,]+\s?(?:m|million|k)?\s*(?:home|house|property|condo)/, /buy(?:ing)?/, /purchase/, /price/, /value/, /worth/]);
  // Fallback: the largest money value in the text is usually the price.
  if (!out.purchasePrice) {
    const zipNum = out.zipOrCounty && /^\d{5}$/.test(out.zipOrCounty) ? Number(out.zipOrCounty) : null;
    const all = (text.match(/\$?\s?\d[\d,]*\.?\d*\s?(?:m|mm|mil|mill|million|k|thousand)?/gi) || [])
      .map(parseMoney).filter(v => v && v >= 10000 && v !== zipNum);
    if (all.length) out.purchasePrice = Math.max(...all);
  }

  if (pctDown && out.purchasePrice) {
    out.downPayment = Math.round(out.purchasePrice * parseFloat(pctDown[1]) / 100);
    out.downPaymentPercent = parseFloat(pctDown[1]);
  } else if (downAmt && downAmt !== out.purchasePrice) {
    out.downPayment = downAmt;
  }

  // ── Simplified Chinese extraction (fills blanks only) ──
  if (/[一-鿿]/.test(rawText)) absorbChinese(rawText, out);

  // ── Derived: loan amount + LTV ──
  if (out.purchasePrice && out.downPayment != null) {
    out.loanAmount = Math.max(0, out.purchasePrice - out.downPayment);
    out.ltv = out.purchasePrice ? +(out.loanAmount / out.purchasePrice * 100).toFixed(2) : undefined;
  }

  return out;
}

// Convert a Chinese-style amount ("150" + "万") to a number.
// 万 = 10,000 · 亿 = 100,000,000 · (no unit) = as-is.
function cnAmount(numStr, unit) {
  const n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!isFinite(n)) return undefined;
  const mult = unit === '亿' ? 1e8 : unit === '万' ? 1e4 : 1;
  return Math.round(n * mult);
}

// Extract scenario facts from natural Simplified Chinese. Fills only blanks so
// it never overrides a value the English pass already resolved.
function absorbChinese(raw, out) {
  const t = String(raw);

  if (out.state === undefined) {
    if (/加州|加利福尼亚/.test(t)) out.state = 'CA';
    else if (/佛罗里达|佛州/.test(t)) out.state = 'FL';
  }

  if (out.loanPurpose === undefined) {
    if (/套现|现金再融资/.test(t)) out.loanPurpose = 'cash-out';
    else if (/再融资|重新贷款|重贷/.test(t)) out.loanPurpose = 'refinance';
    else if (/投资房|投资房产|投资物业/.test(t) && /买|购买|购/.test(t)) out.loanPurpose = 'investment';
    else if (/购房|买房|购买|买一套|买房子|买房产|买个?房/.test(t)) out.loanPurpose = 'purchase';
  }

  if (out.occupancy === undefined) {
    if (/第二套住房|第二套房|度假房/.test(t)) out.occupancy = 'second home';
    else if (/投资房|投资房产|投资物业|出租/.test(t)) out.occupancy = 'investment';
    else if (/自住/.test(t)) out.occupancy = 'primary residence';
  }

  if (out.employmentType === undefined) {
    if (/自雇|自雇人士|个体经营|个体户/.test(t)) out.employmentType = 'self-employed';
    else if (/企业主|生意人|老板/.test(t)) out.employmentType = 'business owner';
    else if (/退休/.test(t)) out.employmentType = 'retired';
  }

  if (out.incomeDocPath === undefined) {
    if (/银行流水/.test(t)) out.incomeDocPath = 'bank statements';
    else if (/dscr/i.test(t)) out.incomeDocPath = 'DSCR';
  }

  if (out.borrowerGoal === undefined) {
    if (/比较|对比/.test(t)) out.borrowerGoal = 'compare all';
    else if (/最低.{0,4}还款|降低.{0,4}(每月)?还款|月供最低/.test(t)) out.borrowerGoal = 'lowest payment';
    else if (/最少.{0,4}现金|最低.{0,4}首付/.test(t)) out.borrowerGoal = 'lowest cash to close';
    else if (/尽快.{0,3}(过户|关闭|成交)/.test(t)) out.borrowerGoal = 'fastest close';
  }

  // Down payment — anchored on 首付 so it never grabs the purchase price.
  if (out.downPayment === undefined) {
    const dp = t.match(/首付[款]?[^0-9０-９]{0,6}([\d.,]+)\s*(万|亿)?/);
    if (dp) { const v = cnAmount(dp[1], dp[2]); if (v) out.downPayment = v; }
  }

  // Purchase price — a money amount adjacent to a property word, else near a buy verb.
  if (out.purchasePrice === undefined) {
    const near = t.match(/([\d.,]+)\s*(万|亿)?\s*(?:美元|美金|元)?[^0-9。，,，０-９]{0,6}(?:的?房子|套房|房产|物业|房)/)
      || t.match(/(?:买|购买|购|价值|价格|大约|房价)[^0-9]{0,8}([\d.,]+)\s*(万|亿)?/);
    if (near) { const v = cnAmount(near[1], near[2]); if (v && v >= 10000) out.purchasePrice = v; }
  }
  // Fallback: the largest 万/亿 amount is usually the price.
  if (out.purchasePrice === undefined) {
    const toks = [...t.matchAll(/([\d.,]+)\s*(万|亿)/g)].map(m => cnAmount(m[1], m[2])).filter(v => v && v >= 100000);
    if (toks.length) out.purchasePrice = Math.max(...toks);
  }
}

export { parseMoney };
