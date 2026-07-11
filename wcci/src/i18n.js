// UI translations for EN / ES / RU.
// Legal text (DISCLAIMER, NMLS footer) stays English by design — see brief.
// The AI conversation itself is multilingual via the system prompt.

// Supported UI locales. zh-CN (Simplified Chinese) is a first-class locale.
// Structure is locale-keyed throughout so zh-Hant (Traditional) can be added
// later by filling entries — not by rewriting the app.
export const LANGS = ['en', 'es', 'ru', 'zh-CN'];

// Friendly switcher labels (never uppercase Chinese).
export const LANG_LABELS = { en: 'EN', es: 'ES', ru: 'RU', 'zh-CN': '中文' };

export const DISCLAIMER = `WCCI Mortgage Strategy AI provides a preliminary mortgage scenario review and general educational information only. It is not a loan approval, preapproval, commitment to lend, rate quote, or underwriting decision. Educational information provided is general in nature and does not constitute mortgage advice for your specific situation. Actual loan terms, eligibility, pricing, and approval depend on full application review, credit review, income and asset documentation, property review, program guidelines, lender approval, and review by a licensed Mortgage Loan Originator. Specific numbers, thresholds, and program requirements change regularly — always consult with a licensed professional for current guidance.`;

// ─────────────────────────────────────────────────────────────────────────
// CANONICAL LICENSING — derived from src/config/companyFacts.js (the single
// source of truth). These re-exports keep every existing import site working.
// The COMPANY NMLS (#2817729) and the BROKER's individual NMLS (#2775380) are
// DIFFERENT and must never be interchanged.
// ─────────────────────────────────────────────────────────────────────────
import { COMPANY_FACTS, COMPANY_LICENSE_LINE, BROKER_LICENSE_LINE } from './config/companyFacts.js';

export const COMPANY_NAME = COMPANY_FACTS.legalEntity;
export const COMPANY_LICENSE = COMPANY_LICENSE_LINE;
export const COMPANY_NMLS = COMPANY_FACTS.companyNmls;
export const COMPANY_DRE = COMPANY_FACTS.companyDreCorporationLicense;

export const BROKER_NAME = COMPANY_FACTS.founderName;
export const BROKER_TITLE = COMPANY_FACTS.founderTitle;
export const BROKER_LICENSE = BROKER_LICENSE_LINE;
export const BROKER_NMLS = COMPANY_FACTS.founderNmls;
export const BROKER_DRE = COMPANY_FACTS.founderDreBrokerLicense;

// ── Canonical contact (single source: companyFacts.js) ──
// OFFICE is the general company number; DIRECT is Anatoliy's line. Never show
// the direct number as the only/general company number.
export const OFFICE_PHONE = COMPANY_FACTS.officePhone;
export const OFFICE_PHONE_HREF = COMPANY_FACTS.officePhoneHref;
export const DIRECT_PHONE = COMPANY_FACTS.directPhone;
export const DIRECT_PHONE_HREF = COMPANY_FACTS.directPhoneHref;
export const COMPANY_EMAIL = COMPANY_FACTS.email;
export const COMPANY_EMAIL_HREF = COMPANY_FACTS.emailHref;
export const PRIMARY_WEBSITES = COMPANY_FACTS.primaryWebsites;

// Full two-line licensing block (for reports, disclosures, printable views).
export const LICENSE_BLOCK = `${COMPANY_NAME}\n${COMPANY_LICENSE}\n\n${BROKER_NAME}\n${BROKER_TITLE}\n${BROKER_LICENSE}`;

// Compact single-line footer used site-wide (header/footer, chat, emails).
export const LICENSE_FOOTER = `${COMPANY_NAME} · ${COMPANY_LICENSE} · ${COMPANY_FACTS.equalHousingLanguage}  |  ${BROKER_NAME}, ${BROKER_TITLE} · ${BROKER_LICENSE}`;

const NMLS_FOOTER = LICENSE_FOOTER;

// Strategy-review disclaimer (English by design — legal). Derived from the
// standard disclosures in company facts.
export const STRATEGY_DISCLAIMER = COMPANY_FACTS.standardDisclosures.join(' ');

