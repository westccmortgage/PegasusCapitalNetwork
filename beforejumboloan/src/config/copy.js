/**
 * copy.js
 * All user-facing marketing + UI copy in one place so the brand voice can be
 * tuned without hunting through HTML. Config-driven content layer.
 */

export const COPY = {
  brand: {
    name: 'BeforeJumboLoan',
    domain: 'BeforeJumboLoan.com',
    tagline: 'Know your number before you cross into jumbo.',
  },

  hero: {
    eyebrow: 'Mortgage Strategy Engine',
    headline: 'Engineer the loan. Not just the rate.',
    sub:
      'BeforeJumboLoan models your payment stack, DSCR, rate buydowns, and the exact ' +
      'gap that keeps you on the right side of the jumbo line — in real time.',
    primaryCta: 'Open the Strategy Studio',
    secondaryCta: 'See how it works',
  },

  valueProps: [
    {
      icon: '◧',
      title: 'Payment Stack, decomposed',
      body: 'See principal, interest, taxes, insurance, HOA, and MI as one transparent stack.',
    },
    {
      icon: '⊞',
      title: 'Before-Jumbo Gap',
      body: 'Know precisely how much down payment keeps you under the conforming ceiling.',
    },
    {
      icon: '⟁',
      title: 'DSCR for investors',
      body: 'Qualify on the property, not your W-2. Watch the ratio move as you adjust.',
    },
    {
      icon: '⇲',
      title: 'Buydown math, honest',
      body: 'Break-even on points and 2-1 / 3-2-1 structures — no hand-waving.',
    },
  ],

  studio: {
    title: 'Strategy Studio',
    subtitle: 'Adjust the scenario. The math reacts instantly.',
    leadHeadline: 'Get this strategy reviewed by a licensed advisor',
    leadSub: 'No credit pull. We’ll prepare a real options memo from the scenario you built.',
  },

  // Phase 2 placeholder copy — surfaced but inert.
  aiExplainer: {
    title: 'AI Strategy Explainer',
    badge: 'Phase 2',
    placeholder:
      'In Phase 2, this panel will narrate your scenario in plain English — why the ' +
      'numbers move, the trade-offs, and the smartest next step. The engine already ' +
      'emits a structured snapshot ready to hand to the model.',
  },
};

export default COPY;
