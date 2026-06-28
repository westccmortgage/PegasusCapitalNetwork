/* ============================================================================
   PEGASUS v69 — Data Access Layer. Every Supabase read/write goes through here
   (no duplicated queries in pages). Falls back to in-memory demo when offline.
   ============================================================================ */
(function(){
  const S = window.PegStore;
  async function sb(){ try{ return await window.PegSB.ready; }catch(e){ return null; } }
  const live = ()=> S.get().mode==='live';
  const WF = ['draft','submitted','reviewing','matched','docs_requested','underwriting','term_sheet','funded','closed'];

  // ---- Profiles ----
  async function updateProfile(patch){
    const c=await sb();
    if(live()&&c){
      const usr=S.get().user;
      if(!usr||!usr.id) throw new Error('Not authenticated — please sign in again');
      const uid=usr.id;

      /* ---- Build the upsert payload using ONLY columns that exist in the DB ----
         Profiles table columns (from 002_platform_schema.sql):
           id, email, full_name, role, company_name, created_at, updated_at,
           headline, bio, markets (text[]), specialties (text[]), location,
           website, avatar_color, verification_status, onboarding_complete,
           profile_completion (int)
         Primary key: id  |  RLS: id = auth.uid()
         Note: id MUST match auth.uid() or RLS INSERT/UPDATE policy will reject it. */
      const payload = {
        id:                 uid,                          // PK = auth.uid() — required by RLS
        full_name:          patch.full_name          || null,
        role:               patch.role               || null,
        headline:           patch.headline           || null,
        bio:                patch.bio                || null,
        markets:            Array.isArray(patch.markets)     ? patch.markets     : [],
        specialties:        Array.isArray(patch.specialties) ? patch.specialties : [],
        profile_completion: typeof patch.profile_completion === 'number'
                              ? patch.profile_completion : 20,
        updated_at:         new Date().toISOString(),
      };
      // optional columns — include only if provided
      if(patch.company_name  !== undefined) payload.company_name  = patch.company_name;
      if(patch.location      !== undefined) payload.location      = patch.location;
      if(patch.website       !== undefined) payload.website       = patch.website;
      if(patch.avatar_color  !== undefined) payload.avatar_color  = patch.avatar_color;
      if(patch.avatar_url    !== undefined) payload.avatar_url    = patch.avatar_url;
      if(patch.banner_url    !== undefined) payload.banner_url    = patch.banner_url;
      if(patch.professional_title !== undefined) payload.professional_title = patch.professional_title;
      if(patch.current_focus !== undefined) payload.current_focus = patch.current_focus;
      if(patch.ecosystem_role         !== undefined) payload.ecosystem_role         = patch.ecosystem_role;
      if(patch.ecosystem_contribution !== undefined) payload.ecosystem_contribution = patch.ecosystem_contribution;
      if(patch.ecosystem_goals        !== undefined) payload.ecosystem_goals        = patch.ecosystem_goals;
      if(patch.expertise_areas        !== undefined) payload.expertise_areas        = Array.isArray(patch.expertise_areas)?patch.expertise_areas:[];
      if(patch.featured_modules !== undefined) payload.featured_modules = patch.featured_modules;
      if(patch.company_name !== undefined && !payload.company_name) payload.company_name = patch.company_name;

      /* [QA] console.log removed */

      /* Step 1: upsert */
      const {data:upserted, error:upsertErr} = await c
        .from('profiles')
        .upsert(payload, {onConflict:'id'})
        .select()
        .single();

      if(upsertErr){
        console.error('[PegAPI] upsert error:', upsertErr);
        throw upsertErr;  // raw Supabase error — caller shows it verbatim
      }
      /* [QA] console.log removed */

      /* Step 2: re-fetch to confirm persistence (source of truth) */
      const {data:confirmed, error:refetchErr} = await c
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();

      if(refetchErr){
        console.warn('[PegAPI] re-fetch after save failed — using upsert result:', refetchErr);
        S.set({profile: upserted});
        return upserted;
      }
      /* [QA] console.log removed */
      S.set({profile: confirmed});
      return confirmed;
    }

    // demo/preview mode: in-memory only, never reaches Supabase
    S.set({ profile:{...S.get().profile, ...patch} });
    return S.get().profile;
  }

  // ---- Admin: update ANY member's profile by id ----
  // Identical column whitelist to updateProfile, but the PK is the TARGET id
  // (not auth.uid()). The write is gated server-side by RLS policy prof_admin_u
  // (migration 039) which only passes for admins. Does NOT touch S (global
  // state) — the admin's own session profile must stay intact.
  async function updateProfileForId(targetId, patch){
    if(!targetId) throw new Error('Missing target profile id');
    const c=await sb();
    if(!(live()&&c)) throw new Error('Admin profile edit requires a live connection');

    const payload={
      id:                 targetId,
      full_name:          patch.full_name          || null,
      role:               patch.role               || null,
      headline:           patch.headline           || null,
      bio:                patch.bio                || null,
      markets:            Array.isArray(patch.markets)     ? patch.markets     : [],
      specialties:        Array.isArray(patch.specialties) ? patch.specialties : [],
      profile_completion: typeof patch.profile_completion === 'number'
                            ? patch.profile_completion : 20,
      updated_at:         new Date().toISOString(),
    };
    if(patch.company_name  !== undefined) payload.company_name  = patch.company_name;
    if(patch.location      !== undefined) payload.location      = patch.location;
    if(patch.website       !== undefined) payload.website       = patch.website;
    if(patch.avatar_color  !== undefined) payload.avatar_color  = patch.avatar_color;
    if(patch.avatar_url    !== undefined) payload.avatar_url    = patch.avatar_url;
    if(patch.banner_url    !== undefined) payload.banner_url    = patch.banner_url;
    if(patch.professional_title !== undefined) payload.professional_title = patch.professional_title;
    if(patch.current_focus !== undefined) payload.current_focus = patch.current_focus;
    if(patch.ecosystem_role         !== undefined) payload.ecosystem_role         = patch.ecosystem_role;
    if(patch.ecosystem_contribution !== undefined) payload.ecosystem_contribution = patch.ecosystem_contribution;
    if(patch.ecosystem_goals        !== undefined) payload.ecosystem_goals        = patch.ecosystem_goals;
    if(patch.expertise_areas        !== undefined) payload.expertise_areas        = Array.isArray(patch.expertise_areas)?patch.expertise_areas:[];
    if(patch.featured_modules !== undefined) payload.featured_modules = patch.featured_modules;

    // Use UPDATE (not upsert) — the target row already exists, and upsert's
    // INSERT branch would be checked against prof_self_i (id = auth.uid()),
    // which fails for a target id ≠ the admin's uid. A plain UPDATE only hits
    // prof_admin_u. The id is the WHERE filter, not part of the SET payload.
    var targetIdForWhere = payload.id;
    delete payload.id;
    const {data:updated, error:updErr}=await c
      .from('profiles')
      .update(payload)
      .eq('id', targetIdForWhere)
      .select().single();
    if(updErr){ console.error('[PegAPI] admin update error:', updErr); throw updErr; }

    const {data:confirmed, error:refetchErr}=await c
      .from('profiles').select('*').eq('id', targetIdForWhere).single();
    return refetchErr ? updated : confirmed;
  }

  // ---- Deal Rooms ----
  async function listDealRooms(){ return S.get().dealRooms; }
  async function getDealRoom(id){ return S.get().dealRooms.find(d=>d.id===id) || S.get().dealRooms[0]; }
  async function createDealRoom(d){
    const c=await sb();
    if(live()&&c){ const uid=S.get().user.id;
      const {data,error}=await c.from('deal_rooms').insert({owner_id:uid,name:d.name,deal_type:d.deal_type,amount:d.amount,ltv:d.ltv,location:d.location,workflow_state:'draft'}).select().single();
      if(error) throw error; S.set({dealRooms:[data,...S.get().dealRooms]}); return data; }
    const room={id:'dr_'+Date.now(),workflow_state:'draft',stage:0,alignment:0,status:'active',lenders:[],participants:[],documents:[],activity:[],...d};
    S.set({dealRooms:[room,...S.get().dealRooms]}); return room;
  }
  async function advanceDealRoom(id){
    const room=await getDealRoom(id); const i=Math.min(WF.length-1,(WF.indexOf(room.workflow_state)+1)); const next=WF[i];
    const c=await sb();
    if(live()&&c){ const {data,error}=await c.from('deal_rooms').update({workflow_state:next}).eq('id',id).select().single();
      if(error) throw error; S.set({dealRooms:S.get().dealRooms.map(d=>d.id===id?data:d)}); return data; }
    room.workflow_state=next; room.stage=i; S.set({dealRooms:[...S.get().dealRooms]}); return room;
  }
  async function setDealRoomState(id,state){
    const c=await sb();
    if(live()&&c){ const {data,error}=await c.from('deal_rooms').update({workflow_state:state}).eq('id',id).select().single();
      if(error) throw error; S.set({dealRooms:S.get().dealRooms.map(d=>d.id===id?data:d)}); return data; }
    const room=await getDealRoom(id); room.workflow_state=state; room.stage=WF.indexOf(state); S.set({dealRooms:[...S.get().dealRooms]}); return room;
  }

  // ---- Lender interest / financing requests / matches ----
  async function expressInterest(roomId, payload){
    const c=await sb();
    if(live()&&c){ const {error}=await c.from('lender_interest').insert({deal_room_id:roomId,...payload}); if(error) throw error; return true; }
    return true;
  }
  async function submitFinancingRequest(req){
    const c=await sb();
    if(live()&&c){ const uid=S.get().user.id;
      const {data,error}=await c.from('financing_requests').insert({user_id:uid,...req}).select().single();
      if(error) throw error;
      const {data:n}=await c.rpc('run_match',{p_request:data.id});   // server scores + notifies
      return {request:data, scored:n};
    }
    // demo: score locally against showcase appetites
    const res=(window.PegasusMatch.APPETITES).map(ap=>({ap,r:window.PegasusMatch.scoreMatch(demoDeal(req),ap)}))
      .sort((a,b)=>b.r.alignment-a.r.alignment);
    S.set({matches:res}); return {request:req, scored:res.length, results:res};
  }
  function demoDeal(req){ return {loanType:req.loan_type,amount:+req.amount,state:req.state,assetType:req.asset_type,ltv:+req.ltv,dscr:+req.dscr,constructionStage:req.construction_stage,sponsorYears:+req.sponsor_years,exit:req.exit_strategy,docsReady:+req.docs_ready}; }
  async function listAppetites(){
    const c=await sb();
    if(live()&&c){ const {data}=await c.from('lender_appetite_profiles').select('*').eq('active',true); 
      return (data||[]).map(mapAppetite); }
    return window.PegasusMatch.APPETITES;
  }
  function mapAppetite(a){ return {name:a.name,loanTypes:a.loan_types,states:a.states,min:+a.min_loan,max:+a.max_loan,maxLTV:a.max_ltv,assetTypes:a.asset_types,dscrMin:+a.dscr_min,constructionOK:a.construction_ok,bridgeOK:a.bridge_ok,prefSponsorYears:a.pref_sponsor_years,rate:a.rate_from}; }

  // ---- Notifications ----
  async function listNotifications(){ return S.get().notifications; }
  async function markAllRead(){
    const c=await sb();
    if(live()&&c){ const uid=S.get().user.id; await c.from('notifications').update({read:true}).eq('user_id',uid).eq('read',false); }
    const ns=S.get().notifications.map(n=>({...n,read:true}));
    S.set({notifications:ns, counts:{...S.get().counts,unreadNotifications:0}});
  }

  window.PegAPI = { WF, updateProfile, updateProfileForId, listDealRooms, getDealRoom, createDealRoom, advanceDealRoom,
    setDealRoomState, expressInterest, submitFinancingRequest, listAppetites, mapAppetite,
    listNotifications, markAllRead };
})();
