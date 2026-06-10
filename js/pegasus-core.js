/* ============================================================================
   PEGASUS v69 — Core: app shell, session, nav injection, helpers.
   Preview-ready: defaults to a demo session so every page renders on Netlify.
   In production, swap loadSession() to read Supabase auth + entitlements.
   ============================================================================ */
(function(){

  /* ══════════════════════════════════════════════════════════════════════════
     PLATFORM-WIDE WATERMARK — injected once here, applies to all 63 pages.
     Uses a real <img> element (not CSS ::after) so it reliably loads on live.
     The homepage keeps its own .peg-hero-wm img; this is additive + distinct.
     ══════════════════════════════════════════════════════════════════════════ */
  (function injectWatermark(){
    try{
      var wm=document.createElement('div');
      wm.className='peg-wm-global';
      wm.setAttribute('aria-hidden','true');
      // Use pegasus-symbol.svg: vector, crisp at any size, deployed in brand package
      var img=document.createElement('img');
      img.src='/assets/brand/pegasus-symbol.svg';
      img.alt='';
      img.setAttribute('draggable','false');
      img.setAttribute('fetchpriority','low');  // don't delay critical resources
      img.setAttribute('loading','lazy');
      wm.appendChild(img);
      document.body.appendChild(wm);
    }catch(e){}  // silent fail — never blocks page
  })();


  const Store = window.PegStore;
  // session shim — proxies the global store so legacy pages keep working
  const sessionProxy = ()=>{ const st=Store.get(); const p=st.profile||{}; return {
    demo: st.mode==='demo', name:p.full_name||'Member', email:(st.user&&st.user.email)||p.email||'',
    initials:(p.full_name||'M ').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(),
    tier: st.tier, role:p.role, profile:p, subscription: st.subscription||{},
    usage: st.usage, onboarding_complete: !!p.onboarding_complete };
  };
  const T = ()=> (window.PEG_TIERS||{})[Store.get().tier] || {};
  const lim = k => (T().limits||{})[k];

  // boot(): hydrate the global store (live or demo) then render. Use on every
  // page that needs real state. Re-renders on store changes.
  /* Password show/hide toggle — capture-phase event delegation.
     Registered once in core.js; covers every page that loads it.
     Capture phase (3rd arg = true) fires BEFORE the input receives the click,
     so the .pw-toggle button wins the pointer-event race on Safari/iPad/WebKit
     where native form elements can paint above positioned children.           */
  document.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('.pw-toggle') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var wrap = btn.closest ? btn.closest('.pw-wrap') : btn.parentElement;
    if (!wrap) return;
    var inp = wrap.querySelector('input');
    if (!inp) return;
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.innerHTML = show ? '&#x1F648;' : '&#x1F441;';
    btn.title    = show ? 'Hide password' : 'Show password';
  }, true);

  async function boot(render){
    await Store.hydrate();
    render(Store.get());
    Store.subscribe(()=>{}); // keep store warm; pages opt into live re-render via Store.subscribe
  }
  // --- helpers (restored) ---
  function el(id){ return document.getElementById(id); }
  function fmt(n){ n=+n||0; const a=Math.abs(n);
    if(a>=1e9) return '$'+(n/1e9).toFixed(1).replace(/\.0$/,'')+'B';
    if(a>=1e6) return '$'+(n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if(a>=1e3) return '$'+Math.round(n/1e3)+'K';
    return '$'+Math.round(n).toLocaleString(); }
  // HTML-escape a value before interpolating it into an innerHTML sink.
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  // Allow only safe URL schemes in an href (blocks javascript:, data:, etc.).
  function safeUrl(u){ u=String(u==null?'':u).trim(); if(!u) return '#'; return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(u) ? esc(u) : '#'; }
  function toast(icon,bg,title,sub){
    const t=document.createElement('div'); t.className='toast';
    t.innerHTML='<div class="toast-ic" style="background:'+(bg||'var(--blue-dim)')+'">'+(icon||'\u2022')+'</div>'+
      '<div><div class="toast-t">'+esc(title||'')+'</div>'+(sub?'<div class="toast-s">'+esc(sub)+'</div>':'')+'</div>';
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),320); },2800);
  }

  // --- public nav (full-site mega menu) ---
  function publicNav(active){
    const G=(label,items)=>`<div class="nav-group"><span tabindex="0" role="button" aria-haspopup="true">${label} \u25BE</span><div class="nav-drop">${items.map(i=>`<a href="${i[1]}"><span>${i[0]}</span>${i[2]?`<small>${i[2]}</small>`:''}</a>`).join('')}</div></div>`;
    const rwa=G('RWA',[['RWA Network','/rwa-network.html','Real-world asset partners'],['Tokenization','/rwa-tokenization.html','Structured RE on-chain'],['RWA Education','/rwa-education.html','Frameworks & glossary'],['Events Network','/rwa-events-network.html','Capital sessions']]);
    const learn=G('Learn',[['Capital Assistant','/ai-assistant.html','Ask about lenders, members & deals'],['Capital Sessions','/capital-sessions.html','Live institutional briefings'],['How It Works','/how-it-works.html','How the platform works'],['Capital Academy','/capital-academy.html','Finance fundamentals'],['Education Hub','/education.html','Guides & resources'],['FAQ','/faq.html','Common questions']]);
    const company=G('Company',[['About','/about.html','Our mission'],['Contact','/contact.html','Get in touch'],['Trust & Safety','/trust-and-safety.html','How we protect members'],['Network Badge','/network-badge.html','Verified credentials']]);
    return `<a href="#maincontent" class="skip-link" onclick="var m=document.getElementById('maincontent')||document.querySelector('main,section,.section,.auth-wrap,.ar-wrap,.view');if(m){m.setAttribute('tabindex','-1');m.focus();}">Skip to content</a><nav class="pub-nav">
      <a class="brand" href="/"><img class="brand-mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus"><span>Pegasus Network</span></a>
      <div class="pub-links"><a href="/explore.html" class="${active==='Explore'?'on':''}">Explore</a><a href="/how-it-works.html" class="${active==='Platform'?'on':''}">Platform</a><a href="/members.html" class="${active==='Members'?'on':''}">Member Network</a><a href="/growth-capital.html" class="${active==='Growth'?'on':''}">Growth Capital</a>${rwa}${learn}${company}<a href="https://pegasusevents.net/" target="_blank" rel="noopener noreferrer">Events</a></div>
      <div class="nav-cta" id="pub-nav-cta"><a class="btn btn-ghost" id="nav-signin-btn" href="/signin.html">Sign In</a><a class="btn btn-pri nav-create" id="nav-create-btn" href="/signup.html">Create Free Profile</a></div>
      <button class="mob-menu-btn" id="mobMenuBtn" aria-label="Menu"><span></span><span></span><span></span></button>
    </nav>
    <div class="mob-overlay" id="mobOverlay"></div>
    <div class="mob-drawer" id="mobDrawer">
      <div class="mob-drawer-head"><img src="/assets/brand/pegasus-wordmark.png" style="height:24px"><button class="mob-drawer-close" id="mobClose" aria-label="Close menu">✕</button></div>
      <div class="mob-drawer-nav">
        <a href="/">Platform Overview</a><a href="/members.html">Member Network</a><a href="/growth-capital.html">Growth Capital</a>
        <div class="mob-sec">Platform</div>
        <a href="/capital-sessions.html">Capital Sessions</a><a href="/match-engine.html">Match Engine</a><a href="/capital-academy.html">Capital Academy</a>
        <div class="mob-sec">RWA</div>
        <a href="/rwa-network.html">RWA Network</a><a href="/rwa-tokenization.html">Tokenization</a><a href="/rwa-education.html">RWA Education</a><a href="/rwa-events-network.html">Events Network</a>
        <div class="mob-sec">Company</div>
        <a href="/about.html">About</a><a href="/contact.html">Contact</a><a href="/membership.html">Membership</a><a href="/faq.html">FAQ</a><a href="https://pegasusevents.net/" target="_blank" rel="noopener noreferrer">Events ↗</a>
      </div>
      <div class="mob-drawer-foot"><a class="btn btn-ghost" href="/signin.html">Sign In</a><a class="btn btn-pri nav-create" href="/signup.html">Create Profile</a></div>
    </div>
`;
  }
  // --- app shell (sidebar + topbar) ---
  function mountApp(opts){
    const active=opts.active, title=opts.title, sub=opts.sub||'';
    const S=sessionProxy(); const st=Store.get();
    const t=S.tier, meta=T();
    const drCap=lim('dealRooms'); const drBadge = drCap===Infinity?`${S.usage.rooms}`:(drCap>0?`${S.usage.rooms}/${drCap}`:null);
    const meLocked = lim('matchEngine')==='none';
    const item=(ic,label,href,o={})=>{
      const locked=o.locked, badge=o.badge;
      return `<a class="sb-item ${active===label?'active':''}" href="${href}">
        <span class="sb-ic">${ic}</span>${label}
        ${badge?`<span class="sb-badge ${locked?'lock':'b'}">${badge}</span>`:''}${locked?`<span class="sb-badge lock">🔒</span>`:''}</a>`;
    };
    const sidebar=`<aside class="sidebar">
      <div class="sb-head"><img class="brand-mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus"><div><div class="sb-logo">Pegasus</div><div class="sb-ws">Capital Workspace</div></div></div>
      <div class="sb-nav">
        <div class="sb-sec">Workspace</div>
        ${item('▦','Dashboard','/dashboard.html')}
        ${item('✦','Get Started','/get-started.html')}
        ${item('◇','Network Requests','/network-requests.html')}
        ${item('◈','Reviewed Status','/apply-review.html')}
        ${item('◈','Deal Rooms','/deal-rooms.html',{badge:drBadge,locked:drCap===0})}
        ${item('◎','Match Engine','/match-engine.html',{locked:meLocked})}
        ${item('◆','Intelligence','/intelligence.html')}
        ${item('✦','Capital Assistant','/ai-assistant.html')}
        ${item('▣','CRM','/crm.html')}
        <div class="sb-sec">Account</div>
        ${item('❖','Showcase','/showcase.html')}
        ${item('◫','Business Pages','/my-presences.html')}
        ${item('▤','Billing & Plan','/membership.html')}
        ${item('⚙','Edit Profile','/profile-edit.html')}
        ${(typeof Store!=='undefined'&&Store.isAdmin&&Store.isAdmin())?item('⚑','Admin Console','/admin.html'):''}
        ${(typeof Store!=='undefined'&&Store.isAdmin&&Store.isAdmin())?item('◇','Admin · Requests','/admin-requests.html'):''}
        ${(typeof Store!=='undefined'&&Store.isAdmin&&Store.isAdmin())?item('◈','Admin · Trust','/admin-trust-reviews.html'):''}
      </div>
      <div class="sb-foot">
        <div class="sb-tier"><div class="sb-tier-name"><span class="dot" style="background:${meta.dot}"></span>${meta.name}</div>
          <div class="sb-tier-blurb">${meta.layer}</div>
          ${t!=='gold'?`<button class="sb-tier-cta" style="background:var(--blue);color:#fff" onclick="location.href='/membership.html'">Upgrade Access →</button>`:`<button class="sb-tier-cta" style="background:var(--gold-dim);color:var(--gold);border:1px solid rgba(170,137,38,0.25)" onclick="location.href='/membership.html'">Manage Plan</button>`}
        </div>
        <a class="sb-prof" href="/profile.html"><div class="avatar">${esc(S.initials)}</div><div><div class="sb-uname">${esc(S.name)}</div><div class="sb-uemail">${esc(S.email)}</div></div></a>
      </div>
    </aside>`;
    const unread=st.counts.unreadNotifications||0;
    const topbar=`<div class="topbar">
      <div><h1 class="tb-title">${esc(title)}</h1><div class="tb-sub">${esc(sub)}</div></div>
      <div class="tb-right">
        <div class="tier-chip" style="background:${t==='gold'?'var(--gold-dim)':'var(--blue-dim)'};color:${t==='gold'?'var(--gold)':'var(--blue-lt)'};border:1px solid ${t==='gold'?'rgba(170,137,38,0.25)':'rgba(34,113,195,0.25)'}"><span class="dot" style="background:${meta.dot}"></span>${meta.name}<span class="tier-layer"> · ${meta.layer}</span></div>
        <div style="position:relative"><button class="tb-icon" aria-label="${unread?('Notifications, '+unread+' unread'):'Notifications'}" onclick="Pegasus.toggleNotif(event)">🔔${unread?`<span style="position:absolute;top:-3px;right:-3px;background:var(--red);color:#fff;font-size:8px;font-family:var(--mono);min-width:14px;height:14px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 3px">${unread}</span>`:''}</button><div id="notifPanel"></div></div>
        <div style="position:relative">
          <button class="tb-icon" title="My Account" aria-label="My Account" onclick="Pegasus.toggleAccount(event)">${esc(S.initials)||"◉"} ▾</button>
          <div id="acctMenu"></div>
        </div>
      </div></div>`;
    document.body.innerHTML =
      `<a href="#maincontent" class="skip-link" onclick="var m=document.getElementById('maincontent')||document.querySelector('main,section,.section,.auth-wrap,.ar-wrap,.view');if(m){m.setAttribute('tabindex','-1');m.focus();}">Skip to content</a><div class="shell">${sidebar}<div class="main">${topbar}<main class="view" id="maincontent" tabindex="-1"><div class="wrap-narrow" id="pegView"></div></main></div></div>`+
      `<div id="modalRoot"></div><nav class="mob-tabbar"><a class="mob-tab ${active==='Dashboard'?'active':''}" href="/dashboard.html"><span class="mob-tab-ic">▦</span>Dashboard</a><a class="mob-tab ${active==='Deal Rooms'?'active':''}" href="/deal-rooms.html"><span class="mob-tab-ic">◈</span>Rooms</a><a class="mob-tab ${active==='Match Engine'?'active':''}" href="/match-engine.html"><span class="mob-tab-ic">◎</span>Match</a><a class="mob-tab ${active==='Capital Intelligence'?'active':''}" href="/ai-assistant.html"><span class="mob-tab-ic">✦</span>Ask</a><a class="mob-tab" href="/profile.html"><span class="mob-tab-ic">◉</span>Profile</a></nav>`;
    const v=el('pegView');
    /* Admin Console — live DB check (bypasses stale store cache entirely)
     * Queries profiles.role directly from Supabase after sidebar renders.
     * Both adds link (if admin) and removes it (if non-admin slipped through).
     * Non-blocking async — sidebar renders instantly, link pops in ~200ms. */
    (async function checkAdminRole(){
      try {
        var sb = await window.PegSB.ready;
        var userRes = await sb.auth.getUser();
        var uid = userRes && userRes.data && userRes.data.user && userRes.data.user.id;
        if (!uid) return;
        var res = await sb.from('profiles').select('role, is_admin').eq('id', uid).maybeSingle();
        /* CRITICAL: if query errored, do NOT remove the existing link.
         * A failed query must never remove the admin link — only an explicit
         * role !== 'admin' response should hide it. */
        if (res.error) {
          /* CRITICAL: failed query must NOT remove the link. Retry once, then bail. */
          console.debug('[Admin] query error — retrying once:', res.error.message);
          var res2 = await sb.from('profiles').select('role, is_admin').eq('id', uid).maybeSingle();
          if (res2.error) {
            window.__PEG_ADMIN_DEBUG = { uid: uid, role: null, isAdmin: false, error: res2.error.message, source: 'core-recheck-failed' };
            return; /* leave sidebar untouched */
          }
          res = res2;
        }
        var isAdmin = res.data && (res.data.is_admin === true || res.data.role === 'admin');
        window.__PEG_ADMIN_DEBUG = { uid: uid, role: res.data && res.data.role, is_admin_flag: res.data && res.data.is_admin, isAdmin: isAdmin, error: null, source: 'core-recheck' };
        var nav = document.querySelector('.sb-nav');
        if (!nav) return;
        var existing = nav.querySelector('[href="/admin.html"]');
        if (isAdmin && !existing) {
          /* Admin confirmed in DB — inject the link */
          nav.insertAdjacentHTML('beforeend',
            '<a class="sb-item" href="/admin.html"><span class="sb-ic">⚑</span>Admin Console</a>');
          console.debug('[Admin] link injected for uid:', uid);
        } else if (!isAdmin && existing) {
          /* DB explicitly confirmed non-admin — remove the link */
          existing.parentNode && existing.parentNode.removeChild(existing);
          console.debug('[Admin] link removed — role is:', res.data && res.data.role);
        } else if (isAdmin && existing) {
          console.debug('[Admin] link already present for admin uid:', uid);
        }
      } catch(e) { /* Non-fatal — admin link just won't show if DB unreachable */ }
    })();
    if(Store.needsOnboarding && Store.needsOnboarding()){
      v.insertAdjacentHTML('afterbegin',`<div class="banner bn-info"><div class="banner-msg">◷ <span>Your profile is ${S.profile.profile_completion||0}% complete. Finish onboarding to improve match quality and visibility.</span></div><a class="btn btn-sm btn-pri" href="/profile-edit.html">Complete Profile →</a></div>`);
    }
    if(S.demo){ v.insertAdjacentHTML('afterbegin',
      `<div class="banner bn-demo">◷ Viewing a demonstration of the ${meta.name} experience. <a href="/signin.html" style="color:inherit;text-decoration:underline">Sign in</a> to access your live workspace.</div>`); }
    return v;
  }

  function mountPublic(active){
    const host=document.createElement('div'); host.innerHTML=publicNav(active);
    // Move ALL top-level nav nodes (nav + overlay + drawer), not just <nav>.
    // Previous code only inserted host.firstElementChild and silently dropped
    // the overlay/drawer, which is why the hamburger appeared to do nothing.
    const frag=document.createDocumentFragment();
    while(host.firstChild){ frag.appendChild(host.firstChild); }
    document.body.insertBefore(frag, document.body.firstChild);

    /* Apply authed nav immediately — Store is already hydrated by boot()
       before mountPublic runs, so session detection is reliable here. */
    pegApplyAuthedNav();
    setTimeout(updateNavForAuth, 0); /* async confirm + cache slug */

    // Wire the mobile drawer. (Was previously written as an inline <script>
    // inside the template literal, which the browser parses but never executes
    // when injected via innerHTML.)
    (function(){
      var btn=document.getElementById('mobMenuBtn');
      var drawer=document.getElementById('mobDrawer');
      var overlay=document.getElementById('mobOverlay');
      var closeBtn=document.getElementById('mobClose');
      function close(){ if(drawer)drawer.classList.remove('open'); if(overlay)overlay.classList.remove('open'); document.body.style.overflow=''; }
      if(btn) btn.addEventListener('click',function(){ if(drawer)drawer.classList.add('open'); if(overlay)overlay.classList.add('open'); document.body.style.overflow='hidden'; });
      if(closeBtn) closeBtn.addEventListener('click',close);
      if(overlay) overlay.addEventListener('click',close);
      // Close drawer when any link inside it is tapped
      if(drawer) drawer.querySelectorAll('a').forEach(function(a){ a.addEventListener('click',close); });
      // Close on Escape
      document.addEventListener('keydown',function(e){ if(e.key==='Escape') close(); });
    })();

    // Touch-device tap-toggle for desktop-nav dropdowns (iPad, etc.).
    (function(){
      function isTouch(){ return ('ontouchstart' in window)||navigator.maxTouchPoints>0; }
      if(!isTouch()) return;
      var navHost=document.querySelector('.pub-nav');
      if(!navHost) return;
      function closeAll(){ navHost.querySelectorAll('.nav-group.open').forEach(function(g){g.classList.remove('open');}); }
      navHost.querySelectorAll('.nav-group>span').forEach(function(trigger){
        trigger.addEventListener('click',function(e){
          e.stopPropagation();
          var grp=trigger.parentElement;
          var wasOpen=grp.classList.contains('open');
          closeAll();
          if(!wasOpen) grp.classList.add('open');
        });
      });
      document.addEventListener('click',function(e){ if(!navHost.contains(e.target)) closeAll(); });
      navHost.querySelectorAll('.nav-drop a').forEach(function(a){ a.addEventListener('click',closeAll); });
    })();
  }

  function footer(){
    const col=(h,links)=>`<div><div style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:12px">${h}</div>${links.map(l=>`<a href="${l[1]}" style="display:block;font-size:12px;color:var(--text2);padding:4px 0">${l[0]}</a>`).join('')}</div>`;
    return `<footer class="footer">
      <div style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr 1fr;gap:30px;margin-bottom:32px">
        <div><div class="brand" style="margin-bottom:12px"><img class="brand-mark" src="/assets/brand/pegasus-symbol.svg" alt="Pegasus"><span>Pegasus Network</span></div><div style="font-size:12px;color:var(--text3);line-height:1.6;max-width:240px">The operating system for structured real estate capital.</div></div>
        ${col('Members',[['Browse Directory','/members.html'],['Growth Partners','/borrowers.html'],['Lenders','/members.html?role=lender'],['Brokers','/mortgage-brokers.html'],['Agents','/real-estate-agents.html']])}
        ${col('Platform',[['Deal Rooms','/deal-rooms.html'],['Match Engine','/match-engine.html'],['Pricing','/membership.html'],['How It Works','/how-it-works.html']])}
        ${col('RWA',[['RWA Network','/rwa-network.html'],['Tokenization','/rwa-tokenization.html'],['RWA Education','/rwa-education.html']])}
        ${col('Company',[['About','/about.html'],['Contact','/contact.html'],['FAQ','/faq.html'],['Trust & Safety','/trust-and-safety.html']])}
      </div>
      <div class="footer-legal">Pegasus Lenders Group LLC operates as a membership marketplace platform. Pegasus is not a mortgage lender, mortgage loan originator (MLO), broker-dealer, real estate broker, or registered investment advisor. All connections made through the Pegasus platform are member-directed. Users must consult licensed professionals for all financial and legal decisions. \u00A9 2026 Pegasus Lenders Group LLC. &nbsp;·&nbsp; <a href="/privacy.html" style="color:var(--text3)">Privacy</a> &nbsp;·&nbsp; <a href="/terms.html" style="color:var(--text3)">Terms</a> &nbsp;·&nbsp; <a href="/disclosures.html" style="color:var(--text3)">Disclosures</a></div></footer>`;
  }
  function modal(html){ el('modalRoot').innerHTML=html; }
  function closeModal(){ const m=el('modalRoot'); if(m) m.innerHTML=''; }

  // notifications dropdown
  function toggleNotif(ev){ if(ev) ev.stopPropagation(); const p=el('notifPanel'); if(!p) return;
    if(p.innerHTML){ p.innerHTML=''; return; }
    const ns=Store.get().notifications||[];
    const ic={lender_interest:'◈',match_found:'◎',deal_room_update:'⟳',doc_requested:'📄',billing:'💳',admin_review:'⛨',ai_recommendation:'🧠',onboarding:'◷'};
    p.innerHTML=`<div style="position:absolute;top:42px;right:0;width:320px;background:var(--bg1);border:1px solid var(--border2);border-radius:var(--r3);box-shadow:var(--sh-lift);z-index:400;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:600">Notifications</span><span class="link" onclick="Pegasus.markNotifs()">Mark all read</span></div>
      <div style="max-height:360px;overflow-y:auto">${ns.length?ns.map(n=>`<a href="${safeUrl(n.link)}" style="display:flex;gap:11px;padding:12px 16px;border-bottom:1px solid var(--border);${n.read?'':'background:var(--bg2)'}"><span style="font-size:14px">${ic[n.kind]||'•'}</span><div><div style="font-size:12px;color:var(--text);font-weight:${n.read?'400':'600'}">${esc(n.title)}</div><div style="font-size:11px;color:var(--text3);line-height:1.4">${esc(n.body||'')}</div></div></a>`).join(''):'<div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">No notifications</div>'}</div></div>`;
    document.addEventListener('click',function close(){ if(el('notifPanel'))el('notifPanel').innerHTML=''; document.removeEventListener('click',close); });
  }
  /* ── Profile slug helper ─────────────────────────────────────────────────── */
  function slugify(str){
    return (str||'').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'member';
  }
  /* Clean, shareable public path for a business/project/etc. presence.
     Maps presence_type → user-facing route segment. The internal resolver
     (presence.html?slug=) still works; users only ever see these clean URLs. */
  function presencePath(type, slug){
    if(!slug) return '/presence.html';
    var map={company:'business',capital_program:'business',fund:'fund',project:'project',showcase:'showcase',event:'event',property:'property'};
    var seg=map[type]||'business';
    return '/'+seg+'/'+encodeURIComponent(slug);
  }
  /* Build the shareable public-profile URL for the current user.
     Prefers profile_slug; falls back to ?id=. */
  var CANONICAL_ORIGIN='https://pegasuscapitalnetwork.com';
  function profileUrl(){
    var st=Store.get(); var p=st.profile||{}; var u=st.user||{};
    /* Shareable public profile links always use the CANONICAL domain so links
     * are consistent and SEO-correct no matter which domain the member is on. */
    if(p.profile_slug) return CANONICAL_ORIGIN+'/u/'+p.profile_slug;
    if(u.id && u.id!=='demo') return CANONICAL_ORIGIN+'/public-profile.html?id='+u.id;
    return CANONICAL_ORIGIN+'/public-profile.html';
  }
  /* Copy the current user's public profile link to clipboard */
  function copyProfileLink(){
    var url=profileUrl();
    function done(){ toast('\u2713','var(--green-dim)','Link copied', url.replace(/^https?:\/\//,'')); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done).catch(function(){ fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
  }
  function fallbackCopy(text){
    try{ var ta=document.createElement('textarea'); ta.value=text;
      ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }catch(e){}
  }
  /* ── Account dropdown menu ───────────────────────────────────────────────── */
  function toggleAccount(ev){
    if(ev) ev.stopPropagation();
    var m=el('acctMenu'); if(!m) return;
    if(m.innerHTML){ m.innerHTML=''; return; }
    var st=Store.get(); var isAdm = (typeof Store.isAdmin==='function') ? Store.isAdmin() : false;
    var rows=[
      ['\u25C9','My Profile','/profile.html'],
      ['\u270E','Edit Profile','/profile-edit.html'],
      ['\u25EB','Business Pages','/my-presences.html'],
      ['\u2795','Create Free Business Page','/my-presences.html'],
      ['\u25A6','My Workspace','/dashboard.html'],
      ['\u25A4','Billing & Plan','/membership.html'],
    ];
    if(isAdm){
      rows.push(['\u26E8','Admin Console','/admin.html']);
      rows.push(['\u25C7','Admin \u00B7 Requests','/admin-requests.html']);
      rows.push(['\u25C8','Admin \u00B7 Trust','/admin-trust-reviews.html']);
    }
    m.innerHTML='<div class="acct-menu">'
      + rows.map(function(r){return '<a class="acct-item" href="'+r[2]+'"><span class="acct-ic">'+r[0]+'</span>'+r[1]+'</a>';}).join('')
      + '<div class="acct-sep"></div>'
      + '<button class="acct-item acct-out" onclick="PegAuth.signOut()"><span class="acct-ic">\u23FB</span>Sign Out</button>'
      + '</div>';
    document.addEventListener('click', function close(){ if(el('acctMenu')) el('acctMenu').innerHTML=''; document.removeEventListener('click',close); });
  }

  async function markNotifs(){ await window.PegAPI.markAllRead(); const p=el('notifPanel'); if(p)p.innerHTML=''; }

  /* Async: check if user is already logged in on public pages.
     If yes → replace nav CTAs and hero button with dashboard links.
     Runs silently after page load — no flash, no layout shift.    */
  /* Synchronously detect login from Supabase's stored session (storageKey: pegasus.auth).
     Far more reliable than getSession() which can race with client init.        */
  function pegHasSession() {
    /* Primary: check the hydrated Store — most reliable since boot() hydrates
       before mountPublic runs. mode==='live' means a real authenticated user. */
    try {
      var st = Store.get();
      if (st && st.mode === 'live' && st.user && st.user.id !== 'demo') return true;
    } catch(e) {}
    /* Fallback: check Supabase's stored session token in localStorage */
    try {
      var raw = localStorage.getItem('pegasus.auth');
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      var tok = parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token));
      return !!tok;
    } catch(e) { return false; }
  }

  function pegStoreSlug() {
    /* Get slug from Store if available, else cached value */
    try {
      var st = Store.get();
      if (st && st.profile && st.profile.profile_slug) return st.profile.profile_slug;
    } catch(e) {}
    try { return localStorage.getItem('peg_slug') || ''; } catch(e) { return ''; }
  }

  function pegApplyAuthedNav() {
    var loggedIn = pegHasSession();
    var ctaEl = document.getElementById('pub-nav-cta');
    var slug = pegStoreSlug();
    if (slug) { try { localStorage.setItem('peg_slug', slug); } catch(_) {} }

    if (!loggedIn) {
      /* Not logged in — show default Sign In / Create Profile */
      if (ctaEl) ctaEl.style.visibility = '';
      return;
    }

    /* Logged in — replace CTA */
    if (ctaEl) {
      var onProfile = window.location.pathname.indexOf('/u/') === 0 ||
                      window.location.pathname.indexOf('/public-profile') >= 0;
      if (onProfile) {
        ctaEl.innerHTML =
          '<button class="btn btn-ghost" onclick="Pegasus.copyProfileLink()" style="font-size:13px">\u29C9 Copy My Address</button>' +
          '<a class="btn btn-ghost" href="/profile-edit.html" style="font-size:13px">\u270E Edit Profile</a>' +
          '<a class="btn btn-pri nav-create" href="/dashboard.html">My Workspace \u2192</a>';
      } else {
        ctaEl.innerHTML =
          (slug ? '<a class="btn btn-ghost" href="/u/'+slug+'" style="font-size:13px">My Profile</a>' : '') +
          '<a class="btn btn-pri nav-create" href="/dashboard.html">My Workspace \u2192</a>';
      }
      ctaEl.style.visibility = '';
    }

    /* Change "Platform" nav link → "My Profile" for logged-in members */
    var platformLink = document.querySelector('.pub-links a[href="/how-it-works.html"]');
    if (platformLink && slug) {
      platformLink.textContent = 'My Profile';
      platformLink.href = '/u/' + slug;
    }

    /* Swap hero "Create My Profile" → "Open My Dashboard" */
    document.querySelectorAll('a[href="/signup.html"].btn-pri, a[href="/signup.html"].hero-cta-pri').forEach(function(btn){
      btn.textContent = 'Open My Workspace \u2192';
      btn.href = '/dashboard.html';
    });
  }

  async function updateNavForAuth() {
    /* Synchronous fast-path using stored session */
    pegApplyAuthedNav();

    /* Async: confirm session + cache the slug for next-page fast-path */
    try {
      var sb = await window.PegSB.ready;
      var { data: { session } } = await sb.auth.getSession();
      if (!session) {
        try { localStorage.removeItem('peg_authed'); localStorage.removeItem('peg_slug'); } catch(_) {}
        var ctaEl2 = document.getElementById('pub-nav-cta');
        if (ctaEl2) ctaEl2.style.visibility = '';
        return;
      }
      localStorage.setItem('peg_authed', '1');
      /* Fetch + cache slug so My Profile links work on next page immediately */
      var pr = await sb.from('profiles').select('profile_slug').eq('id', session.user.id).maybeSingle();
      if (pr.data && pr.data.profile_slug) {
        localStorage.setItem('peg_slug', pr.data.profile_slug);
      }
      /* Re-apply now that we have fresh slug */
      pegApplyAuthedNav();
    } catch(e) { /* silent */ }
  }

    window.Pegasus = {
    boot,
    get session(){ return sessionProxy(); },
    tier:()=>Store.get().tier, meta:T, limit:lim, store:Store,
    fmt, toast, esc, safeUrl, mountApp, mountPublic, publicNav, footer, modal, closeModal,
    toggleNotif, markNotifs, toggleAccount, copyProfileLink, profileUrl, slugify, presencePath,
    setTier(t){ Store.set({tier:t}); },
  };
})();


