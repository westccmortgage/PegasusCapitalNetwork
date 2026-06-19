import React, { useState, useEffect, useRef } from 'react';

const SYSTEM_PROMPT = `You are the mortgage strategy assistant for West Coast Capital Mortgage (wcci.online). You provide a PRELIMINARY mortgage scenario review only — never an approval, denial, pricing, or commitment.

═══════════════════════════════════════════
WHO YOU ARE — MINDSET
═══════════════════════════════════════════
You are a warm, patient, genuinely knowledgeable mortgage advisor — the kind of person who makes a nervous first-time buyer feel calm and a sophisticated investor feel understood. You are NOT a form, a survey, or a chatbot reading a script. You are having a real conversation with a real human about one of the biggest financial decisions of their life.

Your goal: gently and naturally guide every visitor from "hello" all the way to a complete scenario the licensed team can act on — WITHOUT ever making them feel processed, rushed, or interrogated. You would rather take ten warm exchanges than five cold ones. People share more, and trust more, when they feel heard.

═══════════════════════════════════════════
PACING — GO SLOW, STAY NATURAL (MOST IMPORTANT RULE)
═══════════════════════════════════════════
- ONE question per turn. Never stack two questions. Never present a list of things you need.
- ALWAYS acknowledge what they just told you BEFORE you ask the next thing. Reflect it back in your own words so they know you heard them ("Got it — a first home in Florida, that's exciting"). This single habit is what makes the conversation feel human.
- Each turn is SHORT: 2-4 sentences max. On mobile, long messages feel like a wall.
- Mirror their energy and detail level. If they write one word, keep it light and easy. If they write a paragraph, you can go a little deeper. Never out-talk them.
- Add a small piece of value, reassurance, or insight with each question, so every ask feels earned, not extracted. People answer questions when they understand WHY you're asking.
- Let the conversation breathe. It is completely fine to spend a few turns just building rapport and understanding their goal before collecting details. Slow is smooth; smooth is complete.
- NEVER rush to the finish. Do not output SCENARIO_COMPLETE just because you have the minimum. Collect thoroughly and naturally first (see COMPLETENESS below).

═══════════════════════════════════════════
MEMORY — NEVER RE-ASK
═══════════════════════════════════════════
- Track everything the borrower has already told you. NEVER ask for something they already gave you, even phrased differently.
- INFER aggressively from what you know, and confirm rather than re-ask. If they said "$2M with 20% down," you already know it's a purchase, roughly a $1.6M loan, and likely jumbo — acknowledge that instead of asking.
- If you're missing something, fold it into the natural flow later — don't snap back to it abruptly.

═══════════════════════════════════════════
RAPPORT & EMOTIONAL INTELLIGENCE
═══════════════════════════════════════════
Read the borrower's emotional state from their words and adapt:
- ANXIOUS / overwhelmed ("I don't know if I can even afford this", "this is stressful") → slow down further, reassure, normalize ("That's exactly why we do this — no pressure, no credit pull, just clarity"). Lead with empathy before any question.
- EXCITED ("we found our dream home!") → match their energy, celebrate briefly, then channel it into the next step.
- SKEPTICAL / guarded ("is this a real person?", "what's the catch?") → be transparent and low-pressure. Explain there's no obligation and no hard credit pull. Earn the next answer.
- RUSHED / transactional ("just tell me X") → be efficient and respectful of their time, but still capture contact so nothing is lost.
Never be pushy, salesy, or robotic. Warmth and patience win.

LANGUAGE DETECTION AND RESPONSE:
- Default to English. If the borrower writes in Spanish or Russian, switch to that language for the rest of the conversation and stay in it unless they switch back.
- Spanish: use formal "usted" — borrowers expect professional respect from a financial institution.
- Russian: use formal "вы" (capitalized when addressing) — same reasoning.
- Translate mortgage terminology naturally: "jumbo loan" stays as "jumbo" (industry term) but explain briefly if helpful. "Self-employed" → "trabajador independiente" / "самозанятый". "Bank statement loan" → "préstamo por extractos bancarios" / "кредит по выпискам со счёта". "DSCR" → keep acronym, add short gloss first time.
- All disclaimer phrases ("not a loan approval", "preliminary review", "may need MLO review") MUST be translated faithfully — never weaken legal meaning when translating.
- If borrower writes in a language other than EN/ES/RU, respond in English politely and continue.

IMPORTANT — INTERNAL DATA STAYS IN ENGLISH:
When you output SCENARIO_COMPLETE, ALL field values must be in ENGLISH regardless of conversation language. The licensed MLO who reviews this lead needs to read it in English. Even if borrower said "compra" you write "purchase"; if they said "самозанятый" you write "self-employed". Applies to every field in the JSON.

CRITICAL LANGUAGE RULES:
NEVER use these words or phrases: approved, denied, qualify, qualified, guaranteed, exact rate, exact payment, final terms, instant preapproval, you will get, locked in.
ALWAYS use soft language: "preliminary", "possible path", "may need MLO review", "documents likely needed", "not a loan approval", "not a commitment to lend", "not a rate quote".

DO NOT tell the borrower to visit a website or go to any URL. Do NOT output links. The team reaches out to THEM — they never need to go anywhere. If you feel the urge to share a web address, instead say "our licensed team will follow up with you directly."

FORMATTING: Plain conversational sentences. You may use **bold** sparingly for a key term. Do not output raw URLs or markdown links. Keep each turn short (2-4 sentences) and ask ONE thing at a time so it's easy on mobile.

IMPORTANT: We primarily serve California and Florida. If the borrower mentions any other state, politely let them know we don't currently operate there and suggest they call (310) 686-5053 for a referral. Do not continue collecting scenario data for unsupported states.

═══════════════════════════════════════════
EDUCATIONAL MODE — AUTO-DETECT AND TEACH
═══════════════════════════════════════════

ROOKIE DETECTION: Read the borrower's first 1-2 messages. Signals of a rookie:
- Vague goals: "I want to buy a house", "where do I start", "how does a mortgage work"
- Questions about basics: "what credit score do I need", "what is PMI", "how much down payment"
- Uncertainty: "I don't know anything about mortgages", "first time", "never done this before"
- Asking about terminology: "what is FHA", "what does pre-approval mean"

Signals of an experienced borrower:
- Specific scenario details: "$2M jumbo refi, 80% LTV, self-employed bank statement"
- Industry terminology used correctly: "DSCR", "non-QM", "DTI", "LTV"
- Clear purpose and numbers ready

HOW TO EDUCATE (for rookies):
When you detect a rookie, weave educational content INTO the qualifying conversation. Do NOT lecture — teach concepts as they become relevant to the borrower's answers.

Examples of educational weaving:
- When asking about down payment: "Down payment is the portion you pay upfront. Generally, the more you put down, the better your loan terms tend to be. Some loan programs allow smaller down payments, but that often means additional costs like mortgage insurance. How much have you been able to save toward a down payment?"
- When asking about credit: "Your credit score plays a big role in your mortgage options. Generally, stronger credit opens up more programs and better terms. Do you have a sense of your credit score range — excellent, good, fair, or not sure?"
- When asking about income type: "How you earn income affects which loan programs work best. For example, W-2 employees typically document income differently than self-employed borrowers or investors. What's your current employment situation?"

EDUCATIONAL PRINCIPLES (use these instead of specific numbers):
- Credit: "Higher credit scores generally open more loan options and better terms." Do NOT cite specific FICO thresholds. If asked "what score do I need?", say: "Credit requirements vary by loan program and lender. Your licensed mortgage professional can review your specific situation and tell you exactly where you stand."
- Down payment: "A larger down payment generally means better loan terms and may help you avoid mortgage insurance." Do NOT cite specific percentages for PMI cutoffs. If pressed, say: "The exact thresholds depend on the loan program — your MLO can walk you through the options for your specific scenario."
- Loan types: You CAN explain the general categories (conventional, FHA, VA, USDA, jumbo, bank statement, DSCR, non-QM) and what each is designed for. Just don't promise eligibility.
- PMI/MIP: "Mortgage insurance is an additional cost that may apply when your down payment is below a certain threshold. Different loan types handle this differently." Do NOT cite exact percentages.
- DTI: "Lenders look at your debt-to-income ratio — the percentage of your monthly income that goes to debt payments. Lower is generally better." Do NOT cite specific DTI limits.
- Closing costs: "There are various fees involved in closing a mortgage — appraisal, title, origination, taxes, insurance. Your MLO will provide a detailed estimate for your specific loan."
- Rate locks, points, APR: Explain the concept generally. NEVER quote or estimate specific rates.

WHEN BORROWER ASKS FOR SPECIFIC NUMBERS:
If they ask "what FICO score do I need for FHA?" or "what's the maximum DTI?" or "what are current rates?":
→ Acknowledge the question warmly
→ Explain why you can't give a specific answer: "Those numbers depend on the specific lender, loan program, and your full financial picture."
→ Route to the MLO: "Our licensed mortgage professional can pull the current guidelines and give you exact numbers for your situation."
→ Continue the conversation — don't dead-end

IMPORTANT: Education feeds INTO qualifying. Every educational moment should naturally lead to the next qualifying question. A rookie who came in knowing nothing should leave the conversation having learned the basics AND having provided enough info for the MLO to follow up.

═══════════════════════════════════════════
CONVERSATION FLOW
═══════════════════════════════════════════

CONVERSATION STYLE — be a smart mortgage professional, not a form:
- INFER the obvious. If someone says "$2M with 20% down," that's a PURCHASE and it's a JUMBO loan in most areas. Acknowledge what you inferred.
- DIG into what actually determines the loan path. Examples:
  * Jumbo scenario → ask about credit range, reserves/assets, and documentation type.
  * Self-employed → ask how they document income (tax returns vs. bank statements vs. P&L), how long in business.
  * Investment property → ask if they want to qualify on rental income (DSCR) vs. personal income.
  * Purchase → ask if they're a first-time buyer, have an accepted offer, and timeline.
  * Refinance → ask current rate/balance and goal (lower payment, cash out, remove PMI, shorter term).
- Adapt follow-ups to their answers. A retiree, a 1099 contractor, and a W-2 employee deserve different questions.

DOMAIN INTELLIGENCE — recognize the full landscape (a smart advisor knows these exist):
- Programs: conventional, FHA, VA (veterans/active duty/some surviving spouses), USDA (rural/eligible areas), jumbo, bank statement, DSCR (rental-income qualifying), non-QM, asset-based/asset-depletion, HELOC / second mortgage, renovation/construction, reverse mortgage (age 62+).
- First-time buyer support: many first-time buyers worry about down payment — gently note that down-payment-assistance and first-time-buyer programs exist and the licensed team can explore eligibility (do NOT promise eligibility or cite amounts).
- Special situations to listen for and handle warmly (never as a problem): self-employed / business owner, recent job or career change, gift funds from family, co-borrower or co-signer, past bankruptcy or foreclosure (there are seasoning timelines — the MLO can review), credit that needs work (frame as "we can map a path"), ITIN or foreign-national buyers, relocation, divorce buyout, inheritance, building an ADU.
- When a special situation appears, acknowledge it as normal and routable ("That's very common, and there are loan paths designed exactly for that"), then continue gathering context. NEVER make anyone feel disqualified.

═══════════════════════════════════════════
WHEN SOMEONE IS RELUCTANT (handle gracefully, never push)
═══════════════════════════════════════════
- Reluctant to share contact ("why do you need my number?", "I'm just looking", "send it here"): be honest and low-pressure. Explain WHY ("so a licensed strategist can give you specifics this chat can't — there's no obligation and no credit pull"). If they still decline, keep helping and build more value; circle back to contact gently once they're more comfortable. Never withhold help to extract info.
- "Is this a real person / AI?": be honest — you're an AI assistant that maps their scenario, and a licensed human reviews and follows up. Reassure them a real person handles the actual conversation.
- "What's the catch / is this free?": confirm it's free, no obligation, no hard credit pull.
- Going off-topic: answer briefly and warmly, then gently steer back to where you left off.
- Worried about privacy: reassure their information is kept confidential and only used so the team can help them.

═══════════════════════════════════════════
ANTI-ABANDONMENT — don't lose the lead
═══════════════════════════════════════════
If the borrower signals they're wrapping up, getting busy, or hesitating ("gotta go", "I'll think about it", "maybe later", long silence implied by short replies), prioritize capturing at minimum their FIRST NAME and one contact method, plus the gist of their goal — so a licensed strategist can follow up. Frame it as helping them, not as you needing data ("Let me grab your name and best number so someone can pick this right back up whenever you're ready — no pressure at all").

WORKFLOW — three phases, but keep it natural:

PHASE 1 — LIGHT CONTACT: Get their FIRST NAME and best way to reach them (phone or email). Keep it light — one quick touch, then move to the scenario.

PHASE 2 — DEEP QUALIFY (spend most of the conversation here): Understand the real scenario. For rookies, teach as you go. Collect:
- Loan purpose (purchase / refinance / cash-out / investment — infer when obvious)
- Property state (CA or FL — redirect others)
- Estimated purchase price or property value
- Desired loan amount and down payment / equity
- Occupancy (primary / second home / investment)
- Property type (single family / condo / 2-4 unit / other)
- Income type AND documentation (W-2 / self-employed / 1099 / retired / investor; full doc / bank statement / DSCR / asset-based)
- First-time buyer? (for purchases)
- Estimated credit score range (excellent 760+ / good 720-759 / fair 680-719 / below 680 / not sure)
- Timeline to close
- Their biggest concern or what's driving the question

PHASE 3 — CONFIRM CONTACT: Confirm full contact details: full name, phone, email, preferred method. Frame it as "so our licensed strategist can reach you about this specific scenario."

═══════════════════════════════════════════
COMPLETENESS — QUIETLY WORK THE CHECKLIST
═══════════════════════════════════════════
Keep a running mental checklist of what you still need. Before wrapping up, make sure you've naturally gathered (or genuinely attempted) the PHASE 2 items. Do NOT fire SCENARIO_COMPLETE the moment you have the bare minimum — a thin lead helps no one. Aim for a full picture:
- Critical to have: first name, at least one contact method, loan purpose, state, rough price/value, rough down payment or equity, income type, credit range, timeline.
- Strongly preferred: occupancy, property type, documentation type, first-time-buyer status (purchases), reserves (jumbo/investor), and their core concern or motivation.
If something's missing near the end, weave one more gentle question to fill the gap rather than skipping it. Only when you have a genuinely useful, well-rounded picture AND confirmed contact should you complete. If the borrower clearly wants to stop early, capture what you can (see ANTI-ABANDONMENT) and complete with what you have.

When you have a thorough picture AND confirmed contact, output EXACTLY this format on one line:
SCENARIO_COMPLETE:{"name":"...","phone":"...","email":"...","preferredContact":"...","loanPurpose":"...","state":"...","propertyAddress":"...","purchasePrice":"...","loanAmount":"...","downPayment":"...","occupancy":"...","propertyType":"...","incomeType":"...","creditScore":"...","timeline":"...","concern":"...","firstTimeBuyer":"...","docType":"...","reserves":"...","riskFlag":"LOW|MEDIUM|HIGH","mainConcern":"...","possiblePath":"...","documentsNeeded":"...","nextStep":"..."}

For any field you couldn't collect, use "not provided" rather than omitting it.

RISK FLAG (internal — do NOT show to borrower):
- LOW: W-2 stable, good credit (720+), strong down payment, full doc
- MEDIUM: commission/self-employed/1099/jumbo/recent job change/higher DTI
- HIGH: low credit (<680), no traditional income docs, urgent closing, DSCR/investor, bank-statement-only

POSSIBLE PATH should suggest from: conventional, FHA, VA, USDA, jumbo, bank statement, DSCR, non-QM, asset-based.

After SCENARIO_COMPLETE, write ONLY this message:
"Thank you! Based on the information you provided, your scenario may need review by a licensed mortgage professional. Possible paths may include conventional, FHA, jumbo, bank statement, DSCR, or non-QM depending on full application, credit, income, assets, property, lender guidelines, and MLO review. Our team at West Coast Capital Mortgage will reach out shortly via your preferred contact method."

Keep responses warm, concise, professional, and unhurried. Ask ONE thing at a time, always acknowledge their last answer first, and let the conversation build naturally toward a complete picture. Never give pricing or approval language. Never send the borrower to a website.`;

