// Scenario Profile field definitions + completion logic.
//
// Priorities map to the three labels the product spec requires:
//   'needed'  → must have to produce a meaningful strategy
//   'helpful' → sharpens the strategy / pricing
//   'optional'→ contact + nice-to-have
//
// Contact fields are 'optional' for profile-completion purposes because the
// spec forbids asking for them before value is delivered.

export const PROFILE_FIELDS = [
  { key: 'purchasePrice',      label: 'Purchase price / value',   priority: 'needed',   type: 'money' },
  { key: 'downPayment',        label: 'Down payment / cash',      priority: 'needed',   type: 'money' },
  { key: 'state',              label: 'State',                    priority: 'needed',   type: 'text' },
  { key: 'zipOrCounty',        label: 'ZIP or county',            priority: 'needed',   type: 'text' },
  { key: 'occupancy',          label: 'Occupancy',                priority: 'needed',   type: 'enum',
    options: ['primary residence', 'second home', 'investment'] },
  { key: 'loanPurpose',        label: 'Loan purpose',             priority: 'needed',   type: 'enum',
    options: ['purchase', 'refinance', 'cash-out', 'investment'] },
  { key: 'employmentType',     label: 'Employment type',          priority: 'needed',   type: 'enum',
    options: ['W-2', 'self-employed', '1099', 'business owner', 'retired', 'investor', 'foreign national'] },
  { key: 'incomeDocPath',      label: 'Income documentation',     priority: 'needed',   type: 'enum',
    options: ['full-doc tax returns', 'bank statements', 'P&L', 'asset depletion', 'DSCR', 'unsure'] },

  { key: 'loanAmount',         label: 'Loan amount',              priority: 'helpful',  type: 'money', derived: true },
  { key: 'ltv',                label: 'LTV',                      priority: 'helpful',  type: 'percent', derived: true },
  { key: 'estimatedFICO',      label: 'Estimated FICO',           priority: 'helpful',  type: 'number' },
  { key: 'reservesAfterClosing', label: 'Reserves after closing', priority: 'helpful',  type: 'money' },
  { key: 'borrowerGoal',       label: 'Borrower goal',            priority: 'helpful',  type: 'enum',
    options: ['lowest payment', 'lowest cash to close', 'easiest approval', 'best long-term cost', 'fastest close', 'compare all'] },

  { key: 'name',               label: 'Name',                     priority: 'optional', type: 'text', contact: true },
  { key: 'phone',              label: 'Phone',                    priority: 'optional', type: 'text', contact: true },
  { key: 'email',              label: 'Email',                    priority: 'optional', type: 'text', contact: true },
];

export const NEEDED_KEYS = PROFILE_FIELDS.filter(f => f.priority === 'needed').map(f => f.key);
export const CONTACT_KEYS = PROFILE_FIELDS.filter(f => f.contact).map(f => f.key);

function has(profile, key) {
  const v = profile ? profile[key] : undefined;
  return v !== undefined && v !== null && v !== '' && v !== 'unsure';
}

const NUMERIC_KEYS = new Set(['purchasePrice', 'downPayment', 'loanAmount', 'reservesAfterClosing', 'estimatedFICO', 'ltv']);

// Coerce loosely-typed values (e.g. AI-supplied strings like "$1,400,000") into
// the shapes the engines expect. Unknown/blank values are dropped.
export function normalizeProfileValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (NUMERIC_KEYS.has(k)) {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,%\s]/g, ''));
      if (isFinite(n)) out[k] = n;
    } else {
      out[k] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

// Merge new values over an existing profile, keeping derived fields in sync.
// opts.fillOnly → only set keys that are currently empty (used for AI updates so
// deterministic parser / manual entries stay authoritative).
export function mergeProfile(base, updates, opts = {}) {
  const next = { ...(base || {}) };
  const clean = normalizeProfileValues(updates);
  for (const [k, v] of Object.entries(clean)) {
    if (opts.fillOnly && has(next, k)) continue;
    next[k] = v;
  }
  // Recompute derived fields whenever price/down present.
  if (has(next, 'purchasePrice') && next.downPayment != null && next.downPayment !== '') {
    next.loanAmount = Math.max(0, Number(next.purchasePrice) - Number(next.downPayment));
    next.ltv = +(next.loanAmount / Number(next.purchasePrice) * 100).toFixed(2);
  }
  return next;
}

// Completion status broken out by priority tier + overall percentage.
export function profileStatus(profile) {
  const p = profile || {};
  const tier = (name) => {
    const fields = PROFILE_FIELDS.filter(f => f.priority === name);
    const filled = fields.filter(f => has(p, f.key));
    return { total: fields.length, filled: filled.length,
      missing: fields.filter(f => !has(p, f.key)).map(f => f.key) };
  };
  const needed = tier('needed');
  const helpful = tier('helpful');
  const optional = tier('optional');

  // Overall % weights needed most heavily.
  const neededPct = needed.total ? needed.filled / needed.total : 1;
  const helpfulPct = helpful.total ? helpful.filled / helpful.total : 1;
  const pct = Math.round((neededPct * 0.75 + helpfulPct * 0.25) * 100);

  return {
    percent: pct,
    needed, helpful, optional,
    hasCoreScenario: has(p, 'purchasePrice') && p.downPayment != null,
    neededComplete: needed.missing.length === 0,
  };
}

// Field metadata lookup.
export function fieldFor(key) {
  return PROFILE_FIELDS.find(f => f.key === key);
}
