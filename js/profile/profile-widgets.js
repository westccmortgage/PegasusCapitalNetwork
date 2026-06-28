/* ============================================================================
   PEGASUS — Profile Ecosystem Layer · profile-widgets.js
   Pure renderers for the profile home. All scoped to .peco-* classes so they
   never collide with the global stylesheet. Uses existing CSS variables.
   Exposes: window.PegProfileUI
   ============================================================================ */
(function () {
  'use strict';

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function initials(name) { return (name || 'M').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function titleCase(s) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  /* ── HERO: banner + avatar + identity ───────────────────────────────────── */
  function hero(p, opts) {
    p = p || {}; opts = opts || {};
    var name = p.full_name || p.display_name || 'Member';
    var bannerStyle = p.banner_url
      ? 'background-image:linear-gradient(180deg,rgba(8,17,28,0.05),rgba(8,17,28,0.18)),url(' + esc(p.banner_url) + ');background-size:cover;background-position:' + esc(p.banner_focal || 'center')
      : '';
    var avatar = p.avatar_url
      ? '<img class="peco-avatar-img" src="' + esc(p.avatar_url) + '" alt="' + esc(name) + '">'
      : '<div class="peco-avatar-fallback" style="background:' + (p.avatar_color || 'linear-gradient(135deg,#112244,#2271C3)') + '">' + initials(name) + '</div>';

    var tags = window.PegProfile.reputationTags(p);
    var badgeRow = tags.length
      ? '<div class="peco-badges">' + tags.map(function (t) {
        return '<span class="peco-badge peco-badge-' + t.tone + '">' + esc(t.label) + '</span>';
      }).join('') + '</div>' : '';

    var metaBits = [];
    if (p.role) metaBits.push(titleCase(p.role));
    if (p.company_name) metaBits.push(esc(p.company_name));
    if (p.location || p.market) metaBits.push(esc(p.location || p.market));
    if (p.created_at) metaBits.push('Member since ' + esc(p.created_at.slice(0, 7)));

    return '' +
      '<div class="peco-hero">' +
      '<div class="peco-hero-banner" style="' + bannerStyle + '">' +
      '<div class="peco-hero-wm"></div>' +
      '</div>' +
      '<div class="peco-hero-foot">' +
      '<div class="peco-avatar">' + avatar +
      (p.verification_status === 'verified' ? '<span class="peco-verify" title="Verified">&#10003;</span>' : '') +
      '</div>' +
      '<div class="peco-hero-id">' +
      '<div class="peco-hero-name">' + esc(name) + '</div>' +
      (p.professional_title || p.headline ? '<div class="peco-hero-title">' + esc(p.professional_title || p.headline) + '</div>' : '') +
      (metaBits.length ? '<div class="peco-hero-meta">' + metaBits.join('<span class="peco-dot">&middot;</span>') + '</div>' : '') +
      badgeRow +
      '</div>' +
      (opts.actions ? '<div class="peco-hero-actions">' + opts.actions + '</div>' : '') +
      '</div>' +
      (p.current_focus ? '<div class="peco-focus"><span class="peco-focus-k">Current focus</span> ' + esc(p.current_focus) + '</div>' : '') +
      '</div>';
  }

  /* ── Identity detail card (left column) ─────────────────────────────────── */
  function identityCard(p) {
    p = p || {};
    var spec = (p.specialties || []);
    var mkts = (p.markets || []);
    var creds = (p.credentials || []);
    var sections = [];

    if (p.bio) sections.push('<div class="peco-sec"><div class="peco-sec-h">About</div><div class="peco-bio">' + esc(p.bio) + '</div></div>');

    if (mkts.length) sections.push('<div class="peco-sec"><div class="peco-sec-h">Markets</div><div class="peco-chips">' +
      mkts.map(function (m) { return '<span class="peco-chip">' + esc(m) + '</span>'; }).join('') + '</div></div>');

    if (spec.length) sections.push('<div class="peco-sec"><div class="peco-sec-h">Specialties</div><div class="peco-chips">' +
      spec.map(function (s) { return '<span class="peco-chip peco-chip-b">' + esc(s) + '</span>'; }).join('') + '</div></div>');

    if (creds.length) sections.push('<div class="peco-sec"><div class="peco-sec-h">Credentials</div>' +
      creds.map(function (c) { return '<div class="peco-cred">' + esc(typeof c === 'string' ? c : (c.label || c.name || '')) + '</div>'; }).join('') + '</div>');

    if (!sections.length) sections.push('<div class="peco-sec"><div class="peco-bio peco-muted">No profile details yet.</div></div>');

    return '<div class="card peco-card"><div class="card-body">' + sections.join('') + '</div></div>';
  }

  /* ── Reputation / metrics card (right column) ───────────────────────────── */
  function metricsCard(p, metrics) {
    p = p || {};
    // metrics are REAL or zero — never fabricated
    var rows = metrics || [
      ['Profile completion', (typeof p.profile_completion === 'number' ? p.profile_completion : 0) + '%'],
      ['Profile views', '0'],
      ['Introductions', '0'],
      ['Sessions attended', '0'],
      ['Deal Room activity', '0'],
    ];
    return '<div class="card peco-card"><div class="card-body">' +
      '<div class="peco-sec-h">Network presence</div>' +
      rows.map(function (r) {
        return '<div class="peco-metric"><span class="peco-metric-k">' + esc(r[0]) + '</span><span class="peco-metric-v">' + esc(r[1]) + '</span></div>';
      }).join('') +
      '</div></div>';
  }

  /* ── Featured modules card ──────────────────────────────────────────────── */
  function featuredCard(p, isOwner) {
    p = p || {};
    var mods = (p.featured_modules || []).filter(function(m){ return m.kind !== 'update'; });
    var body;
    if (mods.length) {
      body = mods.map(function (m) {
        return '<a class="peco-feat" href="' + esc(m.href || '#') + '">' +
          '<div class="peco-feat-kind">' + esc(m.kind || 'Featured') + '</div>' +
          '<div class="peco-feat-title">' + esc(m.title || '') + '</div>' +
          (m.note ? '<div class="peco-feat-note">' + esc(m.note) + '</div>' : '') +
          '</a>';
      }).join('');
    } else {
      body = '<div class="peco-empty-mini">' +
        (isOwner
          ? 'Feature a Deal Room, raise, session, report, or pitch deck to showcase your work.'
          : 'No featured work yet.') +
        '</div>' +
        (isOwner ? '<a class="btn btn-ghost btn-sm" href="profile-edit.html" style="margin-top:12px">Add Featured Item &rarr;</a>' : '');
    }
    return '<div class="card peco-card"><div class="card-body">' +
      '<div class="peco-sec-h">Featured</div>' + body + '</div></div>';
  }

  /* ── Network activity card (calm, real, empty when none) ────────────────── */
  function activityCard(items) {
    items = items || [];
    var iconFor = {
      session_joined: '&#9673;', deal_room_opened: '&#9696;', lender_interest: '&#9670;',
      featured: '&#9733;', briefing: '&#9673;', appetite_updated: '&#9671;', growth_request: '&#9650;'
    };
    var body;
    if (items.length) {
      body = items.map(function (a) {
        var when = a.created_at ? timeAgo(a.created_at) : '';
        return '<div class="peco-act">' +
          '<span class="peco-act-ic">' + (iconFor[a.kind] || '&#8226;') + '</span>' +
          '<span class="peco-act-label">' + esc(a.label) + '</span>' +
          '<span class="peco-act-when">' + esc(when) + '</span>' +
          '</div>';
      }).join('');
    } else {
      body = '<div class="peco-empty-mini">No network activity yet. Joining sessions, opening Deal Rooms, and updating your appetite will appear here.</div>';
    }
    return '<div class="card peco-card"><div class="card-body">' +
      '<div class="peco-sec-h">Network activity</div>' + body + '</div></div>';
  }

  function timeAgo(iso) {
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }

  /* ── Completion panel (owner only, when < 100%) ─────────────────────────── */
  function completionPanel(p) {
    var pct = typeof p.profile_completion === 'number' ? p.profile_completion : 0;
    var miss = window.PegProfile.missingFields(p);
    return '<div class="card peco-card peco-complete"><div class="card-body">' +
      '<div class="peco-complete-head"><span>Complete your profile</span><span class="peco-complete-pct">' + pct + '%</span></div>' +
      '<div class="peco-progress"><div class="peco-progress-bar" style="width:' + pct + '%"></div></div>' +
      (miss.length
        ? '<div class="peco-miss-label">Add these to strengthen your presence:</div>' +
        '<div class="peco-chips">' + miss.map(function (f) { return '<span class="peco-chip peco-chip-a">' + esc(f) + '</span>'; }).join('') + '</div>'
        : '<div class="peco-miss-label">Your profile is complete. Keep it current to maximize match quality.</div>') +
      '<a class="btn btn-pri btn-sm" href="profile-edit.html" style="margin-top:14px">Complete Profile &rarr;</a>' +
      '</div></div>';
  }


  /* ── Member Updates card (from featured_modules where kind==='update') ── */
  function updatesCard(p) {
    p = p || {};
    var mods = (p.featured_modules || []).filter(function(m){ return m && m.kind === 'update' && m.title; });
    if (!mods.length) return '';
    var typeMap = {
      program:     {icon:'🚀',label:'New Program',     bg:'rgba(154,123,34,0.10)',  col:'#6B4A0A'},
      milestone:   {icon:'🏆',label:'Milestone',        bg:'rgba(35,95,166,0.09)',   col:'#0F3A7A'},
      opportunity: {icon:'💼',label:'Opportunity',      bg:'rgba(12,126,150,0.09)',  col:'#064A5C'},
      announcement:{icon:'📢',label:'Announcement',     bg:'rgba(28,30,26,0.06)',    col:'#3A3D38'},
      seeking:     {icon:'🔍',label:'Seeking',          bg:'rgba(14,154,102,0.09)',  col:'#0A5C3D'},
      partnership: {icon:'🤝',label:'Partnership',      bg:'rgba(181,118,15,0.09)', col:'#5A3E0A'},
    };
    var accentColors = {program:'#9A7B22',milestone:'#235FA6',opportunity:'#0C7E96',announcement:'#56606B',seeking:'#0E9A66',partnership:'#B5760F'};
    var html = mods.map(function(m, i) {
      var t = typeMap[m.type] || typeMap.announcement;
      var accent = accentColors[m.type] || '#56606B';
      var dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
      return '<div style="display:grid;grid-template-columns:3px 1fr;border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;margin-bottom:12px">'+
        '<div style="background:'+accent+';border-radius:0"></div>'+
        '<div style="padding:14px 18px;background:var(--bg1)">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
            '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;background:'+t.bg+';color:'+t.col+';border:1px solid '+t.bg+'">'+t.icon+' '+t.label+'</span>'+
            (dateStr ? '<span style="font-family:var(--mono);font-size:10px;color:var(--text4)">'+dateStr+'</span>' : '')+
          '</div>'+
          '<div style="font-family:var(--serif);font-size:16px;font-weight:400;color:var(--text);line-height:1.35;margin-bottom:7px">'+esc(m.title)+'</div>'+
          (m.body ? '<div style="font-size:12.5px;color:var(--text2);line-height:1.65;margin-bottom:10px">'+esc(m.body)+'</div>' : '')+
          (m.cta_label && m.cta_url ? '<a href="'+esc(m.cta_url)+'" style="display:inline-flex;align-items:center;font-size:12px;font-weight:500;color:var(--blue);text-decoration:none;padding:5px 12px;border:1px solid var(--border2);border-radius:var(--r1)">'+esc(m.cta_label)+'</a>' : '')+
        '</div>'+
      '</div>';
    }).join('');
    return '<div class="card peco-card" style="margin-bottom:0"><div class="card-body">'+
      '<div class="peco-sec-h" style="margin-bottom:14px">Member Updates</div>'+html+
    '</div></div>';
  }

  window.PegProfileUI = {
    updatesCard: updatesCard,
    hero: hero,
    identityCard: identityCard,
    metricsCard: metricsCard,
    featuredCard: featuredCard,
    activityCard: activityCard,
    completionPanel: completionPanel,
  };
})();