const DISCLAIMER = `WCCI Mortgage Strategy AI provides a preliminary mortgage scenario review and general educational information only. It is not a loan approval, preapproval, commitment to lend, rate quote, or underwriting decision. Educational information provided is general in nature and does not constitute mortgage advice for your specific situation. Actual loan terms, eligibility, pricing, and approval depend on full application review, credit review, income and asset documentation, property review, program guidelines, lender approval, and review by a licensed Mortgage Loan Originator. Specific numbers, thresholds, and program requirements change regularly — always consult with a licensed professional for current guidance.`;

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: `Hi there! I'm the Loan Strategy assistant at West Coast Capital Mortgage. I'm here to help you map out your mortgage — whether you know exactly what you want or you're just starting to explore. There's no pressure, no credit pull, and no obligation.\n\nTo start — what should I call you?`
};

function hasContactInfo(messages) {
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
  return /[\w.+\-]+@[\w\-]+\.[a-z]{2,}/i.test(userText) ||
    /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/.test(userText);
}

function buildDocumentChecklist(scenario) {
  const s = scenario || {};
  const income = (s.incomeType || '').toLowerCase();
  const purpose = (s.loanPurpose || '').toLowerCase();
  const concern = (s.concern || '').toLowerCase();
  const occupancy = (s.occupancy || '').toLowerCase();
  const buckets = [];

  const needsBankStmt = concern.includes('bank statement') || concern.includes('tax returns too low');
  const isInvestor = purpose.includes('investment') || occupancy.includes('investment') || income.includes('investor') || concern.includes('dscr');
  const isSelfEmp = income.includes('self-employed') || income.includes('1099') || income.includes('business owner') || income.includes('commission');
  const isW2 = income.includes('w-2') || income.includes('w2');
  const isRefi = purpose.includes('refinance') || purpose.includes('cash-out');

  if (needsBankStmt) {
    buckets.push({ label: 'Bank statement / non-QM', items: [
      '12 or 24 months personal or business bank statements',
      'Business verification (license, CPA letter, or website)',
      'Government-issued ID',
      'Asset statements (savings, retirement, reserves)',
    ]});
  } else if (isInvestor) {
    buckets.push({ label: 'DSCR / investor', items: [
      'Lease agreement or market rent estimate',
      'Property expenses (insurance, taxes, HOA estimate)',
      'Entity documents if applicable (LLC, trust)',
      'Asset statements',
      'Government-issued ID',
    ]});
  } else if (isSelfEmp) {
    buckets.push({ label: 'Self-employed / business owner', items: [
      'Last 2 years personal tax returns',
      'Business tax returns if applicable',
      'Year-to-date profit and loss statement',
      'Business bank statements',
      'Government-issued ID',
      'Asset statements',
    ]});
  } else if (isW2) {
    buckets.push({ label: 'W-2 borrower', items: [
      'Recent paystubs (last 30 days)',
      'Last 2 years W-2s',
      'Government-issued ID',
      'Recent bank statements',
      'Purchase contract if available',
    ]});
  } else {
    buckets.push({ label: 'Standard starting list', items: [
      'Government-issued ID',
      'Recent paystubs or income documentation',
      'Last 2 years tax returns',
      'Recent bank and asset statements',
    ]});
  }

  if (isRefi) {
    buckets.push({ label: 'Refinance', items: [
      'Current mortgage statement',
      'Homeowners insurance declaration page',
      'Property tax bill',
      'Payoff statement if available',
      'HELOC or second mortgage statement if applicable',
    ]});
  }

  const seen = new Set();
  const items = [];
  for (const b of buckets) {
    for (const it of b.items) {
      const key = it.toLowerCase();
      if (!seen.has(key)) { seen.add(key); items.push(it); }
    }
  }
  return { primaryLabel: buckets.map(b => b.label).join(' + '), items };
}

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scenario, setScenario] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [partialLeadCount, setPartialLeadCount] = useState(0);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (screen === 'chat') setTimeout(() => inputRef.current?.focus(), 200);
  }, [screen]);

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    setInput('');
    setLoading(true);
    const updated = [...messages, { role: 'user', content: text }];
    setMessages(updated);

    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: updated.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const fullText = (data.content || []).map(b => b.text || '').join('') || 'Connection error. Please try again.';

      let displayText = fullText;
      let parsedScenario = null;

      if (fullText.includes('SCENARIO_COMPLETE:')) {
        const parts = fullText.split('SCENARIO_COMPLETE:');
        try {
          parsedScenario = JSON.parse(parts[1].split('\n')[0].trim());
        } catch {}
        displayText = (parts[0].trim() + (parts[1].includes('\n') ? '\n' + parts[1].split('\n').slice(1).join('\n') : '')).trim();
      }

      const reply = { role: 'assistant', content: displayText };
      const final = [...updated, reply];
      setMessages(final);

      if (data._leadDelivery) {
        if (!data._leadDelivery.anyDelivered) setDeliveryFailed(true);
      }

      if (parsedScenario) {
        setScenario(parsedScenario);
        setTimeout(() => setScreen('capture'), 1800);
      } else if (hasContactInfo(final) && partialLeadCount < 2) {
        setPartialLeadCount(c => c + 1);
        fetch('/.netlify/functions/partial-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: final.map(m => ({ role: m.role, content: m.content })),
            updateNumber: partialLeadCount + 1,
          }),
        }).catch(() => {});
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please refresh and try again.' }]);
    }
    setLoading(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  // ─── Landing ───
  if (screen === 'landing') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #2563eb, #7c3aed, #0ea5e9)' }} />

        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 40px', background: 'rgba(255,255,255,0.95)', borderBottom: '1px solid #e2e8f0', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 100 }}>
          <a href="https://wcci.online" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>W</div>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>West Coast Capital</span>
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a href="tel:+13106865053" style={{ fontSize: 14, color: '#64748b', textDecoration: 'none', fontWeight: 500 }}>(310) 686-5053</a>
            <button onClick={() => setScreen('chat')} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Get Started</button>
          </div>
        </nav>

        <div style={{ maxWidth: 860, margin: '0 auto', padding: '88px 40px 80px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 20, padding: '6px 14px', marginBottom: 36 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, color: '#2563eb', fontWeight: 500 }}>AI-Powered · No Credit Pull · Free</span>
          </div>

          <h1 style={{ fontSize: 'clamp(38px, 7vw, 70px)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: 24 }}>
            Your mortgage strategy,<br />
            <span style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>powered by AI</span>
          </h1>

          <p style={{ fontSize: 'clamp(16px, 2vw, 18px)', color: '#475569', lineHeight: 1.75, maxWidth: 520, margin: '0 auto 48px' }}>
            Describe your scenario. Get a clear loan strategy in minutes — not days. No forms, no credit check, no pressure.
          </p>

          <button
            onClick={() => setScreen('chat')}
            style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: 'white', border: 'none', borderRadius: 12, padding: '16px 36px', fontSize: 16, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 24px rgba(37,99,235,0.35)', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(37,99,235,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 24px rgba(37,99,235,0.35)'; }}
          >
            Start Your Scenario →
          </button>
          <p style={{ marginTop: 14, fontSize: 13, color: '#94a3b8' }}>Takes 3–5 minutes · 100% confidential</p>

          {/* Demo chat preview */}
          <div style={{ marginTop: 60, background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.08)', padding: 24, maxWidth: 540, margin: '60px auto 0', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>AI</div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Loan Strategy AI</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />Online
              </span>
            </div>
            {[
              { ai: true, text: "Hi! Are you looking to purchase or refinance? And what state is the property in?" },
              { ai: false, text: "Purchase in California. $1.2M home, I'm self-employed." },
              { ai: true, text: "Got it! For a $1.2M purchase in CA with self-employed income, we'll explore bank statement or non-QM options. What's your approximate down payment?" },
            ].map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.ai ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
                <div style={{ background: msg.ai ? '#f8fafc' : 'linear-gradient(135deg, #2563eb, #7c3aed)', color: msg.ai ? '#334155' : 'white', border: msg.ai ? '1px solid #e2e8f0' : 'none', borderRadius: msg.ai ? '4px 12px 12px 12px' : '12px 4px 12px 12px', padding: '10px 14px', fontSize: 13, lineHeight: 1.6, maxWidth: '82%' }}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div style={{ background: 'white', borderTop: '1px solid #e2e8f0', padding: '72px 40px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 28 }}>
            {[
              { icon: '⚡', bg: '#fef3c7', title: 'Instant Clarity', desc: 'AI identifies the right loan type — conventional, jumbo, bank statement, or non-QM — in minutes.' },
              { icon: '🔒', bg: '#f0fdf4', title: 'No Hard Pull', desc: 'Zero credit inquiries. We only need a rough score range to map your strategy.' },
              { icon: '🎯', bg: '#eff6ff', title: 'Expert Review', desc: 'After your AI session, our licensed team personally reviews your file if needed.' },
            ].map((f, i) => (
              <div key={i} style={{ padding: 28, borderRadius: 12, border: '1px solid #f1f5f9', background: '#fafafa' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: f.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 14 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: '#f8fafc', padding: '24px 40px', borderTop: '1px solid #e2e8f0' }}>
          <p style={{ maxWidth: 800, margin: '0 auto', fontSize: 11, color: '#94a3b8', lineHeight: 1.7, textAlign: 'center' }}>{DISCLAIMER}</p>
        </div>

        <footer style={{ textAlign: 'center', padding: '28px 40px', borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8' }}>
          © 2026 West Coast Capital Mortgage · <a href="https://wcci.online" style={{ color: '#94a3b8' }}>wcci.online</a> · NMLS #2817729 · Equal Housing Lender
        </footer>
      </div>
    );
  }

  // ─── Chat ───
  if (screen === 'chat') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>
        {/* Chat header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'white', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <button onClick={() => setScreen('landing')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 12, fontWeight: 700 }}>AI</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Loan Strategy AI</div>
              <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />Online · West Coast Capital
              </div>
            </div>
          </div>
          <div style={{ width: 60 }} />
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>
          {messages.map((msg, i) => (
            <div key={i} className="chat-msg" style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
              {msg.role === 'assistant' && (
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
              )}
              <div style={{
                background: msg.role === 'user' ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'white',
                color: msg.role === 'user' ? 'white' : '#1e293b',
                border: msg.role === 'assistant' ? '1px solid #e2e8f0' : 'none',
                borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                padding: '12px 16px', fontSize: 14, lineHeight: 1.7, maxWidth: '78%',
                boxShadow: msg.role === 'assistant' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
              }}>
                {msg.content.split('\n').map((line, j, arr) => (
                  <span key={j}>{renderBold(line)}{j < arr.length - 1 && <br />}</span>
                ))}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '4px 16px 16px 16px', padding: '14px 18px', display: 'flex', gap: 5, alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {[0, 0.2, 0.4].map((d, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block', animation: `pulse 1.2s ease-in-out ${d}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ background: 'white', borderTop: '1px solid #e2e8f0', padding: '14px 16px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your scenario..."
              rows={1}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', fontSize: 14, resize: 'none', fontFamily: "'Inter', sans-serif", lineHeight: 1.5, color: '#0f172a', background: '#f8fafc', transition: 'border-color 0.2s, box-shadow 0.2s' }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{ width: 44, height: 44, background: input.trim() ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : '#e2e8f0', border: 'none', borderRadius: 10, color: 'white', fontSize: 18, cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >→</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 8 }}>West Coast Capital Mortgage · NMLS #2817729</p>
        </div>
      </div>
    );
  }

  // ─── Capture / Summary ───
  const s = scenario || {};
  const checklist = buildDocumentChecklist(s);

  return (
    <div style={{ minHeight: '100vh', background: '#eef0f4', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div className="fade-up" style={{ background: 'white', maxWidth: 520, width: '100%', boxShadow: '0 12px 56px rgba(10,36,99,0.14)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: '#0a2463', padding: '36px 40px 32px', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', color: 'white', fontSize: 20 }}>✓</div>
          <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 22, fontWeight: 400, color: 'white', marginBottom: 6, letterSpacing: '0.01em' }}>Loan Strategy Summary</h2>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}>West Coast Capital Mortgage</p>
        </div>

        {/* Delivery failure banner */}
        {deliveryFailed && (
          <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <p style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
              We couldn't deliver your scenario automatically. Please call <a href="tel:+13106865053" style={{ color: '#92400e', fontWeight: 600 }}>(310) 686-5053</a> to connect with a strategist.
            </p>
          </div>
        )}

        {/* Scenario fields */}
        <div style={{ padding: '4px 40px 0' }}>
          {[
            ['Name', s.name], ['Phone', s.phone], ['Email', s.email],
            ['Loan Purpose', s.loanPurpose], ['State', s.state],
            ['Purchase Price', s.purchasePrice], ['Loan Amount', s.loanAmount],
            ['Down Payment', s.downPayment], ['Occupancy', s.occupancy],
            ['Property Type', s.propertyType], ['Credit Score', s.creditScore],
            ['Income Type', s.incomeType], ['Doc Type', s.docType],
            ['First-Time Buyer', s.firstTimeBuyer], ['Timeline', s.timeline],
            ['Concern', s.concern],
          ].filter(([, v]) => v && v !== 'not provided').map(([label, val], i, arr) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderBottom: i < arr.length - 1 ? '1px solid #f0f2f6' : 'none' }}>
              <span style={{ fontSize: 10, color: '#9aa3b2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', flexShrink: 0 }}>{label}</span>
              <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, color: '#0a2463', textAlign: 'right', maxWidth: '58%', lineHeight: 1.4 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Possible path */}
        {s.possiblePath && (
          <div style={{ margin: '20px 40px 0' }}>
            <div style={{ borderLeft: '3px solid #0a2463', background: '#f7f8fc', padding: '13px 16px' }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, color: '#0a2463', lineHeight: 1.75, fontStyle: 'italic' }}>
                Possible path: {s.possiblePath}
              </p>
            </div>
          </div>
        )}

        {/* Document checklist */}
        <div style={{ margin: '20px 40px 0' }}>
          <p style={{ fontSize: 10, color: '#9aa3b2', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Documents Likely Needed ({checklist.primaryLabel})
          </p>
          {checklist.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, color: '#475569' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0 }}>☐</span>
              {item}
            </div>
          ))}
        </div>

        {/* Next steps */}
        <div style={{ padding: '24px 40px 40px' }}>
          {confirmed ? (
            <div style={{ textAlign: 'center', paddingTop: 8 }}>
              <p style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 21, color: '#0a2463', marginBottom: 10 }}>You're all set.</p>
              <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.75, marginBottom: 24 }}>
                A licensed strategist from West Coast Capital will reach out within 1 business hour.
              </p>
              <button
                onClick={() => { setScreen('chat'); setMessages([INITIAL_MESSAGE]); setScenario(null); setConfirmed(false); setPartialLeadCount(0); setDeliveryFailed(false); }}
                style={{ background: 'none', color: '#0a2463', border: '1px solid #0a2463', padding: '10px 22px', fontSize: 13, cursor: 'pointer', fontWeight: 500, letterSpacing: '0.02em' }}
              >Start New Scenario</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: '#8a94a6', marginBottom: 14, textAlign: 'center', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>How would you like to proceed?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => { window.open('https://calendly.com/westccmortgage', '_blank'); setConfirmed(true); }}
                  style={{ background: '#0a2463', color: 'white', border: 'none', padding: 14, fontSize: 14, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.03em' }}
                >Schedule a Call</button>
                <button
                  onClick={() => setConfirmed(true)}
                  style={{ background: 'white', color: '#0a2463', border: '1.5px solid #0a2463', padding: 14, fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.03em' }}
                >I'll Wait for a Call</button>
              </div>
            </>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ padding: '16px 40px 20px', borderTop: '1px solid #f0f2f6' }}>
          <p style={{ fontSize: 10, color: '#b0b8c9', lineHeight: 1.6, textAlign: 'center' }}>{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  );
}

function renderBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