// UI strings for the AI Mortgage Strategy Review. Kept in English within the
// profile panel for consistency with the (English) lead the MLO receives.
export const STRATEGY_UI = {
  heroTitle: 'AI Mortgage Strategy Review',
  heroLead: 'Tell us what you want to buy. The AI advisor will help identify possible loan paths and estimate your real cash needed to close.',
  heroPlaceholder: "I want to buy a $2M home in California. I'm self-employed and have $400k down. What is my best scenario?",
  heroCta: 'Analyze My Scenario',
  heroChips: ['$2M self-employed buyer', '10% down Non-QM', 'Jumbo full-doc buyer', 'Bank statement borrower', 'Investment DSCR scenario', 'Compare down payment options'],
  profileTitle: 'Loan Strategy Profile',
  nextQuestion: 'Next best question',
  pathsTitle: 'Possible loan paths',
  pathsSub: 'Estimated and cautious — not an approval or a quote.',
  pathsLocked: 'Share your price, down payment, and state and your possible loan paths and estimated cash to close will appear here.',
  manualOpen: 'Prefer to enter details manually?',
  manualHide: 'Hide manual entry',
  manualTitle: 'Manual entry',
  manualSub: 'Enter or adjust any details directly. The AI keeps using whatever you provide.',
  leadTitle: 'Send my strategy summary',
  leadSub: 'I can prepare a personalized strategy summary for you. Where should we send it?',
  leadName: 'Name',
  leadPhone: 'Phone',
  leadEmail: 'Email',
  leadCta: 'Send My Strategy Summary',
  leadSentTitle: 'Summary on its way',
  leadSentBody: 'A licensed strategist will follow up shortly.',
};

// Locale overrides for the Strategy Review UI. English is the base; a locale
// only needs to override the keys it localizes (missing keys fall back to en,
// so es/ru keep today's English profile panel and zh-CN is fully localized).
export const STRATEGY_UI_I18N = {
  'zh-CN': {
    heroTitle: 'AI 房贷策略分析',
    heroLead: '告诉我们您想购买什么。AI 顾问将帮助识别可能的贷款方案，并估算您过户所需的实际现金。',
    heroPlaceholder: '我想在加州买一套 200 万美元的房子。我是自雇人士，有 40 万美元首付。我最好的方案是什么？',
    heroCta: '分析我的方案',
    heroChips: ['200万自雇买家', '10% 首付 Non-QM', '全额收入证明超额贷款', '银行流水借款人', '投资房 DSCR 方案', '比较首付方案'],
    profileTitle: '贷款策略档案',
    nextQuestion: '下一个最佳问题',
    pathsTitle: '可能的贷款方案',
    pathsSub: '为估算且谨慎 — 并非批准或报价。',
    pathsLocked: '填写您的价格、首付款和州，此处将显示可能的贷款方案和过户所需现金的估算。',
    manualOpen: '更愿意手动输入信息？',
    manualHide: '隐藏手动输入',
    manualTitle: '手动输入',
    manualSub: '直接输入或调整任何信息。AI 会继续使用您提供的内容。',
    leadTitle: '发送我的策略摘要',
    leadSub: '我可以为您准备个性化的策略摘要。应发送到哪里？',
    leadName: '姓名',
    leadPhone: '电话',
    leadEmail: '电子邮件',
    leadCta: '发送我的策略摘要',
    leadSentTitle: '摘要即将送达',
    leadSentBody: '持牌策略顾问将很快与您联系。',
  },
};

// Merge the English base with a locale's overrides.
export function strategyUI(lang) {
  return { ...STRATEGY_UI, ...(STRATEGY_UI_I18N[lang] || {}) };
}

// Localized labels for the contextual resource recommendation block.
export const RESOURCE_UI = {
  en: { recommendedTitle: 'Recommended for your situation', inlineTitle: 'Helpful resources' },
  es: { recommendedTitle: 'Recomendado para su situación', inlineTitle: 'Recursos útiles' },
  ru: { recommendedTitle: 'Рекомендовано для вашей ситуации', inlineTitle: 'Полезные ресурсы' },
  'zh-CN': { recommendedTitle: '为您的情况推荐', inlineTitle: '相关资源' },
};