/* ── High-signal field counters: auto-attach to [data-count][maxlength] ── */
(function(){
  function render(el){
    var max=parseInt(el.getAttribute('maxlength')||'0',10); if(!max) return;
    var c=el.__pc; if(!c) return;
    var len=(el.value||'').length;
    c.textContent=len+' / '+max;
    c.style.color = len>=max ? 'var(--amber)' : (len>max*0.9 ? 'var(--amber)' : 'var(--text4)');
  }
  function attach(el){
    if(el.__pcDone) return; el.__pcDone=1;
    var c=document.createElement('div'); c.className='peg-charcount'; el.__pc=c;
    if(el.parentNode) el.parentNode.appendChild(c);
    el.addEventListener('input',function(){render(el);});
    render(el);
  }
  function scan(root){ try{(root||document).querySelectorAll('[data-count][maxlength]').forEach(attach);}catch(e){} }
  function init(){
    scan(document);
    try{ new MutationObserver(function(muts){
      muts.forEach(function(m){ if(m.addedNodes) m.addedNodes.forEach(function(n){ if(n.nodeType===1){ scan(n); } }); });
    }).observe(document.body,{childList:true,subtree:true}); }catch(e){}
  }
  if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded',init);
})();

/* ── Native spell-check on free-text form fields ─────────────────────────────
   Enables the browser's built-in spell checker on text inputs and textareas
   (red squiggly underlines). Skips fields where spell-check is wrong: email,
   url, password, number, tel, search, and fields opting out via
   data-nospell. Applies on load AND to dynamically-rendered forms. */
