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

// Parse a money-ish token → number. Handles $2M, 2 million, $2,000,000, 400k, $1.5m.
function parseMoney(raw) {
  if (raw == null) return undefined;
  let s = String(raw).toLowerCase().replace(/[$,\s]/g, '');
  let mult = 1;
  const millMatch = s.match(/^(\d*\.?\d+)(m|mm|million)$/);
  const kMatch = s.match(/^(\d*\.?\d+)(k|thousand)$/);
  if (millMatch) { mult = 1e6; s = millMatch[1]; }
  else if (kMatch) { mult = 1e3; s = kMatch[1]; }
  const n = parseFloat(s);
  if (!isFinite(n)) return undefined;
  return Math.round(n * mult);
}

// Find the first money amount that appears near one of the given keywords.
function moneyNear(text, keywords, { after = true } = {}) {
  const moneyRe = /\$?\s?\d[\d,]*\.?\d*\s?(?:m|mm|million|k|thousand)?/gi;
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

  // ── State ──
  for (const [name, abbr] of Object.entries(STATE_ABBR)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) { out.state = abbr; break; }
  }
  if (!out.state) {
    const m = rawText.match(/\b([A-Z]{2})\b/);
    if (m && STATE_CODES.has(m[1])) out.state = m[1];
  }

  // ── ZIP ──
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) out.zipOrCounty = zip[1];
  else {
    const county = rawText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+county\b/);
    if (county) out.zipOrCounty = county[1] + ' County';
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
    const all = (text.match(/\$?\s?\d[\d,]*\.?\d*\s?(?:m|mm|million|k|thousand)?/gi) || [])
      .map(parseMoney).filter(v => v && v >= 10000);
    if (all.length) out.purchasePrice = Math.max(...all);
  }

  if (pctDown && out.purchasePrice) {
    out.downPayment = Math.round(out.purchasePrice * parseFloat(pctDown[1]) / 100);
    out.downPaymentPercent = parseFloat(pctDown[1]);
  } else if (downAmt && downAmt !== out.purchasePrice) {
    out.downPayment = downAmt;
  }

  // ── Derived: loan amount + LTV ──
  if (out.purchasePrice && out.downPayment != null) {
    out.loanAmount = Math.max(0, out.purchasePrice - out.downPayment);
    out.ltv = out.purchasePrice ? +(out.loanAmount / out.purchasePrice * 100).toFixed(2) : undefined;
  }

  return out;
}

export { parseMoney };
