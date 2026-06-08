/* ============================================================================
   PEGASUS — Profile Ecosystem Layer · profile-signals.js
   "Pegasus Signals" — contextual capital intelligence, NOT a social feed.
   All signals are derived from REAL Supabase tables. When no real data
   exists, an elegant empty state is shown — never fabricated activity.
   Exposes: window.PegSignals
   ============================================================================ */
(function () {
  'use strict';

  async function sb() { try { return await window.PegSB.ready; } catch (e) { return null; } }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ── Data sources (real, RLS-respecting) ─────────────────────────────────── */
  async function lenderAppetites(limit) {
    var c = await sb(); if (!c) return [];
    try { var r = await c.from('lender_appetite_profiles').select('*').eq('active', true).limit(limit || 5); return r.data || []; }
    catch (e) { return []; }
  }
  async function recentFinancingRequests(limit) {
    var c = await sb(); if (!c) return [];
    try { var r = await c.from('financing_requests').select('*').eq('status', 'submitted').order('created_at', { ascending: false }).limit(limit || 5); return r.data || []; }
    catch (e) { return []; }
  }
  async function founderSubmissions(limit) {
    var c = await sb(); if (!c) return [];
    try { var r = await c.from('founder_submissions').select('*').eq('status', 'submitted').order('created_at', { ascending: false }).limit(limit || 5); return r.data || []; }
    catch (e) { return []; }
  }
  async function activeDealRooms(limit) {
    var c = await sb(); if (!c) return [];
    try { var r = await c.from('deal_rooms').select('*').neq('workflow_state', 'closed').order('updated_at', { ascending: false }).limit(limit || 5); return r.data || []; }
    catch (e) { return []; }
  }

  /* ── Signal card renderer (calm, institutional) ──────────────────────────── */
  function signalCard(icon, tone, title, sub, href) {
    var inner =
      '<div class="peco-signal">' +
      '<div class="peco-signal-ic" style="--tone:var(--' + tone + ')">' + icon + '</div>' +
      '<div class="peco-signal-body">' +
      '<div class="peco-signal-title">' + esc(title) + '</div>' +
      (sub ? '<div class="peco-signal-sub">' + esc(sub) + '</div>' : '') +
      '</div>' +
      (href ? '<span class="peco-signal-arrow">&rarr;</span>' : '') +
      '</div>';
    return href ? '<a class="peco-signal-link" href="' + href + '">' + inner + '</a>' : inner;
  }

  function emptyState(title, sub, ctaLabel, ctaHref) {
    return '<div class="peco-empty">' +
      '<div class="peco-empty-mark">&#9678;</div>' +
      '<div class="peco-empty-title">' + esc(title) + '</div>' +
      '<div class="peco-empty-sub">' + esc(sub) + '</div>' +
      (ctaLabel ? '<a class="btn btn-ghost btn-sm" href="' + ctaHref + '" style="margin-top:14px">' + esc(ctaLabel) + ' &rarr;</a>' : '') +
      '</div>';
  }

  /* ── Role-specific stream assembly ───────────────────────────────────────── */
  async function buildStream(role) {
    role = (role || 'member').toLowerCase();
    var cards = [];

    if (role === 'borrower' || role === 'developer') {
      var apps = await lenderAppetites(5);
      apps.forEach(function (a) {
        cards.push(signalCard('&#9670;', 'green',
          (a.lender_name || a.name || 'Active lender') + ' — capital available',
          [a.loan_types && (Array.isArray(a.loan_types) ? a.loan_types.join(', ') : a.loan_types), a.markets, a.terms].filter(Boolean).join(' · '),
          'match-engine.html'));
      });
      var rooms = await activeDealRooms(3);
      rooms.forEach(function (d) {
        cards.push(signalCard('&#9696;', 'blue', 'Deal Room activity', (d.name || 'Workspace') + ' · ' + (d.workflow_state || 'active'), 'deal-rooms.html'));
      });
      if (!cards.length) return emptyState('No capital signals yet',
        'As lenders publish appetite and Deal Rooms open, matching capital signals will appear here.',
        'Run the Match Engine', 'match-engine.html');
    }

    else if (role === 'lender') {
      var reqs = await recentFinancingRequests(6);
      reqs.forEach(function (r) {
        cards.push(signalCard('&#9670;', 'teal', 'New financing request',
          [r.property_type, r.loan_type, r.location].filter(Boolean).join(' · ') || 'Growth Partner submission', 'deal-feed.html'));
      });
      if (!cards.length) return emptyState('No Growth Partner submissions yet',
        'When Growth Partners submit financing requests that match your appetite, they will surface here.',
        'View Deal Feed', 'deal-feed.html');
    }

    else if (role === 'investor' || role === 'rwa_partner') {
      var fs = await founderSubmissions(5);
      fs.forEach(function (f) {
        cards.push(signalCard('&#9650;', 'gold', (f.company_name || f.co || 'New founder') + ' — Growth Capital',
          [f.sector, f.stage, f.raise_target && ('$' + f.raise_target)].filter(Boolean).join(' · '), 'growth-capital.html'));
      });
      var rooms2 = await activeDealRooms(3);
      rooms2.forEach(function (d) {
        cards.push(signalCard('&#9696;', 'blue', 'Strategic opportunity', (d.name || 'Deal Room') + ' · ' + (d.workflow_state || 'active'), 'deal-rooms.html'));
      });
      if (!cards.length) return emptyState('No opportunities yet',
        'Founder raises, high-alignment Deal Rooms, and strategic opportunities will appear here as the network grows.',
        'Explore Growth Capital', 'growth-capital.html');
    }

    else { // generic member / broker / agent / insurance
      var rooms3 = await activeDealRooms(4);
      rooms3.forEach(function (d) {
        cards.push(signalCard('&#9696;', 'blue', 'Deal Room activity', (d.name || 'Workspace') + ' · ' + (d.workflow_state || 'active'), 'deal-rooms.html'));
      });
      if (!cards.length) return emptyState('Your capital intelligence stream',
        'Personalized signals — matching capital, market activity, and relevant sessions — appear here as you engage the network.',
        'Open the Dashboard', 'dashboard.html');
    }

    return '<div class="peco-signal-list">' + cards.join('') + '</div>';
  }

  window.PegSignals = { buildStream: buildStream, signalCard: signalCard, emptyState: emptyState };
})();
