/**
 * PEGASUS QA — Master Route Registry
 * Single source of truth for every route in the platform.
 * Used by all QA modules: link-audit, runtime-audit, auth-audit, etc.
 */

const ROUTES = {

  /* ── PUBLIC MARKETING ─────────────────────────────────────── */
  public: [
    { path: '/',                    file: 'index.html',              name: 'Homepage',             cta: ['Join the Network', 'Browse Members'] },
    { path: '/growth-capital.html', file: 'growth-capital.html',     name: 'Growth Capital' },
    { path: '/how-it-works.html',   file: 'how-it-works.html',       name: 'How It Works' },
    { path: '/about.html',          file: 'about.html',              name: 'About' },
    { path: '/contact.html',        file: 'contact.html',            name: 'Contact' },
    { path: '/faq.html',            file: 'faq.html',                name: 'FAQ' },
    { path: '/education.html',      file: 'education.html',          name: 'Education' },
  ],

  /* ── MEMBER DIRECTORIES (public) ──────────────────────────── */
  directories: [
    { path: '/members.html',                     file: 'members.html',                     name: 'Member Directory',           noLoginRequired: true },
    { path: '/borrowers.html',                   file: 'borrowers.html',                   name: 'Borrowers Page' },
    { path: '/mortgage-brokers.html',            file: 'mortgage-brokers.html',            name: 'Mortgage Brokers' },
    { path: '/real-estate-agents.html',          file: 'real-estate-agents.html',          name: 'Real Estate Agents' },
    { path: '/insurance-agents.html',            file: 'insurance-agents.html',            name: 'Insurance Agents' },
    { path: '/business-capital-funding.html',    file: 'business-capital-funding.html',    name: 'Business Funding' },
    { path: '/capital-partner-profile.html',     file: 'capital-partner-profile.html',     name: 'Capital Partners' },
    { path: '/founder-profile.html',             file: 'founder-profile.html',             name: 'Founder Network' },
    { path: '/rwa-partners.html',                file: 'rwa-partners.html',                name: 'RWA Partners' },
    { path: '/lender-profile.html',              file: 'lender-profile.html',              name: 'Lender Profile' },
    { path: '/business-funding-providers.html',  file: 'business-funding-providers.html',  name: 'Business Funding Providers' },
  ],

  /* ── AUTH ─────────────────────────────────────────────────── */
  auth: [
    { path: '/signin.html',          file: 'signin.html',          name: 'Sign In',          form: true },
    { path: '/signup.html',          file: 'signup.html',          name: 'Sign Up',          form: true },
    { path: '/forgot-password.html', file: 'forgot-password.html', name: 'Forgot Password',  form: true },
    { path: '/reset-password.html',  file: 'reset-password.html',  name: 'Reset Password',   form: true },
    { path: '/auth-callback.html',   file: 'auth-callback.html',   name: 'Auth Callback' },
  ],

  /* ── MEMBERSHIP / BILLING ─────────────────────────────────── */
  membership: [
    { path: '/membership.html', file: 'membership.html', name: 'Membership / Pricing', requiresAuth: true },
  ],

  /* ── PROFILE ECOSYSTEM ────────────────────────────────────── */
  profile: [
    { path: '/profile.html',                     file: 'profile.html',         name: 'My Profile',         requiresAuth: true },
    { path: '/profile-edit.html',                file: 'profile-edit.html',    name: 'Edit Profile',       requiresAuth: true, form: true, upload: true },
    { path: '/u/anatoliy-kanevsky',              file: 'public-profile.html',  name: 'Public Profile',     noLoginRequired: true },
    { path: '/public-profile.html',              file: 'public-profile.html',  name: 'Public Profile (fallback)', noLoginRequired: true },
  ],

  /* ── PLATFORM TOOLS ───────────────────────────────────────── */
  platform: [
    { path: '/intelligence.html',        file: 'intelligence.html',        name: 'Intelligence Stream',        requiresAuth: true },
    { path: '/dashboard.html',             file: 'dashboard.html',             name: 'Dashboard',             requiresAuth: true },
    { path: '/deal-rooms.html',            file: 'deal-rooms.html',            name: 'Deal Rooms',             requiresAuth: true },
    { path: '/deal-room.html',             file: 'deal-room.html',             name: 'Deal Room',              requiresAuth: true },
    { path: '/match-engine.html',          file: 'match-engine.html',          name: 'Match Engine',           requiresAuth: true },
    { path: '/messages.html',              file: 'messages.html',              name: 'Messages',               requiresAuth: true },
    { path: '/ai-assistant.html',          file: 'ai-assistant.html',          name: 'AI Assistant',           requiresAuth: true },
    { path: '/ai-advisor.html',            file: 'ai-advisor.html',            name: 'AI Advisor',             requiresAuth: true },
    { path: '/capital-sessions.html',      file: 'capital-sessions.html',      name: 'Capital Sessions',       requiresAuth: true },
    { path: '/capital-academy.html',       file: 'capital-academy.html',       name: 'Capital Academy',        requiresAuth: true },
    { path: '/deal-analyzer.html',         file: 'deal-analyzer.html',         name: 'Deal Analyzer',          requiresAuth: true },
    { path: '/deal-feed.html',             file: 'deal-feed.html',             name: 'Deal Feed',              requiresAuth: true },
    { path: '/lead-finder.html',           file: 'lead-finder.html',           name: 'Lead Finder',            requiresAuth: true },
    { path: '/submit-deal.html',           file: 'submit-deal.html',           name: 'Submit Deal',            requiresAuth: true },
    { path: '/capital-strategy-simulator.html', file: 'capital-strategy-simulator.html', name: 'Strategy Simulator', requiresAuth: true },
    { path: '/saved-scenario.html',        file: 'saved-scenario.html',        name: 'Saved Scenario',         requiresAuth: true },
    { path: '/investor-interest.html',     file: 'investor-interest.html',     name: 'Investor Interest',      requiresAuth: true },
    { path: '/network-badge.html',         file: 'network-badge.html',         name: 'Network Badge' },
    { path: '/badge-proof-submit.html',    file: 'badge-proof-submit.html',    name: 'Badge Proof Submit' },
    { path: '/agent-partnership.html',     file: 'agent-partnership.html',     name: 'Agent Partnership' },
    { path: '/partner-media-kit.html',     file: 'partner-media-kit.html',     name: 'Partner Media Kit' },
  ],

  /* ── RWA PAGES ────────────────────────────────────────────── */
  rwa: [
    { path: '/rwa-network.html',           file: 'rwa-network.html',           name: 'RWA Network' },
    { path: '/rwa-tokenization.html',      file: 'rwa-tokenization.html',      name: 'RWA Tokenization' },
    { path: '/rwa-education.html',         file: 'rwa-education.html',         name: 'RWA Education' },
    { path: '/rwa-events-network.html',    file: 'rwa-events-network.html',    name: 'RWA Events' },
    { path: '/rwa-readiness-check.html',   file: 'rwa-readiness-check.html',   name: 'RWA Readiness' },
    { path: '/rwa-partner-profile.html',   file: 'rwa-partner-profile.html',   name: 'RWA Partner Profile',   requiresAuth: true },
    { path: '/rwa-project-intake.html',    file: 'rwa-project-intake.html',    name: 'RWA Project Intake',    requiresAuth: true },
    { path: '/rwa-project-workspace.html', file: 'rwa-project-workspace.html', name: 'RWA Project Workspace', requiresAuth: true },
  ],

  /* ── ADMIN ────────────────────────────────────────────────── */
  admin: [
    { path: '/admin.html', file: 'admin.html', name: 'Admin Dashboard', requiresAuth: true, requiresAdmin: true },
  ],

  /* ── LEGAL ────────────────────────────────────────────────── */
  legal: [
    { path: '/privacy.html',       file: 'privacy.html',       name: 'Privacy Policy' },
    { path: '/terms.html',         file: 'terms.html',         name: 'Terms of Service' },
    { path: '/disclosures.html',   file: 'disclosures.html',   name: 'Disclosures' },
    { path: '/trust-and-safety.html', file: 'trust-and-safety.html', name: 'Trust & Safety' },
  ],

};

/* Flat arrays for convenience */
ROUTES.allPublic = [
  ...ROUTES.public,
  ...ROUTES.directories,
  ...ROUTES.auth,
  ...ROUTES.rwa,
  ...ROUTES.legal,
];

ROUTES.allProtected = [
  ...ROUTES.membership,
  ...ROUTES.profile,
  ...ROUTES.platform,
  ...ROUTES.admin,
];

ROUTES.all = [...ROUTES.allPublic, ...ROUTES.allProtected];

module.exports = ROUTES;
