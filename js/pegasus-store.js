/* ============================================================================
   PEGASUS v69 — Global App State (single source of truth).
   Pages subscribe; they never hold their own copies of session/tier/etc.
   hydrate() pulls from Supabase when authenticated, else seeded demo data.
   ============================================================================ */
(function(){
  const subs = new Set();
  const state = {
    ready:false, mode:'demo',                 // 'live' | 'demo'
    session:null, user:null,
    profile:null,                              // {id,full_name,role,verification_status,profile_completion,onboarding_complete,...}
    tier:'gold', subscription:null,            // subscription row
    entitlements:null,                         // resolved limits
    usage:{ aiUsed:0, rooms:0 },
    dealRooms:[], matches:[], notifications:[], threads:[],
    counts:{ unreadNotifications:0, unreadMessages:0 },
  };
  function get(){ return state; }
  function set(patch){ Object.assign(state, patch); emit(); }
  function emit(){ subs.forEach(fn=>{ try{fn(state);}catch(e){console.error(e);} }); }
  function subscribe(fn){ subs.add(fn); if(state.ready) fn(state); return ()=>subs.delete(fn); }

  // selectors
  const tier = ()=> state.tier;
  const meta = ()=> (window.PEG_TIERS||{})[state.tier] || {};
  const limit = (k)=> (meta().limits||{})[k];
  const can = (k)=>{ const l=limit(k); return l===Infinity || l===-1 || (typeof l==='number'? state.usage[k]<l : !!l); };
  const isAdmin = ()=> state.isAdmin === true || !!(state.profile && (state.profile.is_admin===true || state.profile.role==='admin'));
  const needsOnboarding = ()=> state.profile && !state.profile.onboarding_complete;

  async function hydrate(){
    let sb=null; try{ sb = await window.PegSB.ready; }catch(e){}
    let session = sb ? (await sb.auth.getSession()).data.session : null;

    /* CHECKOUT-RETURN GUARD: when returning from Stripe (?upgrade=success or
     * a session_id is present), the Supabase session may not be restored from
     * storage on the very first tick. Falling into demo here shows a FAKE Gold
     * experience (preview@pegasus.network) that reads tier from the URL —
     * deeply misleading. So if this is a checkout return, retry getSession a
     * few times before ever considering demo mode. */
    const _qp = new URLSearchParams(location.search);
    const _isCheckoutReturn = _qp.has('session_id') || _qp.get('upgrade') === 'success';

    /* GENERAL SESSION-RESTORE GUARD: if a Supabase session token exists in
     * localStorage (storageKey 'pegasus.auth') but getSession() returned null,
     * the client simply hasn't finished restoring it yet. Retry briefly before
     * falling back to demo — otherwise authenticated users get demo mode, which
     * breaks profile ownership, nav state, and personalization. */
    let _hasStoredToken = false;
    try {
      var _raw = localStorage.getItem('pegasus.auth');
      if (_raw) { var _pj = JSON.parse(_raw); _hasStoredToken = !!(_pj && _pj.access_token); }
    } catch(_) {}

    if (!session && sb && (_isCheckoutReturn || _hasStoredToken)) {
      var _maxTries = _isCheckoutReturn ? 8 : 5;
      for (let i = 0; i < _maxTries && !session; i++) {
        await new Promise(r => setTimeout(r, _isCheckoutReturn ? 400 : 200));
        session = (await sb.auth.getSession()).data.session;
      }
      if (!session) console.warn('[hydrate] stored token present but no session after retries');
    }

    if(session && sb){
      try{ await hydrateLive(sb, session); set({ready:true}); return state; }
      catch(e){ console.warn('Live hydrate failed, using demo:', e.message); }
    }
    hydrateDemo(); set({ready:true}); return state;
  }

  async function hydrateLive(sb, session){
    state.mode='live'; state.session=session; state.user=session.user;
    const uid = session.user.id;
    const PLAN2TIER={professional:'pro',pro:'pro',starter:'starter',gold:'gold'};
    const safe=(p)=>p.then(r=>r).catch(()=>({data:null}));
    const [{data:prof},{data:mem},{data:sub},{data:rooms},{data:notifs}] = await Promise.all([
      safe(sb.from('profiles').select('*').eq('id',uid).single()),
      safe(sb.from('memberships').select('*').eq('user_id',uid).maybeSingle()),   // v68 real table
      safe(sb.from('subscriptions').select('*').eq('user_id',uid).maybeSingle()), // v69 table (if used)
      safe(sb.from('deal_rooms').select('*').order('updated_at',{ascending:false})),
      safe(sb.from('notifications').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(30)),
    ]);
    state.profile = prof || { id:uid, role:null, profile_completion:20, onboarding_complete:false };

    /* ── ADMIN RESOLUTION — single source of truth ───────────────────────
     * The profiles query above uses .single() inside safe() and can fail
     * silently (0 rows / RLS / network). When it does, role is lost and the
     * admin link vanishes. Do a dedicated maybeSingle() role lookup so admin
     * state is resolved reliably BEFORE the sidebar renders. */
    let _adminRole = (state.profile && state.profile.role) || null;
    let _adminFlag = !!(state.profile && state.profile.is_admin);
    let _adminErr = null;
    /* Always do a dedicated lookup of BOTH is_admin and role — the main
     * profiles query can fail silently, and is_admin is the source of truth
     * (decoupled from professional role which profile editing overwrites). */
    try {
      const _r = await sb.from('profiles').select('role, is_admin').eq('id', uid).maybeSingle();
      if (_r.error) _adminErr = _r.error.message;
      else if (_r.data) {
        _adminRole = _r.data.role;
        _adminFlag = !!_r.data.is_admin;
      }
    } catch (e) { _adminErr = e && e.message; }
    /* Admin = explicit is_admin flag OR legacy role==='admin' */
    state.isAdmin = (_adminFlag === true) || (_adminRole === 'admin');
    if (state.profile) {
      state.profile.role = _adminRole;       /* keep professional role intact */
      state.profile.is_admin = _adminFlag;   /* store admin flag separately */
    }
    window.__PEG_ADMIN_DEBUG = {
      uid: uid,
      email: (session.user && session.user.email) || null,
      role: _adminRole,
      is_admin_flag: _adminFlag,
      isAdmin: state.isAdmin,
      error: _adminErr,
      source: 'hydrateLive'
    };
    try { console.debug('[Admin] resolved:', window.__PEG_ADMIN_DEBUG); } catch(_){}
    // prefer real memberships row; map legacy 'professional' -> 'pro'
    // BILLING FIX: prefer subscriptions (webhook-updated) when it has active/trialing status
    // This prevents a stale memberships row from hiding a webhook-written upgrade
    const activeStatuses = ['active', 'trialing'];
    let m;
    if (sub && activeStatuses.includes(sub.status)) {
      m = sub; // subscriptions is active — use it (source of truth from webhook)
    } else if (mem && activeStatuses.includes(mem.status)) {
      m = mem; // only memberships is active
    } else {
      m = sub || mem; // neither active — use whatever we have (canceled / incomplete)
    }
    state.subscription = m ? { ...m, tier: PLAN2TIER[m.plan||m.tier]||'starter', status:m.status||'active', billing_cycle:m.billing_cycle||m.billing||'monthly' }
                          : { tier:'starter', status:'none', billing_cycle:'monthly' };
    state.tier = state.subscription.tier || 'starter';
    state.dealRooms = rooms || [];
    state.notifications = notifs || [];
    state.counts.unreadNotifications = (notifs||[]).filter(n=>!n.read).length;
    state.usage.rooms = (rooms||[]).filter(r=>r.status==='active').length;
  }

  function hydrateDemo(){
    state.mode='demo';
    const qp=new URLSearchParams(location.search);
    /* SECURITY/UX: do NOT let a real checkout-success URL fake a paid tier in
     * demo mode. Only honor ?tier= for genuine marketing previews (no session_id
     * and not an upgrade=success redirect). */
    const _checkoutReturn = qp.has('session_id') || qp.get('upgrade') === 'success';
    state.tier = (!_checkoutReturn && qp.get('tier')) ? qp.get('tier') : 'gold';
    if (_checkoutReturn) state.tier = 'starter'; /* never imply paid on a failed real upgrade */
    const status = qp.get('status') || 'active';
    state.user = { id:'demo', email:'preview@pegasus.network' };
    state.profile = { id:'demo', full_name:'Member', email:'preview@pegasus.network', role:'developer',
      headline:'Platform Preview', verification_status:'verified',
      profile_completion:85, onboarding_complete:true, initials:'PX' };
    state.subscription = { tier:state.tier, status, billing_cycle:'monthly',
      current_period_end:new Date(Date.now()+22*864e5).toISOString(),
      trial_end:new Date(Date.now()+5*864e5).toISOString(), cancel_at_period_end:false, stripe_customer_id:'cus_demo' };
    const D = window.PEG_DATA||{dealRooms:[],activity:[]};
    state.dealRooms = (D.dealRooms||[]).map(d=>({ ...d, workflow_state:['draft','submitted','reviewing','matched','docs_requested','underwriting','term_sheet','funded','closed'][d.stage]||'submitted' }));
    state.usage = { aiUsed: state.tier==='starter'?17:47, rooms: state.dealRooms.filter(r=>r.status!=='archived').length };
    state.notifications = [
      {id:'n1',kind:'lender_interest',title:'Network update',body:'A capital partner expressed interest in your workspace',link:'/deal-room.html?id=dr_1',read:false,created_at:new Date(Date.now()-12*6e4).toISOString()},
      {id:'n2',kind:'match_found',title:'Match Engine update',body:'Your capital request has a new alignment result',link:'/match-engine.html',read:false,created_at:new Date(Date.now()-36e5).toISOString()},
      {id:'n3',kind:'deal_room_update',title:'Workspace update',body:'Now in reviewing',link:'/deal-room.html?id=dr_2',read:true,created_at:new Date(Date.now()-72e5).toISOString()},
      {id:'n4',kind:'onboarding',title:'Verify one more credential',body:'Reach 100% profile completion',link:'/profile-edit.html',read:true,created_at:new Date(Date.now()-864e5).toISOString()},
    ];
    state.counts.unreadNotifications = state.notifications.filter(n=>!n.read).length;
    state.counts.unreadMessages = 1;
  }

  // synchronous initial seed so synchronous callers work before async hydrate()
  try{ hydrateDemo(); }catch(e){}
  window.PegStore = { get, set, subscribe, hydrate, tier, meta, limit, can, isAdmin, needsOnboarding, emit };
})();