// Secure document upload strings. The file is forwarded to the licensed team —
// it is NEVER read by the AI, so there is no licensing/compliance exposure.
export const UPLOAD_UI = {
  en: {
    hint: 'Send a document securely to your loan team (the AI does not open it)',
    sending: 'Sending your document securely…',
    sent: (n) => `Thanks — I’ve sent “${n}” securely to your licensed loan team. I don’t open documents myself, but a specialist will review it and follow up.`,
    failed: `Sorry, that upload didn’t go through. Please try again, or call our office at ${OFFICE_PHONE}.`,
    tooLarge: 'That file is a little large — please keep it under 8 MB.',
    badType: 'Please attach a PDF, image, or document file.',
  },
  es: {
    hint: 'Envíe un documento de forma segura a su equipo (la IA no lo abre)',
    sending: 'Enviando su documento de forma segura…',
    sent: (n) => `Gracias — envié “${n}” de forma segura a su equipo hipotecario con licencia. Yo no abro documentos, pero un especialista lo revisará y le contactará.`,
    failed: `Lo siento, la carga no se completó. Inténtelo de nuevo o llame a nuestra oficina al ${OFFICE_PHONE}.`,
    tooLarge: 'Ese archivo es un poco grande — manténgalo por debajo de 8 MB.',
    badType: 'Adjunte un PDF, una imagen o un documento.',
  },
  ru: {
    hint: 'Отправьте документ безопасно вашей команде (ИИ его не открывает)',
    sending: 'Безопасно отправляю ваш документ…',
    sent: (n) => `Спасибо — я безопасно передал «${n}» вашей лицензированной ипотечной команде. Я сам документы не открываю, но специалист их проверит и свяжется с вами.`,
    failed: `Извините, загрузка не прошла. Попробуйте ещё раз или позвоните в офис: ${OFFICE_PHONE}.`,
    tooLarge: 'Файл великоват — пожалуйста, до 8 МБ.',
    badType: 'Пожалуйста, приложите PDF, изображение или документ.',
  },
  'zh-CN': {
    hint: '安全地将文件发送给您的贷款团队（AI 不会打开文件）',
    sending: '正在安全发送您的文件…',
    sent: (n) => `谢谢 — 我已将“${n}”安全发送给您的持牌贷款团队。我本人不会打开文件，但专业人员会查看并与您联系。`,
    failed: `抱歉，文件未能上传成功。请重试，或致电我们的办公室 ${OFFICE_PHONE}。`,
    tooLarge: '文件略大 — 请保持在 8 MB 以内。',
    badType: '请附上 PDF、图片或文档文件。',
  },
};

// ── Contact + trust actions (compact mobile trust panel and footer) ──
// Legal identifiers, NMLS, DRE, phone numbers, and the legal entity name are
// never translated — only the surrounding labels are localized.
export const CONTACT_UI = {
  en: {
    trustHeading: 'Licensed company behind WCCI',
    brandBy: 'by',
    callOffice: 'Call Office',
    callAnatoliy: 'Call Anatoliy',
    meetBroker: 'Meet the Broker',
    verifyLicensing: 'Verify Licensing',
    contactTeam: 'Contact Our Team',
    privacyAiUse: 'Privacy & AI Use',
    companyAndLicensing: 'Company & Licensing',
    officeLabel: 'Office',
    directLabel: 'Direct',
    emailLabel: 'Email',
    close: 'Close',
    privacyNote: 'This assistant is AI-powered and helps map mortgage scenarios and education. A licensed human handles any actual review. It does not pull your credit, and you can get help without providing contact information. Documents you upload go securely to the licensed team — the AI does not open them.',
  },
  es: {
    trustHeading: 'Compañía con licencia detrás de WCCI',
    brandBy: 'de',
    callOffice: 'Llamar a la oficina',
    callAnatoliy: 'Llamar a Anatoliy',
    meetBroker: 'Conozca al bróker',
    verifyLicensing: 'Verificar licencias',
    contactTeam: 'Contactar a nuestro equipo',
    privacyAiUse: 'Privacidad y uso de IA',
    companyAndLicensing: 'Compañía y licencias',
    officeLabel: 'Oficina',
    directLabel: 'Directo',
    emailLabel: 'Correo',
    close: 'Cerrar',
    privacyNote: 'Este asistente funciona con IA y ayuda a mapear escenarios hipotecarios y a educar. Una persona con licencia realiza cualquier revisión real. No consulta su crédito y puede recibir ayuda sin proporcionar datos de contacto. Los documentos que suba van de forma segura al equipo con licencia — la IA no los abre.',
  },
  ru: {
    trustHeading: 'Лицензированная компания за WCCI',
    brandBy: 'от',
    callOffice: 'Позвонить в офис',
    callAnatoliy: 'Позвонить Анатолию',
    meetBroker: 'О брокере',
    verifyLicensing: 'Проверить лицензии',
    contactTeam: 'Связаться с командой',
    privacyAiUse: 'Конфиденциальность и ИИ',
    companyAndLicensing: 'Компания и лицензии',
    officeLabel: 'Офис',
    directLabel: 'Прямой',
    emailLabel: 'Эл. почта',
    close: 'Закрыть',
    privacyNote: 'Этот ассистент работает на базе ИИ и помогает разобрать ипотечные сценарии и обучить. Любую фактическую проверку выполняет лицензированный специалист. Он не проверяет вашу кредитную историю, и вы можете получить помощь без предоставления контактов. Загруженные документы безопасно поступают лицензированной команде — ИИ их не открывает.',
  },
  'zh-CN': {
    trustHeading: 'WCCI 背后的持牌公司',
    brandBy: '由',
    callOffice: '致电办公室',
    callAnatoliy: '联系 Anatoliy',
    meetBroker: '了解房贷经纪人',
    verifyLicensing: '查看执照信息',
    contactTeam: '联系我们的团队',
    privacyAiUse: '隐私与人工智能使用说明',
    companyAndLicensing: '公司与执照信息',
    officeLabel: '办公室',
    directLabel: '直线电话',
    emailLabel: '电子邮件',
    close: '关闭',
    privacyNote: '本助手由人工智能提供支持，用于梳理房贷方案与提供教育信息。任何实际审核均由持牌专业人员完成。它不会查询您的信用，您无需提供联系方式也可获得帮助。您上传的文件会安全地发送给持牌团队 — AI 不会打开它们。',
  },
};

