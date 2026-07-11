// Conversation intelligence — the durable MortgageConversationState.
//
// The assistant must understand the WHOLE conversation, not the last message:
// location, loan purpose, borrower type, emotional/trust posture, objections,
// contact consent, and readiness. This module owns that state:
//
//   • initialConversationState()        — fresh state
//   • updateStateFromUserMessage(...)   — deterministic detectors (EN/ES/RU)
//   • applyStatePatch(...)              — guarded merge of the model's patch
//   • buildIntelContext(...)            — the per-turn prompt block
//
// Guarantees enforced here (not left to the model):
//   – contactConsent "declined" is STICKY: only an explicit user request for
//     human contact / clear readiness can lift it. The model cannot flip it.
//   – "I'm not sure" is never consent. "I want to read first" → trust_building.
//   – Nothing here stores full message text; only extracted, non-PII facts.

import { GEO_KEYWORDS } from './resources/site-registry.js';

export function initialConversationState() {
  return {
    language: 'en',
    stage: 'discovery',
    loanGoal: undefined,
    state: undefined, county: undefined, city: undefined, zip: undefined,
    trustLevel: 'unknown',
    objections: [],
    contactConsent: 'unknown',
    contactAskCount: 0,
    userRequestedHuman: false,
    competitorMention: undefined,
    tonePreference: undefined,
    audience: 'consumer_borrower',
    topics: [],
    resolvedTopics: [],       // topics deterministically settled (e.g. jumbo→conforming)
    wantsApply: false,
    handoff: 'none',          // none | offer | requested | consented | submitted | declined
    recommendedResourceIds: [],
    lastResourceIds: [],
    lastContactAskTurn: undefined,
    turn: 0,
  };
}

