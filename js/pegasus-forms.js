/* ============================================================================
   PEGASUS v69 — Forms & legacy data layer (ported from v68 pegasus-client.js).
   Reuses the EXACT working tables/columns from the old production site so the
   rebuilt pages submit/read real data when live; demo fallback otherwise.
   ============================================================================ */
(function(){
  const S = window.PegStore;
  async function sb(){ try{ return await window.PegSB.ready; }catch(e){ return null; } }
  const live = ()=> S.get().mode==='live';
  const uid  = ()=> { const u=S.get().user; return u && u.id!=='demo' ? u.id : null; };
  const now  = ()=> new Date().toISOString();
  const ok   = (extra)=> ({ demo:!live(), ...(extra||{}) });

  // ---- intake forms (exact v68 table + column names) ----
  async function submitContact(f){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('contact_submissions').insert({
      name:f.name, email:f.email, subject:f.subject||'General Inquiry', message:f.message, role:f.role||null,
      status:'new', created_at:now() }); if(error) throw error; }
    return ok();
  }
  async function submitRwaProjectIntake(f){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('rwa_project_intakes').insert({
      name:f.name, email:f.email, company:f.company||null, phone:f.phone||null, role:f.role||null,
      property_location:f.location||null, property_type:f.propertyType||null, tokenization_goal:f.goal||null,
      project_description:f.description||null, status:'pending', created_at:now() }); if(error) throw error; }
    return ok();
  }
  async function submitInvestorInterest(f){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('investor_interest_submissions').insert({
      name:f.name, email:f.email, phone:f.phone||null, interest_area:f.interestArea, role:f.role||null,
      notes:f.notes||null, submission_type:'educational_interest_only', created_at:now() }); if(error) throw error; }
    return ok();
  }
  async function submitBadgeProof(f){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('badge_proof_submissions').insert({
      user_id:uid(), name:f.name, email:f.email, company:f.company||null, badge_type:f.badgeType,
      placement_type:f.placementType, placement_url:f.placementUrl, date_posted:f.datePlaced||null,
      disclosure_visible:f.disclosureVisible==='yes', notes:f.notes||null, status:'pending', created_at:now() }); if(error) throw error; }
    return ok();
  }
  async function submitCapitalScenario(f){
    const c=await sb(); if(live()&&c){ const {data,error}=await c.from('capital_scenarios').insert({
      user_id:uid(), name:f.name, email:f.email, phone:f.phone||null,
      available_capital:parseFloat(f.availableCapital)||null, monthly_contribution:parseFloat(f.monthlyContribution)||null,
      time_horizon:f.timeHorizon, risk_tolerance:f.riskTolerance, liquidity_preference:f.liquidityPreference,
      credit_profile:f.creditProfile, interest_areas:f.interestAreas||[], scenario_summary:f.scenarySummary||null,
      created_at:now() }).select().maybeSingle(); if(error) throw error; return ok({id:data&&data.id}); }
    return ok();
  }
  async function submitWebinarRegistration(f){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('webinar_registrations').insert({
      user_id:uid(), name:f.name, email:f.email, phone:f.phone||null, session_topic:f.sessionTopic,
      experience_level:f.experienceLevel, interest_area:f.interestArea, notes:f.notes||null, created_at:now() }); if(error) throw error; }
    return ok();
  }
  async function getPublishedWebinars(opts={}){
    const c=await sb(); if(live()&&c){ try{ let q=c.from('webinar_library').select('*').eq('status','published').order('webinar_date',{ascending:false});
      if(opts.topic)q=q.eq('topic',opts.topic); if(opts.level)q=q.eq('level',opts.level); if(opts.limit)q=q.limit(opts.limit);
      const {data}=await q; return data||[]; }catch(e){ return []; } }
    return [];
  }
  async function submitBusinessFundingRequest(d){
    const c=await sb(); if(live()&&c){ const {data,error}=await c.from('business_funding_requests').insert({
      submitter_id:uid(), business_name:d.businessName, contact_name:d.contactName, email:d.email, phone:d.phone||null,
      industry:d.industry, business_state:d.businessState, time_in_business:d.timeInBusiness,
      monthly_revenue:parseFloat(d.monthlyRevenue)||null, requested_funding_amount:parseFloat(d.requestedAmount)||null,
      intended_use_of_funds:d.intendedUse, urgency:d.urgency, notes:d.notes||null, status:'new', created_at:now() }).select().maybeSingle();
      if(error) throw error; return ok({id:data&&data.id}); }
    return ok();
  }
  async function getBusinessFundingProviders(opts={}){
    const c=await sb(); if(live()&&c){ try{ let q=c.from('business_funding_provider_profiles').select('*').eq('is_public',true);
      if(opts.fundingType)q=q.contains('funding_types',[opts.fundingType]); if(opts.state)q=q.contains('states_served',[opts.state]); if(opts.limit)q=q.limit(opts.limit);
      const {data}=await q; return data||[]; }catch(e){ return []; } }
    return [];
  }
  async function getLenderProfiles(opts={}){
    const c=await sb(); if(live()&&c){ try{ const {data}=await c.from('lender_profiles').select('*, profiles(full_name, email)').eq('is_public',true).limit(opts.limit||50); return data||[]; }catch(e){ return []; } }
    return [];
  }
  // borrower deal (v68 deal_submissions) — distinct from v69 deal_rooms
  async function submitDeal(d){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('deal_submissions').insert({
      submitter_id:uid(), deal_type:d.dealType, loan_amount:parseFloat(d.amount)||null, property_state:d.state,
      property_type:d.assetType, ltv:d.ltv||null, notes:d.notes||null, status:'new', created_at:now() }); if(error) throw error; }
    return ok();
  }

  // ---- messaging (v68 messages table) ----
  async function getMyMessages(){
    const c=await sb(); if(live()&&c){ const u=uid(); if(!u) return [];
      /* Flat schema: messages where I'm sender or receiver. RLS (msg_sel_flat)
         also restricts to these rows. */
      const {data}=await c.from('messages').select('*').or('sender_id.eq.'+u+',receiver_id.eq.'+u).order('created_at',{ascending:false}); return data||[]; }
    return null; // null => caller uses demo seed
  }
  async function sendMessage(m){
    const c=await sb(); if(live()&&c){
      /* Route through connect_member RPC (SECURITY DEFINER): inserts one direct
         message (flat schema) and notifies the recipient. */
      const {error}=await c.rpc('connect_member',{p_recipient:m.recipientId,p_message:m.body||null});
      if(error) throw error; }
    return ok();
  }
  async function getUnreadCount(){
    const c=await sb(); if(live()&&c){ const u=uid(); if(!u) return 0;
      /* Flat schema: count messages addressed to me that are unread. */
      try{
        const {count}=await c.from('messages').select('*',{count:'exact',head:true}).eq('receiver_id',u).eq('is_read',false);
        return count||0;
      }catch(e){ return 0; }
    }
    return S.get().counts.unreadMessages||0;
  }

  // ---- Growth Capital: founder intake (founder_submissions) ----
  async function submitFounder(d){
    const c=await sb(); if(live()&&c){ const {error}=await c.from('founder_submissions').insert({
      user_id:uid(), company_name:d.company, founder_name:d.founder, email:d.email, sector:d.sector,
      stage:d.stage, location:d.location||null, capital_sought:parseFloat(d.raise)||null,
      use_of_funds:d.useOfFunds||null, traction:d.traction||null, status:'submitted', created_at:now() }); if(error) throw error; }
    return ok();
  }
  // ---- Capital Sessions: reserve seat (session_registrations, falls back to webinar_registrations) ----
  async function reserveSession(d){
    const c=await sb(); if(live()&&c){ try{ const {error}=await c.from('session_registrations').insert({
      session_id:d.sessionId||null, user_id:uid(), name:d.name||null, email:d.email||null, status:'reserved', created_at:now() }); if(error) throw error;
    }catch(e){ await c.from('webinar_registrations').insert({ user_id:uid(), name:d.name||null, email:d.email||null, session_topic:d.title||null, created_at:now() }); } }
    return ok();
  }

  // ---- AI assistant (v68 edge function: pegasus-ai-assistant, OpenAI) ----
  async function aiQuery(message, context){
    const c=await sb();
    if(live()&&c){
      try{ const { data, error } = await c.functions.invoke('pegasus-ai-assistant',{ body:{ message, page:(context||{}).page||location.pathname } });
        if(error) throw error; return { reply:(data&&(data.reply||data.message))||'', live:true }; }
      catch(e){ return { reply:'AI is temporarily unavailable. Please try again shortly.', live:false, error:e.message }; }
    }
    // demo fallback — deterministic helpful canned routing
    const t=(message||'').toLowerCase();
    let r="I can help you navigate Pegasus — try asking about Deal Rooms, the Match Engine, membership tiers, RWA tokenization, or how to submit a financing request.";
    if(t.includes('lender')||t.includes('match')) r="Use the Pegasus Match Engine to score your deal against live lender appetite. From the dashboard, open Match Engine, enter your loan profile, and run Capital Alignment.";
    else if(t.includes('member')||t.includes('price')||t.includes('plan')) r="Pegasus has three access layers — Starter ($20), Pro ($50), and Gold ($100/mo), each with a 30-day trial. See the Membership page to compare.";
    else if(t.includes('deal room')||t.includes('submit')) r="Open a Deal Room from the dashboard to coordinate a structured financing — documents, workflow, lender interest, and alignment scoring in one workspace.";
    else if(t.includes('rwa')||t.includes('token')) r="The RWA Network connects you with tokenization, legal, and liquidity partners. Submit an RWA Project Intake to begin a readiness review.";
    return { reply:r, live:false };
  }

  window.PegForms = { submitFounder, reserveSession, submitContact, submitRwaProjectIntake, submitInvestorInterest, submitBadgeProof,
    submitCapitalScenario, submitWebinarRegistration, getPublishedWebinars, submitBusinessFundingRequest,
    getBusinessFundingProviders, getLenderProfiles, submitDeal, getMyMessages, sendMessage, getUnreadCount, aiQuery };
})();
