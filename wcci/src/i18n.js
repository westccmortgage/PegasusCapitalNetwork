// UI translations for EN / ES / RU.
// Legal text (DISCLAIMER, NMLS footer) stays English by design — see brief.
// The AI conversation itself is multilingual via the system prompt.

export const LANGS = ['en', 'es', 'ru'];

export const DISCLAIMER = `WCCI Mortgage Strategy AI provides a preliminary mortgage scenario review and general educational information only. It is not a loan approval, preapproval, commitment to lend, rate quote, or underwriting decision. Educational information provided is general in nature and does not constitute mortgage advice for your specific situation. Actual loan terms, eligibility, pricing, and approval depend on full application review, credit review, income and asset documentation, property review, program guidelines, lender approval, and review by a licensed Mortgage Loan Originator. Specific numbers, thresholds, and program requirements change regularly — always consult with a licensed professional for current guidance.`;

// ─────────────────────────────────────────────────────────────────────────
// CANONICAL LICENSING — single source of truth. Use these everywhere.
// The COMPANY NMLS (#2817729) and the BROKER's individual NMLS (#2775380) are
// DIFFERENT and must never be interchanged.
// ─────────────────────────────────────────────────────────────────────────
export const COMPANY_NAME = 'West Coast Capital Mortgage Inc.';
export const COMPANY_LICENSE = 'CA DRE Corporation License #02440065 · NMLS #2817729';
export const COMPANY_NMLS = '2817729';
export const COMPANY_DRE = '02440065';

export const BROKER_NAME = 'Anatoliy Kanevsky';
export const BROKER_TITLE = 'California Real Estate Broker';
export const BROKER_LICENSE = 'CA DRE Broker License #01385024 · NMLS #2775380';
export const BROKER_NMLS = '2775380';
export const BROKER_DRE = '01385024';

// Full two-line licensing block (for reports, disclosures, printable views).
export const LICENSE_BLOCK = `${COMPANY_NAME}\n${COMPANY_LICENSE}\n\n${BROKER_NAME}\n${BROKER_TITLE}\n${BROKER_LICENSE}`;

// Compact single-line footer used site-wide (header/footer, chat, emails).
export const LICENSE_FOOTER = `${COMPANY_NAME} · ${COMPANY_LICENSE} · Equal Housing Lender  |  ${BROKER_NAME}, ${BROKER_TITLE} · ${BROKER_LICENSE}`;

const NMLS_FOOTER = LICENSE_FOOTER;

// Strategy-review disclaimer (English by design — legal).
export const STRATEGY_DISCLAIMER = 'This is for educational and planning purposes only. It is not a mortgage application, Loan Estimate, loan approval, or commitment to lend. Actual loan terms, rates, APR, fees, mortgage insurance, reserve requirements, documentation requirements, and program availability vary by lender, borrower profile, property, market conditions, and closing date.';

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

// Secure document upload strings. The file is forwarded to the licensed team —
// it is NEVER read by the AI, so there is no licensing/compliance exposure.
export const UPLOAD_UI = {
  en: {
    hint: 'Send a document securely to your loan team (the AI does not open it)',
    sending: 'Sending your document securely…',
    sent: (n) => `Thanks — I’ve sent “${n}” securely to your licensed loan team. I don’t open documents myself, but a specialist will review it and follow up.`,
    failed: 'Sorry, that upload didn’t go through. Please try again, or call (310) 686-5053.',
    tooLarge: 'That file is a little large — please keep it under 8 MB.',
    badType: 'Please attach a PDF, image, or document file.',
  },
  es: {
    hint: 'Envíe un documento de forma segura a su equipo (la IA no lo abre)',
    sending: 'Enviando su documento de forma segura…',
    sent: (n) => `Gracias — envié “${n}” de forma segura a su equipo hipotecario con licencia. Yo no abro documentos, pero un especialista lo revisará y le contactará.`,
    failed: 'Lo siento, la carga no se completó. Inténtelo de nuevo o llame al (310) 686-5053.',
    tooLarge: 'Ese archivo es un poco grande — manténgalo por debajo de 8 MB.',
    badType: 'Adjunte un PDF, una imagen o un documento.',
  },
  ru: {
    hint: 'Отправьте документ безопасно вашей команде (ИИ его не открывает)',
    sending: 'Безопасно отправляю ваш документ…',
    sent: (n) => `Спасибо — я безопасно передал «${n}» вашей лицензированной ипотечной команде. Я сам документы не открываю, но специалист их проверит и свяжется с вами.`,
    failed: 'Извините, загрузка не прошла. Попробуйте ещё раз или позвоните (310) 686-5053.',
    tooLarge: 'Файл великоват — пожалуйста, до 8 МБ.',
    badType: 'Пожалуйста, приложите PDF, изображение или документ.',
  },
};

export const T = {
  en: {
    brand: 'West Coast Capital',
    getStarted: 'Get Started',
    badge: 'AI-Powered · No Credit Pull · Free',
    h1a: 'Your mortgage strategy,',
    h1b: 'powered by AI',
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
    getStarted: 'Comenzar',
    badge: 'Con IA · Sin Consulta de Crédito · Gratis',
    h1a: 'Su estrategia hipotecaria,',
    h1b: 'impulsada por IA',
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
    getStarted: 'Начать',
    badge: 'На базе ИИ · Без проверки кредита · Бесплатно',
    h1a: 'Ваша ипотечная стратегия,',
    h1b: 'на базе ИИ',
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
};

export function getInitialMessage(lang) {
  return { role: 'assistant', content: (T[lang] || T.en).greeting };
}
