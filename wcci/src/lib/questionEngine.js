// Question engine — decides the next 1-3 most important questions to ask.
//
// Returns questions ordered by importance, skipping anything already known.
// The ordering is tuned so that a borrower who has given price + state + down +
// employment is next asked: ZIP/county, occupancy, and income-doc path — the
// exact sequence the product spec calls for.

function known(profile, key) {
  const v = profile ? profile[key] : undefined;
  return v !== undefined && v !== null && v !== '' && v !== 'unsure';
}

// Ordered from most to least important. Each entry can gate on a condition.
const QUESTION_BANK = [
  { id: 'purchasePrice', fields: ['purchasePrice'], priority: 'needed',
    text: 'What price range are you looking at for the property?' },
  { id: 'state', fields: ['state'], priority: 'needed',
    text: 'What state is the property in?' },
  { id: 'downPayment', fields: ['downPayment'], priority: 'needed',
    text: 'Roughly how much do you have available for a down payment or cash to close?' },
  { id: 'employmentType', fields: ['employmentType'], priority: 'needed',
    text: 'How do you earn your income — W-2, self-employed, 1099, business owner, retired, or investor?' },
  { id: 'zipOrCounty', fields: ['zipOrCounty'], priority: 'needed',
    text: 'What ZIP code or county is the property in? (This sets the conforming loan limit for the area.)' },
  { id: 'occupancy', fields: ['occupancy'], priority: 'needed',
    text: 'Will this be your primary residence, a second home, or an investment property?' },
  { id: 'incomeDocPath', fields: ['incomeDocPath'], priority: 'needed',
    text: 'Do your tax returns show enough income to qualify, or should we also compare bank statement / Non-QM options?',
    // Only surface once we know they're self-employed-ish OR nothing else is missing.
    when: (p) => true },
  { id: 'loanPurpose', fields: ['loanPurpose'], priority: 'needed',
    text: 'Is this a purchase, a refinance, or a cash-out refinance?' },
  { id: 'estimatedFICO', fields: ['estimatedFICO'], priority: 'helpful',
    text: 'Do you know your approximate credit score range? A rough estimate is fine.' },
  { id: 'reservesAfterClosing', fields: ['reservesAfterClosing'], priority: 'helpful',
    text: 'After your down payment and closing costs, about how much would you have left in savings/reserves?' },
  { id: 'borrowerGoal', fields: ['borrowerGoal'], priority: 'helpful',
    text: 'What matters most to you — the lowest payment, the least cash to close, the easiest approval, the best long-term cost, or comparing all the options?' },
];

// Return the next `limit` (default 3) questions the AI should ask.
export function nextQuestions(profile, limit = 3) {
  const p = profile || {};
  const out = [];
  for (const q of QUESTION_BANK) {
    if (out.length >= limit) break;
    const missing = q.fields.some(f => !known(p, f));
    if (!missing) continue;
    if (q.when && !q.when(p)) continue;
    out.push({ id: q.id, text: q.text, priority: q.priority, fields: q.fields });
  }
  return out;
}

// The single most important next question (for the "next best question" chip).
export function nextBestQuestion(profile) {
  return nextQuestions(profile, 1)[0] || null;
}