// ── Multilingual detector patterns (stems, case-insensitive) ──
const P = {
  contactRefusal: [
    /\b(not|never|no)\b[^.!?]{0,40}\b(giv(e|ing)|shar(e|ing)|provid)/i,   // not giving you my info
    /\bno (thanks|contact|phone|email)\b/i,
    /\bdon'?t (call|contact|email|phone) me\b/i,
    /\bstop asking\b/i,
    /\bwithout (giving|sharing|leaving)\b[^.!?]{0,30}\b(info|contact|number|email)/i,
    /\bno (quiero|voy a|pienso) (dar|compartir|dejar)\b/i,                 // ES
    /\bno me llamen\b/i, /\bsin (dar|dejar) (mis )?datos\b/i,
    /не (дам|буду давать|хочу давать|оставлю|хочу оставлять)/i,            // RU
    /не (звоните|пишите|надо звонить)/i, /без (контактов|телефона)/i,
    /不(想|愿意)(留下?|给|提供)[^。！？]{0,6}(电话|号码|手机|联系方式|个人信息|信息)/, // ZH
    /不留(电话|号码|联系方式)/, /不想(被)?(打电话|来电|联系|打扰)/, /别(给我)?(打电话|来电|联系)/, /只(想)?先(了解|看看)/,
  ],
  privacy: [
    /\bprivacy|private|data (protection|sharing)|sell my (info|data)\b/i,
    /\b(every|all|multiple) lenders? (calling|contact)/i, /\bspam|robocall/i,
    /\bprivacidad|datos personales\b/i, /todos los prestamistas.{0,20}(llam|contact)/i, /no quiero que.{0,30}llam/i,
    /конфиденциальн|персональны[ех] данн|спам/i, /(все|всякие) кредитор[ыов].{0,20}(звон|писа|донимал)/i, /не хочу[, ]+чтобы.{0,30}звонил/i,
    /隐私|个人(数据|信息)保护|出售我的(信息|数据)/, /不想(被)?(很多|多个|多家|一堆)[^。]{0,4}(公司|贷款|机构)[^。]{0,4}(打电话|联系)/, /骚扰|垃圾(电话|短信)/, // ZH
  ],
  identity: [
    /\bwho (are|is) (you|this|behind)\b/i, /\bwho are you people\b/i,
    /\breal (company|business|people)\b/i, /\bis this legit(imate)?\b/i, /\bscam\b/i,
    /\bwhere can i read about\b/i, /\babout (the|your) company\b/i,
    /\bqui[eé]n(es)? (son|est[aá]) (ustedes|detr[aá]s)\b/i, /\bempresa real\b/i,
    /кто (вы|за этим стоит|вы такие)/i, /это (настоящая|реальная) компания/i, /почитать о (вас|компании)/i,
    /你们是谁|(这是|你们是)(什么|哪家)(公司|平台|机构)|背后是谁|谁(在|的)?(运营|背后)|(是|是不是)(真的|正规|靠谱)(公司|平台|的吗|吗)|关于(你们|贵)?(的)?公司|靠谱吗|正规吗/, // ZH
  ],
  licensing: [
    /\blicens(e|ed|ing)|nmls|dre\b/i,
    /\blicencia\b/i,
    /лиценз/i,
    /执照|牌照|持牌|资质/, // ZH
  ],
  aiSkepticism: [
    /\b(are you|is this) (a |an )?(bot|robot|ai|real person|human)\b/i,
    /\beres un (bot|robot)\b/i, /\bpersona real\b/i,
    /\bты (бот|робот)\b/i, /вы (бот|робот|человек)/i, /живой человек/i,
    /你是(机器人|真人|人工智能|AI|ai)|是不是(机器人|真人|ai|AI)|是(真人|机器人)吗|真人吗/, // ZH
  ],
  fees: [
    /\b(fee|fees|charge[ds]?|junk fees|why so (much|expensive)|overcharg)/i,
    /\b(cargos?|tarifas?|honorarios|comisi[oó]n)\b/i,
    /комисси|сборы|почему так дорого/i,
    /费用|收费|手续费|为什么(这么|那么)(贵|多)/, // ZH
  ],
  salesPressure: [
    /\b(stop selling|too pushy|pressur(e|ing)|salesy)\b/i,
    /\bpresi[oó]n\b/i, /давите|навязыва/i,
    /别(推销|催我?)|太(推销|急)|不要(逼|催)/, // ZH
  ],
  accuracy: [
    /\b(that('s| is) wrong|incorrect|doesn'?t add up|made up|inaccurate)\b/i,
    /\bno es correcto\b/i, /неправильно|неточно|выдума/i,
    /(不对|不正确|不准确|算错|有误|说错)/, // ZH
  ],
  readFirst: [
    /\b(read|research|look into|review) (it |this |things )?(first|before)\b/i,
    /\bexplain (it )?before i apply\b/i, /\bbefore (i|we) (apply|commit|decide)\b/i,
    /\bleer primero\b/i, /\bantes de (aplicar|decidir)\b/i,
    /сначала (почитаю|почитать|изучу|разобраться)/i, /прежде чем (подавать|решать)/i,
    /先(了解|看看|研究|读)[^。]{0,4}(一下|再|才|清楚)?|在?申请(之)?前|先不(申请|决定)/, // ZH
  ],
  humanRequest: [
    /\b(talk|speak) (to|with) (a |an? )?(human|person|someone|agent|broker|loan officer)\b/i,
    /\bcall me\b/i, /\bhave someone (call|reach|contact)\b/i, /\bcontact me\b/i,
    /\bhablar con (una persona|alguien|un humano)\b/i, /\bll[aá]menme\b/i,
    /поговорить с (человеком|кем-то|специалистом)/i, /позвоните мне/i, /свяжитесь со мной/i,
    /(联系|打电话给|致电)我|给我(回|来)电|想(和|跟)(真人|人|专业人士|经纪人|贷款专员)[^。]{0,3}(谈|聊|说|沟通|通话)/, // ZH
  ],
  readiness: [
    /\b(i'?m|we'?re) ready\b/i, /\bready to (apply|start|move forward|proceed)\b/i,
    /\bapply now\b/i, /\blet'?s (do it|start|apply)\b/i,
    /\blisto para (aplicar|empezar)\b/i, /\bquiero aplicar\b/i,
    /гото[вы]{1,2} (подать|начать|оформ)/i, /хочу подать заявку/i, /давайте начн[её]м/i,
    /我(准备好|想现在)?(就)?(开始|申请)|现在(就)?申请|可以开始了|我准备好了/, // ZH
  ],
  applyIntent: [
    /\b(apply|application|upload (my )?document|loan status|track my loan|secure portal)\b/i,
    /\b(solicitud|aplicar|subir documentos)\b/i,
    /подать заявку|загрузить документ|статус (кредита|заявки)/i,
    /申请贷款|提交申请|上传(文件|文档|材料)|贷款(状态|进度)/, // ZH
  ],
  plainEnglish: [
    /\b(plain english|simple terms|simply|like i'?m five|beginner|first[- ]time buyer|new to this)\b/i,
    /\ben t[eé]rminos sencillos|primeriz[oa]|primera vez\b/i,
    /прост(ыми|о) (словами|объясн)|впервые|первый раз/i,
    /(通俗|简单|直白)[^。]{0,3}(解释|说|讲)|新手|第一次|不太懂|听不懂/, // ZH
  ],
};

const COMPETITORS = ['wells fargo', 'chase', 'bank of america', 'bofa', 'citi', 'citibank', 'us bank', 'rocket', 'quicken', 'better.com', 'sofi', 'my bank', 'mi banco', 'мой банк', 'своем банке', 'своём банке'];

// Topic detectors → registry topic tags.
const TOPIC_PATTERNS = [
  [/jumbo/i, 'jumbo'],
  [/high[- ]balance/i, 'high_balance'],
  [/conforming|county (loan )?limit|loan limit/i, 'county_limit'],
  [/\bpoints?\b|discount point|buy[- ]?down|buydown/i, 'points'],
  [/interest[- ]only/i, 'interest_only'],
  [/dscr|rental income quali/i, 'dscr'],
  [/bank statement|银行流水/i, 'bank_statement'],
  [/超额贷款|超限贷款/i, 'jumbo'],
  [/\bbridge\b|puente/i, 'bridge'],
  [/fix (and|&) flip/i, 'fix_and_flip'],
  [/construction completion|finish (my )?construction/i, 'construction_completion'],
  [/ground[- ]up|new construction|construir/i, 'ground_up'],
  [/second (deed|lien|mortgage)|2nd (deed|lien|td)\b/i, 'second_lien'],
  [/business[- ]purpose cash[- ]?out/i, 'business_purpose'],
  [/private (money|capital|lender)\b/i, 'private_money'],
  [/bank (declined|denied|turned (me|us) down)/i, 'bank_decline'],
  [/invest(ing|or)?[^.]{0,40}\bnotes?\b|\bnotes?\b[^.]{0,25}invest|note investing|trust[- ]?deed invest|first[- ]lien (note|invest|private credit|mortgage note)|interest income (from|on)|mortgage[- ]note (invest|fund)/i, 'notes_investing'],
  [/token(iz|is)|digital asset|rwa\b|digital ownership|kyc\/?aml/i, 'tokenization'],
  [/capital network|deal room|raise capital|capital (source|relationship)|fund manager/i, 'capital_network'],
  [/\bcrm\b|pipeline|lead management/i, 'crm'],
  [/development (experience|background|project)|built (homes|houses|projects)|developer/i, 'development'],
  [/first[- ]time buyer|primeriz|первый (дом|раз покупа)/i, 'first_time_buyer'],
  [/apply|application|solicitud|заявк/i, 'apply'],
  [/upload.{0,12}document|subir documentos|загрузить документ/i, 'documents'],
  [/refinanc|refi\b|рефинанс|再融资|重新贷款|重贷/i, 'refinance'],
  [/purchase|buy(ing)?\b|compra|покупк|купить|购房|买房|购买|买一套|买房子/i, 'purchase'],
  [/self[- ]employed|business owner|независим|самозанят|trabajador independiente|dueñ[oa] de negocio|自雇|个体经营|个体户/i, 'self_employed'],
  [/dscr|债务偿付覆盖率/i, 'dscr'],
  [/投资房|投资房产|投资物业/i, 'purchase'],
];

const any = (patterns, text) => patterns.some(re => re.test(text));

// Detect explicit user requests that unlock stage-gated resources (EN/ES/RU/zh).
// Used so the router can honor "unless the user explicitly asks for a link/tool".
export function detectResourceIntents(text) {
  const t = String(text || '');
  const explicit = /\b(link|links|resource|resources|page|website|url|show me|send me|give me|do you have)\b/i.test(t)
    || /enlace|recurso|página|sitio web/i.test(t)
    || /ссылк|ресурс|страниц|сайт/i.test(t)
    || /链接|资源|网站|页面|发(给我|我)|给我看/.test(t);
  const calculator = /calculat|estimate tool|payment tool/i.test(t)
    || /calculadora/i.test(t) || /калькулятор|посчита/i.test(t) || /计算器|计算一下|算一下/.test(t);
  const california = /california\s+(resource|guide|page|info|specific|tool|calculator)|california[- ]specific|about california/i.test(t)
    || /recursos? de california|guía de california/i.test(t)
    || /калифорнийск/i.test(t)
    || /加州(的)?(资源|指南|信息|工具|计算器|页面)/.test(t);
  const structure = /buy[- ]?down|interest[- ]only|discount points?|\bpoints?\b|payment strategy|compare (loan )?structures?/i.test(t)
    || /买断利率|折扣点|只付利息|付款策略/.test(t);
  return { explicit, calculator, california, structure };
}

// Curated, unambiguous city→county facts (NOT guesses — these cities are
// wholly within the county). Used only to preserve routing context.
const KNOWN_CITY_COUNTY = {
  'key west': 'monroe', 'florida keys': 'monroe', 'the keys': 'monroe',
  'marathon': 'monroe', 'islamorada': 'monroe', 'key largo': 'monroe',
};

function detectGeo(text) {
  const lower = text.toLowerCase();
  const out = {};
  for (const g of GEO_KEYWORDS) {
    if (lower.includes(g.keyword)) {
      if (g.kind === 'city' && !out.city) out.city = g.value;
      if (g.kind === 'county' && !out.county) out.county = g.value;
    }
  }
  if (!out.county && out.city && KNOWN_CITY_COUNTY[out.city]) out.county = KNOWN_CITY_COUNTY[out.city];
  const zip = lower.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) out.zip = zip[1];
  return out;
}

function pushUnique(arr, v) { if (!arr.includes(v)) arr.push(v); }

/**
 * Deterministically update state from one user turn. Returns a NEW state.
 * @param {object} state   previous MortgageConversationState
 * @param {string} text    the user's message
 * @param {object} profile current Loan Strategy Profile (already parsed facts)
 * @param {string} lang    active UI language
 */
export function updateStateFromUserMessage(state, text, profile = {}, lang) {
  const s = { ...state, objections: [...(state.objections || [])], topics: [...(state.topics || [])] };
  s.turn = (s.turn || 0) + 1;
  if (lang) s.language = lang;

  // Geography: profile (parser/AI) is primary; message keywords fill gaps.
  const geo = detectGeo(text);
  s.state = profile.state || s.state;
  s.city = geo.city || s.city;
  s.county = geo.county || s.county;
  s.zip = geo.zip || profile.zipOrCounty && /^\d{5}$/.test(profile.zipOrCounty) ? (geo.zip || profile.zipOrCounty) : s.zip;

  // Loan goal from profile.
  if (profile.loanPurpose) {
    s.loanGoal = { purchase: 'purchase', refinance: 'rate_term_refinance', 'cash-out': 'cash_out_refinance', investment: 'investment' }[profile.loanPurpose] || s.loanGoal;
  }

  // Topics.
  for (const [re, tag] of TOPIC_PATTERNS) if (re.test(text)) pushUnique(s.topics, tag);

  // Objections & trust posture.
  const found = [];
  if (any(P.privacy, text)) found.push('privacy');
  if (any(P.identity, text)) found.push('identity');
  if (any(P.licensing, text) && (any(P.identity, text) || /verify|verificar|провер|licens|licencia|лиценз/i.test(text))) found.push('licensing');
  if (any(P.fees, text) && /\?|why|por qu[eé]|почему|too (high|much)|объясн/i.test(text)) found.push('fees');
  if (any(P.aiSkepticism, text)) found.push('ai_skepticism');
  if (any(P.salesPressure, text)) found.push('sales_pressure');
  if (any(P.accuracy, text)) found.push('accuracy');
  for (const o of found) pushUnique(s.objections, o);

  // Competitor mention → bank_comparison objection (neutral handling).
  const lower = text.toLowerCase();
  const comp = COMPETITORS.find(c => lower.includes(c));
  if (comp) { s.competitorMention = comp; pushUnique(s.objections, 'bank_comparison'); }

  // Contact refusal → sticky decline.
  if (any(P.contactRefusal, text)) {
    s.contactConsent = 'declined';
    pushUnique(s.objections, 'contact_hesitation');
    if (s.handoff === 'offer') s.handoff = 'declined';
  }

  // Human request / readiness lift a previous decline (explicit user action).
  if (any(P.humanRequest, text)) {
    s.userRequestedHuman = true;
    s.handoff = 'requested';
    if (s.contactConsent === 'declined') s.contactConsent = 'unknown';
  }
  if (any(P.readiness, text)) {
    s.stage = 'human_review_ready';
    s.handoff = s.handoff === 'none' || s.handoff === 'declined' || s.handoff === 'offer' ? 'requested' : s.handoff;
    if (s.contactConsent === 'declined') s.contactConsent = 'unknown';
  }
  if (any(P.applyIntent, text) && !any(P.contactRefusal, text)) s.wantsApply = true;

  // Tone.
  if (any(P.plainEnglish, text)) s.tonePreference = 'plain_english';

  // Audience shifts (explicit, topic-driven — a mortgage mention never does this).
  if (s.topics.includes('notes_investing')) s.audience = 'qualified_investor';
  else if (s.topics.includes('tokenization')) s.audience = 'qualified_investor';
  else if (s.topics.includes('capital_network')) s.audience = 'capital_professional';
  else if (s.topics.includes('crm') && /\b(i'?m|i am|as) a (loan officer|broker|realtor|agent)|my (clients|pipeline)\b/i.test(text)) s.audience = 'mortgage_professional';

  // Stage machine.
  const trusty = found.some(o => ['privacy', 'identity', 'licensing', 'ai_skepticism'].includes(o));
  if (any(P.readFirst, text) || trusty) s.stage = 'trust_building';
  else if (s.stage === 'discovery' && (profile.purchasePrice || s.topics.length > 1)) s.stage = 'education';
  if (s.competitorMention && s.stage !== 'trust_building') s.stage = 'comparison';

  // Trust level heuristic.
  if (trusty && s.trustLevel === 'unknown') s.trustLevel = 'low';
  else if (!trusty && s.trustLevel === 'low' && s.turn > 2) s.trustLevel = 'developing';
  else if (s.trustLevel === 'developing' && (s.stage === 'human_review_ready' || any(P.readiness, text))) s.trustLevel = 'comfortable';
  if (s.trustLevel === 'unknown' && s.turn >= 3) s.trustLevel = 'developing';

  return s;
}

// Guarded merge of the model's CONVO_META state patch. The model may refine
// stage/trust/objections; it may NOT invent consent or undo a sticky decline.
export function applyStatePatch(state, patch) {
  if (!patch || typeof patch !== 'object') return state;
  const s = { ...state, objections: [...(state.objections || [])] };
  const STAGES = ['discovery', 'education', 'comparison', 'trust_building', 'human_review_ready', 'handoff_requested', 'handoff_declined'];
  const TRUST = ['unknown', 'low', 'developing', 'comfortable'];
  const OBJ = ['privacy', 'identity', 'licensing', 'fees', 'bank_comparison', 'ai_skepticism', 'sales_pressure', 'contact_hesitation', 'accuracy'];

  if (STAGES.includes(patch.stage)) s.stage = patch.stage;
  if (TRUST.includes(patch.trustLevel)) s.trustLevel = patch.trustLevel;
  if (Array.isArray(patch.objections)) for (const o of patch.objections) if (OBJ.includes(o)) pushUnique(s.objections, o);
  if (typeof patch.loanGoal === 'string') s.loanGoal = patch.loanGoal;

  // Consent guard: model can record a decline, never a grant.
  if (patch.contactConsent === 'declined') s.contactConsent = 'declined';

  return s;
}

// Explicit consent grant — only from a real user action (submitting the
// contact form, or clearly stating readiness detected client-side).
export function grantContactConsent(state) {
  return { ...state, contactConsent: 'granted', handoff: state.handoff === 'submitted' ? 'submitted' : 'consented' };
}

// ── Prompt block ──
const CONSENT_LINES = {
  declined: 'CONTACT POLICY: consent is DECLINED. Do NOT ask for name, phone, or email in this reply — no exceptions, no "just a first name". Do not mention the contact form. Keep helping fully. Only an explicit user request for human contact lifts this.',
  granted: 'CONTACT POLICY: consent granted — contact details may be confirmed naturally when useful.',
  unknown: 'CONTACT POLICY: consent unknown. Deliver value first. Do not request contact details until the borrower has received a useful answer, possible paths, and shows readiness; then you may OFFER (not demand) human review once. "I\'m not sure" is NOT consent.',
};

/**
 * Build the per-turn intelligence block appended to the system prompt.
 * @param {object} state MortgageConversationState
 * @param {Array<{id:string, reasonKey:string}>} candidates deterministic router output
 * @param {string} lang UI language
 * @param {(id:string)=>object|null} getResource registry lookup
 */
export function buildIntelContext(state, candidates, lang, getResource, opts = {}) {
  const lines = [];
  lines.push('=== CONVERSATION INTELLIGENCE (app-tracked across the WHOLE conversation — obey strictly) ===');
  lines.push(`Stage: ${state.stage}. Trust level: ${state.trustLevel}. Language: ${state.language}.`);
  if (opts.leadSubmitted) lines.push('LEAD STATUS: a qualified lead for this scenario was ALREADY SUBMITTED. Do NOT trigger automatic_lead or SCENARIO_COMPLETE again — just keep helping naturally.');
  else if (opts.leadFailed) lines.push('LEAD STATUS: an earlier lead delivery attempt failed; the app will retry automatically. Do not mention this to the borrower.');
  if (state.objections.length) lines.push(`Active objections: ${state.objections.join(', ')}. Address them with facts and control — never with pressure.`);
  if (state.competitorMention) lines.push(`The borrower mentioned "${state.competitorMention}". Respect the comparison. Explain neutrally that brokers and retail banks may have access to different products, pricing structures, or underwriting channels. NEVER claim a specific bank lacks a product or is worse.`);
  const geo = [state.city, state.county && `${state.county} County`, state.state].filter(Boolean).join(', ');
  if (geo) lines.push(`Known property geography: ${geo}.`);
  if (state.userRequestedHuman) lines.push('The borrower has ASKED for human contact — proceed warmly with the handoff.');
  lines.push(CONSENT_LINES[state.contactConsent] || CONSENT_LINES.unknown);

  if (candidates && candidates.length) {
    lines.push('');
    lines.push('=== VERIFIED RESOURCES YOU MAY RECOMMEND THIS TURN (0–3, by id only) ===');
    lines.push('The app renders these as clickable cards under your message. Choose only the ones that genuinely help RIGHT NOW (often zero or one). Explain the important facts IN CHAT FIRST — a link never replaces an answer. Never output a URL yourself; never invent a resource id.');
    for (const c of candidates) {
      const r = getResource(c.id);
      if (r) lines.push(`- id:"${c.id}" — ${r.brand}: ${r.title}. ${r.shortDescription.en}`);
    }
  } else {
    lines.push('');
    lines.push('No verified resources match this turn — recommend none (empty resources array). Never invent one.');
  }

  lines.push('');
  lines.push('OUTPUT FORMAT — at the very end of EVERY reply add this machine-only line (stripped before display), BEFORE the PROFILE_UPDATE line:');
  lines.push('CONVO_META:{"resources":[{"id":"<id from the list above>","reason":"<one-sentence reason in the conversation language>"}],"state":{"stage":"...","trustLevel":"...","objections":[...],"contactConsent":"declined|unknown"},"handoff":"none|offer|requested"}');
  lines.push('When the scenario meets MINIMUM COMPLETION (see HANDOFF section), use the object form instead: "handoff":{"mode":"automatic_lead","reason":"scenario_sufficiently_complete","confidence":0.0-1.0}. The app validates independently before anything is sent.');
  lines.push('Rules: resources ⊆ the ids listed above (else empty []). Use handoff:"offer" ONLY when genuinely appropriate and consent is not declined. Never set contactConsent to "granted" — only the app can. Never claim a lead was submitted — the app tracks true delivery status. Valid one-line JSON.');
  return '\n\n' + lines.join('\n');
}