(function(){
  'use strict';
  var SKIP_TYPES = {email:1,url:1,password:1,number:1,tel:1,search:1,date:1,time:1,'datetime-local':1,month:1,week:1,color:1,range:1,file:1,hidden:1,checkbox:1,radio:1};
  function applyOne(el){
    if(el.__spDone) return; el.__spDone=1;
    var tag=el.tagName;
    if(tag==='TEXTAREA'){ el.setAttribute('spellcheck','true'); return; }
    if(tag==='INPUT'){
      var t=(el.getAttribute('type')||'text').toLowerCase();
      if(SKIP_TYPES[t]) { el.setAttribute('spellcheck','false'); return; }
      if(el.hasAttribute('data-nospell')) { el.setAttribute('spellcheck','false'); return; }
      el.setAttribute('spellcheck','true');
    }
  }
  function scanSP(root){ try{(root||document).querySelectorAll('input,textarea').forEach(applyOne);}catch(e){} }
  function initSP(){
    scanSP(document);
    try{ new MutationObserver(function(muts){
      muts.forEach(function(m){ if(m.addedNodes) m.addedNodes.forEach(function(n){ if(n.nodeType===1){ if(n.matches&&(n.matches('input,textarea'))) applyOne(n); scanSP(n); } }); });
    }).observe(document.body,{childList:true,subtree:true}); }catch(e){}
  }
  if(document.readyState!=='loading') initSP(); else document.addEventListener('DOMContentLoaded',initSP);
})();

