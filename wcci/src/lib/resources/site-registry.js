// Site Registry — the ONLY place URLs the assistant can recommend may live.
// The model emits resource IDs; URLs are resolved here. See types.js for the
// SiteResource contract and docs/resource-registry.md for maintenance rules.
//
// `verified: true` means the owner supplied/approved the canonical URL in the
// product brief. Run `npm run sync:resources` from a network-enabled machine
// to re-check every page and stamp `lastVerifiedAt` (see scripts/).

const L = (en, es, ru) => ({ en, es, ru });

/** @type {import('./types.js').SiteResource[]} */
export const SITE_REGISTRY = [
  // ── A. Core mortgage & trust ────────────────────────────────────────────
  {
    id: 'wccm-home', brand: 'West Coast Capital Mortgage', title: 'West Coast Capital Mortgage',
    canonicalUrl: 'https://westccmortgage.com', domain: 'westccmortgage.com',
    aliases: ['westcoastcapitalmortgage.com', 'wwccm.com'],
    category: 'corporate_trust',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA', 'FL'], topics: ['company', 'programs', 'contact'],
    trustIntents: ['identity', 'company_background'],
    stages: ['trust_building', 'education'], languages: ['en'],
    priority: 70, autoRoute: true,
    actionLabel: L('Visit the Company Site', 'Visitar el sitio de la compañía', 'Открыть сайт компании'),
    shortDescription: L(
      'The corporate website of the licensed mortgage company behind this assistant.',
      'El sitio corporativo de la compañía hipotecaria con licencia detrás de este asistente.',
      'Корпоративный сайт лицензированной ипотечной компании, стоящей за этим ассистентом.'),
    verified: true,
  },
  {
    id: 'wccm-about', brand: 'West Coast Capital Mortgage', title: 'About West Coast Capital Mortgage',
    canonicalUrl: 'https://westccmortgage.com/about', domain: 'westccmortgage.com',
    category: 'corporate_trust',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor', 'capital_professional'],
    states: ['CA', 'FL'], topics: ['company', 'founder', 'licensing'],
    trustIntents: ['identity', 'company_background', 'licensing', 'development_credibility'],
    stages: ['trust_building'], languages: ['en'],
    priority: 90, autoRoute: true,
    actionLabel: L('Meet the Company', 'Conocer la compañía', 'О компании'),
    shortDescription: L(
      'Meet the company and the licensed professional responsible for mortgage review.',
      'Conozca la compañía y al profesional con licencia responsable de la revisión hipotecaria.',
      'Познакомьтесь с компанией и лицензированным специалистом, отвечающим за проверку ипотеки.'),
    verified: true,
  },
  {
    id: 'wccm-contact', brand: 'West Coast Capital Mortgage', title: 'Contact West Coast Capital Mortgage',
    canonicalUrl: 'https://westccmortgage.com/contact', domain: 'westccmortgage.com',
    category: 'corporate_trust',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA', 'FL'], topics: ['contact'],
    trustIntents: ['identity'],
    stages: ['human_review_ready', 'handoff_requested'], languages: ['en'],
    priority: 60, autoRoute: true,
    actionLabel: L('Contact the Team', 'Contactar al equipo', 'Связаться с командой'),
    shortDescription: L(
      'Direct human contact options for the licensed team.',
      'Opciones de contacto directo con el equipo con licencia.',
      'Прямые контакты лицензированной команды.'),
    verified: true,
  },
  {
    id: 'nmls-consumer-access', brand: 'NMLS Consumer Access', title: 'NMLS Consumer Access (regulator lookup)',
    canonicalUrl: 'https://www.nmlsconsumeraccess.org', domain: 'nmlsconsumeraccess.org',
    category: 'corporate_trust',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    topics: ['licensing', 'verification'],
    trustIntents: ['licensing', 'identity'],
    stages: ['trust_building'], languages: ['en'],
    priority: 85, autoRoute: true,
    actionLabel: L('Verify Licensing (NMLS)', 'Verificar licencias (NMLS)', 'Проверить лицензии (NMLS)'),
    shortDescription: L(
      'Independently verify company NMLS #2817729 and broker NMLS #2775380 on the official regulator site.',
      'Verifique de forma independiente el NMLS #2817729 de la compañía y el NMLS #2775380 del bróker en el sitio oficial del regulador.',
      'Независимо проверьте NMLS компании #2817729 и NMLS брокера #2775380 на официальном сайте регулятора.'),
    verified: true,
  },
  {
    id: 'wcci-home', brand: 'WCCI', title: 'WCCI — AI Mortgage Strategy Workspace',
    canonicalUrl: 'https://wcci.online', domain: 'wcci.online',
    category: 'scenario_tool',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA', 'FL'], topics: ['scenario', 'education'],
    stages: ['discovery', 'education'], languages: ['en', 'es', 'ru'],
    // Never link the user back to the page they are already on.
    priority: 5, autoRoute: false,
    actionLabel: L('Continue Your Scenario', 'Continuar su escenario', 'Продолжить сценарий'),
    shortDescription: L(
      'The AI-assisted scenario workspace operated for West Coast Capital Mortgage Inc. — not the mortgage company itself.',
      'El espacio de escenarios asistido por IA operado para West Coast Capital Mortgage Inc. — no es la compañía hipotecaria.',
      'Рабочее пространство сценариев на базе ИИ для West Coast Capital Mortgage Inc. — не сама ипотечная компания.'),
    verified: true,
  },
  {
    id: 'ourmtg-portal', brand: 'OurMTG', title: 'Secure Application & Document Portal',
    canonicalUrl: 'https://ourmtg.com', domain: 'ourmtg.com',
    category: 'secure_application',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA', 'FL'], topics: ['apply', 'documents', 'loan_status'],
    stages: ['handoff_requested', 'human_review_ready'], languages: ['en'],
    priority: 75, autoRoute: true,
    actionLabel: L('Open Secure Portal', 'Abrir portal seguro', 'Открыть защищённый портал'),
    shortDescription: L(
      'Secure mortgage application, document upload, and loan-status portal — for when you are ready to apply.',
      'Portal seguro de solicitud, carga de documentos y estado del préstamo — para cuando esté listo para aplicar.',
      'Защищённый портал заявки, загрузки документов и статуса кредита — когда вы готовы подать заявку.'),
    verified: true,
  },
  {
    id: 'californiamtg-home', brand: 'California Mortgage', title: 'California Mortgage — Scenario-First Review',
    canonicalUrl: 'https://californiamtg.com', domain: 'californiamtg.com',
    category: 'state_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA'], topics: ['education', 'scenario', 'self_employed', 'refinance', 'purchase', 'first_time_buyer'],
    trustIntents: ['privacy'],
    stages: ['education', 'comparison', 'trust_building'], languages: ['en'],
    priority: 65, autoRoute: true,
    actionLabel: L('Explore California Guidance', 'Explorar la guía de California', 'Открыть гид по Калифорнии'),
    shortDescription: L(
      'California mortgage education and scenario-first review — understand the process before applying.',
      'Educación hipotecaria de California y revisión por escenarios — entienda el proceso antes de aplicar.',
      'Ипотечное образование по Калифорнии и разбор сценариев — разберитесь в процессе до подачи заявки.'),
    verified: true,
  },
  {
    id: 'californiamtg-about', brand: 'California Mortgage', title: 'About California Mortgage',
    canonicalUrl: 'https://californiamtg.com/about', domain: 'californiamtg.com',
    category: 'state_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA'], topics: ['company'],
    trustIntents: ['identity', 'company_background'],
    stages: ['trust_building'], languages: ['en'],
    priority: 55, autoRoute: true,
    actionLabel: L('About California Mortgage', 'Acerca de California Mortgage', 'О California Mortgage'),
    shortDescription: L(
      'Who is behind the California-facing mortgage education brand.',
      'Quién está detrás de la marca educativa hipotecaria de California.',
      'Кто стоит за калифорнийским ипотечным образовательным брендом.'),
    verified: true,
  },
  {
    id: 'californiamtg-privacy', brand: 'California Mortgage', title: 'California Mortgage Privacy Policy',
    canonicalUrl: 'https://californiamtg.com/privacy-policy', domain: 'californiamtg.com',
    category: 'state_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA'], topics: ['privacy'],
    trustIntents: ['privacy'],
    stages: ['trust_building'], languages: ['en'],
    priority: 50, autoRoute: true,
    actionLabel: L('Read the Privacy Policy', 'Leer la política de privacidad', 'Политика конфиденциальности'),
    shortDescription: L(
      'How California borrower information is handled and protected.',
      'Cómo se maneja y protege la información del prestatario en California.',
      'Как обрабатывается и защищается информация калифорнийских заёмщиков.'),
    verified: true,
  },
  {
    id: 'suncoast-home', brand: 'Suncoast Capital Mortgage', title: 'Suncoast Capital Mortgage (Florida)',
    canonicalUrl: 'https://suncoastcapitalmortgage.com', domain: 'suncoastcapitalmortgage.com',
    category: 'state_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], topics: ['education', 'purchase', 'refinance', 'jumbo', 'fha', 'va', 'non_qm', 'bank_statement', 'dscr'],
    stages: ['education', 'comparison', 'trust_building'], languages: ['en'],
    priority: 70, autoRoute: true,
    actionLabel: L('Explore Florida Guidance', 'Explorar la guía de Florida', 'Открыть гид по Флориде'),
    shortDescription: L(
      'The Florida-facing mortgage brand connected to West Coast Capital Mortgage Inc.',
      'La marca hipotecaria de Florida conectada con West Coast Capital Mortgage Inc.',
      'Ипотечный бренд для Флориды, связанный с West Coast Capital Mortgage Inc.'),
    verified: true,
  },
  {
    id: 'suncoast-about', brand: 'Suncoast Capital Mortgage', title: 'About Suncoast Capital Mortgage',
    canonicalUrl: 'https://suncoastcapitalmortgage.com/about', domain: 'suncoastcapitalmortgage.com',
    category: 'state_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], topics: ['company'],
    trustIntents: ['identity', 'company_background', 'licensing'],
    stages: ['trust_building'], languages: ['en'],
    priority: 88, autoRoute: true,
    actionLabel: L('Meet the Florida Team', 'Conocer al equipo de Florida', 'О команде во Флориде'),
    shortDescription: L(
      'Review the Florida-facing company information, programs, and contact options.',
      'Revise la información, los programas y las opciones de contacto de la compañía en Florida.',
      'Информация о компании во Флориде, программы и способы связи.'),
    verified: true,
  },
  {
    id: 'suncoast-resources', brand: 'Suncoast Capital Mortgage', title: 'Suncoast Florida Mortgage Resources',
    canonicalUrl: 'https://suncoastcapitalmortgage.com/resources', domain: 'suncoastcapitalmortgage.com',
    category: 'mortgage_education',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], topics: ['education', 'programs'],
    stages: ['education'], languages: ['en'],
    priority: 60, autoRoute: true,
    actionLabel: L('Florida Loan Resources', 'Recursos de préstamos de Florida', 'Ресурсы по кредитам во Флориде'),
    shortDescription: L(
      'Florida program education: FHA, VA, jumbo, bank-statement, DSCR, and more.',
      'Educación sobre programas de Florida: FHA, VA, jumbo, extractos bancarios, DSCR y más.',
      'Обучающие материалы по программам Флориды: FHA, VA, jumbo, bank-statement, DSCR и другие.'),
    verified: true,
  },
  {
    id: 'kwest-home', brand: 'K West Mortgage', title: 'K West Mortgage — Florida Keys',
    canonicalUrl: 'https://kwestmortgages.com', domain: 'kwestmortgages.com',
    category: 'local_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], counties: ['monroe'], cities: ['key west', 'florida keys', 'the keys', 'marathon', 'islamorada', 'key largo'],
    topics: ['education', 'jumbo', 'high_balance', 'condo', 'flood', 'second_home', 'investment'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 80, autoRoute: true,
    actionLabel: L('Florida Keys Guidance', 'Guía de los Cayos de Florida', 'Гид по Florida Keys'),
    shortDescription: L(
      'Key West, Florida Keys, and Monroe County mortgage education — loan limits, condos, insurance, and flood.',
      'Educación hipotecaria de Key West, los Cayos y el condado de Monroe — límites, condominios, seguros e inundaciones.',
      'Ипотека в Key West, Florida Keys и округе Монро — лимиты, кондо, страхование и зоны затопления.'),
    verified: true,
  },
  {
    id: 'kwest-about', brand: 'K West Mortgage', title: 'About K West Mortgage',
    canonicalUrl: 'https://kwestmortgages.com/about', domain: 'kwestmortgages.com',
    category: 'local_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], counties: ['monroe'], cities: ['key west', 'florida keys', 'the keys'],
    topics: ['company'],
    trustIntents: ['identity'],
    stages: ['trust_building'], languages: ['en'],
    priority: 62, autoRoute: true,
    actionLabel: L('About K West', 'Acerca de K West', 'О K West'),
    shortDescription: L(
      'Who handles Florida Keys and Monroe County lending questions.',
      'Quién atiende las preguntas de préstamos en los Cayos y el condado de Monroe.',
      'Кто отвечает за кредиты в Florida Keys и округе Монро.'),
    verified: true,
  },
  {
    id: 'kwest-scenario-studio', brand: 'K West Mortgage', title: 'K West Scenario Studio',
    canonicalUrl: 'https://kwestmortgages.com/scenario-studio', domain: 'kwestmortgages.com',
    category: 'scenario_tool',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], counties: ['monroe'], cities: ['key west', 'florida keys', 'the keys'],
    topics: ['scenario', 'jumbo', 'high_balance', 'county_limit'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 82, autoRoute: true,
    actionLabel: L('Open Keys Scenario Studio', 'Abrir el estudio de escenarios', 'Открыть студию сценариев'),
    shortDescription: L(
      'Work a Monroe County scenario — county loan limits, high-balance vs. jumbo, condos, and insurance.',
      'Trabaje un escenario del condado de Monroe — límites del condado, high-balance vs. jumbo, condominios y seguros.',
      'Разбор сценария по округу Монро — лимиты округа, high-balance против jumbo, кондо и страхование.'),
    verified: true,
  },
  {
    id: 'kwest-disclosures', brand: 'K West Mortgage', title: 'K West Disclosures',
    canonicalUrl: 'https://kwestmortgages.com/disclosures', domain: 'kwestmortgages.com',
    category: 'local_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['FL'], counties: ['monroe'], topics: ['licensing', 'disclosures'],
    trustIntents: ['licensing'],
    stages: ['trust_building'], languages: ['en'],
    priority: 45, autoRoute: true,
    actionLabel: L('View Disclosures', 'Ver divulgaciones', 'Раскрытие информации'),
    shortDescription: L(
      'Licensing and disclosure information for the Keys-facing brand.',
      'Información de licencias y divulgaciones de la marca de los Cayos.',
      'Лицензии и раскрытие информации бренда Florida Keys.'),
    verified: true,
  },
  {
    id: 'beforejumbo-home', brand: 'Before Jumbo Loan', title: 'Before Jumbo Loan — Structure Intelligence',
    canonicalUrl: 'https://beforejumboloan.com', domain: 'beforejumboloan.com',
    category: 'mortgage_education',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA', 'FL'], topics: ['jumbo', 'high_balance', 'conforming', 'county_limit', 'points', 'buydown', 'interest_only', 'dscr', 'bank_statement', 'structure'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 78, autoRoute: true,
    actionLabel: L('Compare Loan Structures', 'Comparar estructuras de préstamo', 'Сравнить структуры кредита'),
    shortDescription: L(
      'Check whether a loan near the county limit is really jumbo — and compare high-balance, points, buydowns, and interest-only.',
      'Verifique si un préstamo cerca del límite del condado es realmente jumbo — y compare high-balance, puntos, buydowns e interés solo.',
      'Проверьте, действительно ли кредит около лимита округа — jumbo, и сравните high-balance, поинты, buydown и interest-only.'),
    verified: true,
  },
  {
    id: 'belair-home', brand: 'Bel Air Financing', title: 'Bel Air Financing — LA Estate Lending',
    canonicalUrl: 'https://belairfinancing.com', domain: 'belairfinancing.com',
    category: 'local_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA'],
    cities: ['bel air', 'beverly hills', 'holmby hills', 'brentwood', 'pacific palisades', 'malibu', 'manhattan beach'],
    topics: ['jumbo', 'luxury', 'interest_only', 'complex_assets', 'reserves', 'buy_before_sell', 'self_employed'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 84, autoRoute: true,
    actionLabel: L('Estate Financing Strategy', 'Estrategia de financiamiento de lujo', 'Стратегия элитного финансирования'),
    shortDescription: L(
      'High-value Los Angeles estate financing for large-balance, complex-asset, and business-owner scenarios.',
      'Financiamiento de propiedades de alto valor en Los Ángeles para escenarios de saldos grandes, activos complejos y dueños de negocios.',
      'Финансирование дорогой недвижимости Лос-Анджелеса: крупные суммы, сложные активы, владельцы бизнеса.'),
    verified: true,
  },
  {
    id: 'lunadabay-home', brand: 'Lunada Bay Mortgage', title: 'Lunada Bay Mortgage — Palos Verdes & South Bay',
    canonicalUrl: 'https://lunadabaymortgage.com', domain: 'lunadabaymortgage.com',
    category: 'local_mortgage',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor'],
    states: ['CA'],
    cities: ['lunada bay', 'palos verdes', 'palos verdes estates', 'rancho palos verdes', 'rolling hills', 'rolling hills estates', 'south bay'],
    topics: ['jumbo', 'luxury', 'local_market'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 80, autoRoute: true,
    actionLabel: L('Palos Verdes Guidance', 'Guía de Palos Verdes', 'Гид по Palos Verdes'),
    shortDescription: L(
      'Palos Verdes, Lunada Bay, and coastal South Bay jumbo mortgage guidance.',
      'Guía hipotecaria jumbo para Palos Verdes, Lunada Bay y el South Bay costero.',
      'Jumbo-ипотека в Palos Verdes, Lunada Bay и прибрежном South Bay.'),
    // Live routes NOT yet crawl-verified (per spec, K— verify before deep-linking).
    // Run `npm run sync:resources` from a networked machine, then flip to true.
    verified: false,
  },
  {
    id: 'orange-home', brand: 'Orange Mortgage', title: 'Orange Mortgage — Friendly Loan Education',
    canonicalUrl: 'https://orangesmortgages.com', domain: 'orangesmortgages.com',
    category: 'mortgage_education',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner'],
    states: ['CA', 'FL'], counties: ['orange'],
    cities: ['orange county', 'irvine', 'anaheim', 'santa ana', 'huntington beach', 'newport beach', 'costa mesa', 'fullerton', 'mission viejo'],
    topics: ['education', 'first_time_buyer', 'plain_english', 'calculator'],
    stages: ['discovery', 'education'], languages: ['en'],
    priority: 66, autoRoute: true,
    actionLabel: L('Simple Loan Education', 'Educación sencilla de préstamos', 'Простое объяснение ипотеки'),
    shortDescription: L(
      'Friendly, plain-English mortgage education — great for first-time buyers, especially in Orange County.',
      'Educación hipotecaria sencilla y amigable — ideal para compradores primerizos, especialmente en el condado de Orange.',
      'Дружелюбное, простое объяснение ипотеки — отлично для первых покупателей, особенно в округе Ориндж.'),
    verified: true,
  },
  {
    id: 'orange-about', brand: 'Orange Mortgage', title: 'About Orange Mortgage',
    canonicalUrl: 'https://orangesmortgages.com/about', domain: 'orangesmortgages.com',
    category: 'mortgage_education',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner'],
    states: ['CA', 'FL'], counties: ['orange'], topics: ['company'],
    // A mascot page is NOT a legal verification page — pair with wccm-about.
    trustIntents: [],
    stages: ['education'], languages: ['en'],
    priority: 40, autoRoute: true,
    actionLabel: L('About Orange Mortgage', 'Acerca de Orange Mortgage', 'Об Orange Mortgage'),
    shortDescription: L(
      'The friendly education brand — for legal verification see the corporate About page.',
      'La marca educativa amigable — para verificación legal, vea la página corporativa.',
      'Дружелюбный образовательный бренд — для юридической проверки см. корпоративную страницу.'),
    verified: true,
  },

  // ── B. Specialty private real-estate capital ────────────────────────────
  {
    id: 'cadeed-home', brand: 'CADeed', title: 'CADeed — California Private Real Estate Capital',
    canonicalUrl: 'https://cadeed.com', domain: 'cadeed.com',
    category: 'private_real_estate_capital',
    audiences: ['consumer_borrower', 'homeowner', 'real_estate_investor', 'developer'],
    states: ['CA'],
    topics: ['bridge', 'fix_and_flip', 'construction', 'construction_completion', 'ground_up', 'second_lien', 'business_purpose', 'private_money', 'bank_decline'],
    stages: ['education', 'comparison'], languages: ['en'],
    priority: 80, autoRoute: true,
    actionLabel: L('Explore Private Capital', 'Explorar capital privado', 'Частное финансирование'),
    shortDescription: L(
      'California private, non-bank, real-estate-secured financing — bridge, construction, and 2nd deeds of trust.',
      'Financiamiento privado no bancario garantizado por bienes raíces en California — bridge, construcción y segundas hipotecas.',
      'Частное небанковское финансирование под залог недвижимости в Калифорнии — бридж, стройка, вторые залоги.'),
    verified: true,
  },
  {
    id: 'privatenotecapital-home', brand: 'Private Note Capital', title: 'Private Note Capital — Note Investing',
    canonicalUrl: 'https://privatenotecapital.com', domain: 'privatenotecapital.com',
    category: 'investor_capital',
    audiences: ['qualified_investor', 'private_lender'],
    states: ['CA'], topics: ['notes_investing', 'trust_deed', 'first_lien', 'private_credit', 'interest_income'],
    stages: ['education'], languages: ['en'],
    priority: 80, autoRoute: true,
    neverAutoRouteFor: ['consumer_borrower', 'homebuyer', 'homeowner'],
    actionLabel: L('Note Investing Information', 'Información sobre inversión en notas', 'Инвестиции в закладные'),
    shortDescription: L(
      'Qualified-investor information about first-lien mortgage-note opportunities secured by California real estate.',
      'Información para inversionistas calificados sobre notas hipotecarias de primer gravamen garantizadas por bienes raíces de California.',
      'Информация для квалифицированных инвесторов о первых залоговых ипотечных нотах под калифорнийскую недвижимость.'),
    verified: true,
  },

  // ── C. Adjacent capital, network, development ───────────────────────────
  {
    id: 'pegasuscapital-home', brand: 'Pegasus Capital Network', title: 'Pegasus Capital Network',
    canonicalUrl: 'https://pegasuscapitalnetwork.com', domain: 'pegasuscapitalnetwork.com',
    category: 'professional_network',
    audiences: ['capital_professional', 'private_lender', 'developer', 'mortgage_professional'],
    topics: ['capital_network', 'deal_rooms', 'fund', 'introductions'],
    stages: ['education'], languages: ['en'],
    priority: 70, autoRoute: true,
    neverAutoRouteFor: ['consumer_borrower', 'homebuyer', 'homeowner'],
    actionLabel: L('Professional Capital Network', 'Red profesional de capital', 'Профессиональная сеть капитала'),
    shortDescription: L(
      'Professional private-capital network for principals, funds, lenders, developers, and operators.',
      'Red profesional de capital privado para principales, fondos, prestamistas, desarrolladores y operadores.',
      'Профессиональная сеть частного капитала для принципалов, фондов, кредиторов и девелоперов.'),
    verified: true,
  },
  {
    id: 'pegasusprivate-home', brand: 'Pegasus Private Network', title: 'Pegasus Private Network — Tokenization',
    canonicalUrl: 'https://pegasusprivatenetwork.com', domain: 'pegasusprivatenetwork.com',
    category: 'digital_assets',
    audiences: ['qualified_investor', 'capital_professional'],
    topics: ['tokenization', 'digital_assets', 'rwa', 'kyc_aml', 'digital_ownership'],
    stages: ['education'], languages: ['en'],
    priority: 70, autoRoute: true,
    neverAutoRouteFor: ['consumer_borrower', 'homebuyer', 'homeowner'],
    actionLabel: L('Tokenization Education', 'Educación sobre tokenización', 'О токенизации'),
    shortDescription: L(
      'Education on real-world-asset tokenization and compliant digital ownership infrastructure.',
      'Educación sobre tokenización de activos reales e infraestructura de propiedad digital conforme.',
      'Обучение токенизации реальных активов и правовой цифровой инфраструктуре владения.'),
    verified: true,
  },
  {
    id: 'californiardp-home', brand: 'California Residential Development Partners', title: 'CRDP — Development Portfolio',
    canonicalUrl: 'https://californiardp.com', domain: 'californiardp.com',
    category: 'development_proof',
    audiences: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor', 'capital_professional', 'developer'],
    states: ['CA'], topics: ['development', 'construction_experience', 'portfolio'],
    trustIntents: ['development_credibility'],
    stages: ['trust_building'], languages: ['en'],
    priority: 60, autoRoute: true,
    actionLabel: L('See Development Work', 'Ver proyectos de desarrollo', 'Портфолио девелопмента'),
    shortDescription: L(
      "Anatoliy Kanevsky's luxury residential development portfolio — real-world construction experience.",
      'El portafolio de desarrollo residencial de lujo de Anatoliy Kanevsky — experiencia real en construcción.',
      'Портфолио элитного жилого девелопмента Анатолия Каневского — реальный опыт строительства.'),
    verified: true,
  },
  {
    id: 'grcrm-home', brand: 'GRCRM', title: 'GRCRM — Professional CRM Platform',
    canonicalUrl: 'https://grcrm.com', domain: 'grcrm.com',
    category: 'internal_platform',
    audiences: ['internal_user', 'mortgage_professional', 'real_estate_professional'],
    topics: ['crm', 'pipeline', 'lead_management'],
    stages: ['education'], languages: ['en'],
    priority: 50, autoRoute: true,
    neverAutoRouteFor: ['consumer_borrower', 'homebuyer', 'homeowner', 'real_estate_investor', 'qualified_investor'],
    actionLabel: L('Professional CRM', 'CRM profesional', 'Профессиональная CRM'),
    shortDescription: L(
      'CRM platform for mortgage brokers and real estate professionals — never a borrower next step.',
      'Plataforma CRM para brókeres hipotecarios y profesionales inmobiliarios — nunca un paso para prestatarios.',
      'CRM-платформа для ипотечных брокеров и риелторов — не для заёмщиков.'),
    verified: true,
  },
];

// ── Hard exclusions — never indexed, recommended, mentioned, or rendered ──
export const EXCLUDED_DOMAINS = [
  'markevita.com',
  'vistadelmartownhomes.com',
];

// URL patterns that must never render even if a model hallucinates them.
export const EXCLUDED_URL_PATTERNS = [
  /\.netlify\.app/i,          // preview / deployment subdomains
  /netlify\.com/i,
  /localhost|127\.0\.0\.1/i,
  /\bstaging\b/i,
  /\/(admin|login|signin|account|dashboard|wp-admin)(\/|$|\?)/i,
];

const byId = new Map(SITE_REGISTRY.map(r => [r.id, r]));

export function getResource(id) { return byId.get(id) || null; }
export function allResources() { return SITE_REGISTRY.slice(); }

// Geo index for the conversation-intelligence detectors: every known city /
// county keyword mapped to lowercase, longest-first for greedy matching.
export const GEO_KEYWORDS = (() => {
  const set = new Map(); // keyword -> {kind, value}
  for (const r of SITE_REGISTRY) {
    for (const c of r.cities || []) set.set(c, { kind: 'city', value: c });
    for (const c of r.counties || []) set.set(`${c} county`, { kind: 'county', value: c });
  }
  // Additional recognized markets that influence routing decisions.
  set.set('boca raton', { kind: 'city', value: 'boca raton' });
  set.set('miami', { kind: 'city', value: 'miami' });
  set.set('orlando', { kind: 'city', value: 'orlando' });
  set.set('tampa', { kind: 'city', value: 'tampa' });
  return [...set.entries()]
    .map(([keyword, tag]) => ({ keyword, ...tag }))
    .sort((a, b) => b.keyword.length - a.keyword.length);
})();