export const T = {
  en: {
    brand: 'West Coast Capital',
    brandBy: 'by',
    getStarted: 'Get Started',
    badge: 'AI-assisted · No credit pull · Free to start',
    h1a: 'Your mortgage strategy,',
    h1b: 'powered by AI',
    mobileH1: 'Your Mortgage Strategy Starts Here',
    mobileLead: 'Describe what you are trying to do in your own words.',
    buildStrategy: 'Build My Strategy',
    stepByStep: 'Enter Details Step by Step',
    companyLicensing: 'Company & Licensing',
    subhead: 'Describe your scenario or ask a beginner question. Get a clear loan strategy in minutes — not days. No forms, no credit check, no pressure.',
    cta: 'Start Your Scenario →',
    ctaSub: 'Takes 3–5 minutes · 100% confidential',
    features: [
      { icon: '⚡', bg: '#fef3c7', title: 'Instant Clarity', desc: 'AI identifies the right loan type — conventional, jumbo, bank statement, or non-QM — in minutes.' },
      { icon: '🔒', bg: '#f0fdf4', title: 'No Hard Pull', desc: 'Zero credit inquiries. We only need a rough score range to map your strategy.' },
      { icon: '🎓', bg: '#eff6ff', title: 'New to This? Perfect.', desc: "Never had a mortgage before? The AI explains every term in plain language, at your pace." },
    ],
    demo: [
      { ai: true, text: "Hi! Are you buying your first home, or refinancing? And what state is it in?" },
      { ai: false, text: "Buying my first home in California. I don't really know how any of this works." },
      { ai: true, text: "No problem at all — that's exactly what I'm here for. We'll go one step at a time. First, what's a comfortable price range you've been thinking about?" },
    ],
    back: '← Back',
    statusOnline: 'Online · West Coast Capital',
    placeholder: 'Type your answer, or ask anything…',
    micStart: 'Tap to speak',
    micStop: 'Listening… tap to stop',
    startOver: 'Start over',
    nmls: NMLS_FOOTER,
    starterChips: ['I want to buy my first home', 'I want to refinance', "I'm just exploring", "I don't know where to start"],
    helperChips: ['What does that mean?', "I'm not sure", 'Explain it simply'],
    greeting: `Hi there! I'm the Loan Strategy assistant at West Coast Capital Mortgage. I'm here to help you map out your mortgage — whether you know exactly what you want or you're brand new to all of this. There's no pressure, no credit pull, and no obligation, and I'm happy to explain anything along the way.\n\nTo start — what should I call you?`,
  },
  es: {
    brand: 'West Coast Capital',
    brandBy: 'de',
    getStarted: 'Comenzar',
    badge: 'Con asistencia de IA · Sin consulta de crédito · Gratis para empezar',
    h1a: 'Su estrategia hipotecaria,',
    h1b: 'impulsada por IA',
    mobileH1: 'Su estrategia hipotecaria comienza aquí',
    mobileLead: 'Describa lo que quiere hacer con sus propias palabras.',
    buildStrategy: 'Crear mi estrategia',
    stepByStep: 'Ingresar detalles paso a paso',
    companyLicensing: 'Compañía y licencias',
    subhead: 'Describa su situación o haga una pregunta de principiante. Obtenga una estrategia de préstamo clara en minutos, no en días. Sin formularios, sin consulta de crédito, sin presión.',
    cta: 'Comenzar →',
    ctaSub: 'Toma 3–5 minutos · 100% confidencial',
    features: [
      { icon: '⚡', bg: '#fef3c7', title: 'Claridad Inmediata', desc: 'La IA identifica el tipo de préstamo adecuado en minutos.' },
      { icon: '🔒', bg: '#f0fdf4', title: 'Sin Consulta Dura', desc: 'Cero consultas de crédito. Solo necesitamos un rango aproximado de su puntaje.' },
      { icon: '🎓', bg: '#eff6ff', title: '¿Nuevo en Esto? Perfecto.', desc: 'La IA le explica cada término en lenguaje sencillo, a su ritmo.' },
    ],
    demo: [
      { ai: true, text: '¡Hola! ¿Está comprando su primera casa o refinanciando? ¿Y en qué estado está?' },
      { ai: false, text: 'Comprando mi primera casa en California. La verdad no sé cómo funciona nada de esto.' },
      { ai: true, text: 'No se preocupe, para eso estoy aquí. Iremos paso a paso. Primero, ¿qué rango de precio cómodo ha estado considerando?' },
    ],
    back: '← Atrás',
    statusOnline: 'En línea · West Coast Capital',
    placeholder: 'Escriba su respuesta o pregunte lo que sea…',
    micStart: 'Toque para hablar',
    micStop: 'Escuchando… toque para detener',
    startOver: 'Empezar de nuevo',
    nmls: NMLS_FOOTER,
    starterChips: ['Quiero comprar mi primera casa', 'Quiero refinanciar', 'Solo estoy explorando', 'No sé por dónde empezar'],
    helperChips: ['¿Qué significa eso?', 'No estoy seguro', 'Explíquemelo de forma simple'],
    greeting: `¡Hola! Soy el asistente de Estrategia de Préstamos de West Coast Capital Mortgage. Estoy aquí para ayudarle a planear su hipoteca, ya sea que sepa exactamente lo que quiere o que esto sea completamente nuevo para usted. No hay presión, no se consulta su crédito y no hay ninguna obligación; con gusto le explico cualquier cosa en el camino.\n\nPara comenzar, ¿cómo le gustaría que le llame?`,
  },
  ru: {
    brand: 'West Coast Capital',
    brandBy: 'от',
    getStarted: 'Начать',
    badge: 'С помощью ИИ · Без проверки кредита · Бесплатно начать',
    h1a: 'Ваша ипотечная стратегия,',
    h1b: 'на базе ИИ',
    mobileH1: 'Ваша ипотечная стратегия начинается здесь',
    mobileLead: 'Опишите своими словами, что вы хотите сделать.',
    buildStrategy: 'Построить стратегию',
    stepByStep: 'Ввести данные пошагово',
    companyLicensing: 'Компания и лицензии',
    subhead: 'Опишите свою ситуацию или задайте вопрос новичка. Получите понятную стратегию по кредиту за минуты, а не дни. Без анкет, без проверки кредита, без давления.',
    cta: 'Начать →',
    ctaSub: 'Занимает 3–5 минут · 100% конфиденциально',
    features: [
      { icon: '⚡', bg: '#fef3c7', title: 'Мгновенная ясность', desc: 'ИИ определяет подходящий тип кредита за считанные минуты.' },
      { icon: '🔒', bg: '#f0fdf4', title: 'Без жёсткой проверки', desc: 'Никаких кредитных запросов. Нужен лишь примерный диапазон вашего рейтинга.' },
      { icon: '🎓', bg: '#eff6ff', title: 'Впервые? Отлично.', desc: 'ИИ объяснит каждый термин простыми словами, в вашем темпе.' },
    ],
    demo: [
      { ai: true, text: 'Здравствуйте! Вы покупаете первый дом или рефинансируете? И в каком штате?' },
      { ai: false, text: 'Покупаю первый дом в Калифорнии. Честно, совсем не разбираюсь, как это всё работает.' },
      { ai: true, text: 'Совершенно не страшно — я как раз для этого здесь. Пойдём шаг за шагом. Для начала: какой комфортный диапазон цены Вы рассматриваете?' },
    ],
    back: '← Назад',
    statusOnline: 'Онлайн · West Coast Capital',
    placeholder: 'Введите ответ или задайте вопрос…',
    micStart: 'Нажмите, чтобы говорить',
    micStop: 'Слушаю… нажмите, чтобы остановить',
    startOver: 'Начать заново',
    nmls: NMLS_FOOTER,
    starterChips: ['Хочу купить первый дом', 'Хочу рефинансировать', 'Просто изучаю варианты', 'Не знаю, с чего начать'],
    helperChips: ['Что это значит?', 'Я не уверен(а)', 'Объясните попроще'],
    greeting: `Здравствуйте! Я — ассистент по ипотечной стратегии West Coast Capital Mortgage. Я помогу Вам разобраться с ипотекой — независимо от того, точно ли Вы знаете, чего хотите, или всё это для Вас совершенно ново. Никакого давления, без проверки кредита и без каких-либо обязательств; я с радостью объясню всё по ходу дела.\n\nДля начала — как я могу к Вам обращаться?`,
  },
  'zh-CN': {
    brand: 'West Coast Capital',
    brandBy: '由',
    getStarted: '开始',
    badge: 'AI 辅助 · 不查询信用 · 免费开始',
    h1a: '您的房贷策略，',
    h1b: '由 AI 提供支持',
    mobileH1: '您的房贷策略从这里开始',
    mobileLead: '用您自己的话描述您想要做的事情。',
    buildStrategy: '生成我的策略',
    stepByStep: '逐步输入信息',
    companyLicensing: '公司与执照信息',
    subhead: '描述您的情况，或提出一个新手问题。几分钟内获得清晰的贷款策略 — 无需数天。没有表格，不查询信用，没有压力。',
    cta: '开始您的方案 →',
    ctaSub: '大约需要 3–5 分钟 · 完全保密',
    features: [
      { icon: '⚡', bg: '#fef3c7', title: '即时清晰', desc: 'AI 在几分钟内识别合适的贷款类型 — 常规贷款、超额贷款、银行流水贷款或 Non-QM。' },
      { icon: '🔒', bg: '#f0fdf4', title: '不做硬查询', desc: '零信用查询。我们只需要一个大致的评分区间来规划您的策略。' },
      { icon: '🎓', bg: '#eff6ff', title: '第一次接触？没问题。', desc: '从未办过房贷？AI 会用通俗易懂的语言，按您的节奏解释每个术语。' },
    ],
    demo: [
      { ai: true, text: '您好！您是购买首套住房，还是再融资？房产在哪个州？' },
      { ai: false, text: '在加州购买我的首套住房。我其实不太懂这些是怎么运作的。' },
      { ai: true, text: '完全没问题 — 我正是为此而来。我们一步一步来。首先，您考虑的舒适价格区间大概是多少？' },
    ],
    back: '← 返回',
    statusOnline: '在线 · West Coast Capital',
    placeholder: '输入您的回答，或提出任何问题…',
    micStart: '点击说话',
    micStop: '正在聆听… 点击停止',
    startOver: '重新开始',
    nmls: NMLS_FOOTER,
    starterChips: ['我想购买首套住房', '我想再融资', '我只是先了解一下', '我不知道从哪里开始'],
    helperChips: ['那是什么意思？', '我不确定', '请简单解释一下'],
    greeting: `您好！我是 West Coast Capital Mortgage 的贷款策略助手。无论您已经清楚知道自己想要什么，还是对这一切完全陌生，我都会帮您规划房贷。没有压力，不查询信用，也没有任何义务；一路上我很乐意为您解释任何问题。\n\n首先 — 我该怎么称呼您？`,
  },
};

export function getInitialMessage(lang) {
  return { role: 'assistant', content: (T[lang] || T.en).greeting };
}

// ── Localization integrity (used by tests) ──
// Every non-English locale must define exactly the keys English defines — no
// missing keys (untranslated fallback) and no stray keys.
export function localizationParity() {
  const base = Object.keys(T.en).sort();
  const report = {};
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    const keys = Object.keys(T[lang] || {});
    report[lang] = {
      missing: base.filter((k) => !keys.includes(k)),
      extra: keys.filter((k) => !base.includes(k)),
    };
  }
  return report;
}