/* ── A11y: make onclick-only elements keyboard-operable ──────────────────────
   The app builds many interactive <div>/<span> via innerHTML with onclick but
   no role/tabindex/keyboard support (WCAG 2.1.1 / 4.1.2). This makes every such
   element focusable, announces it as a button, and activates it on Enter/Space —
   without changing markup or visuals. Applies on load and to dynamic DOM. */
(function(){
  'use strict';
  var NATIVE={A:1,BUTTON:1,INPUT:1,SELECT:1,TEXTAREA:1,SUMMARY:1,LABEL:1};
  function enhance(el){
    try{
      if(el.__a11yBtn) return; el.__a11yBtn=1;
      if(NATIVE[el.tagName]) return;
      if(!el.hasAttribute('onclick')) return;
      if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
      if(!el.hasAttribute('role')) el.setAttribute('role','button');
    }catch(e){}
  }
  function scan(root){ try{(root||document).querySelectorAll('[onclick]').forEach(enhance);}catch(e){} }
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter' && e.key!==' ' && e.key!=='Spacebar') return;
    var t=e.target;
    if(!t || NATIVE[t.tagName] || !t.getAttribute) return;
    if(t.getAttribute('role')==='button' && t.hasAttribute('onclick')){
      e.preventDefault();
      if(typeof t.click==='function') t.click();
    }
  });
  function initA(){
    scan(document);
    try{ new MutationObserver(function(muts){
      muts.forEach(function(m){ if(m.addedNodes) m.addedNodes.forEach(function(n){ if(n.nodeType===1){ if(n.matches&&n.matches('[onclick]')) enhance(n); scan(n); } }); });
    }).observe(document.body,{childList:true,subtree:true}); }catch(e){}
  }
  if(document.readyState!=='loading') initA(); else document.addEventListener('DOMContentLoaded',initA);
})();
