/* PEGASUS v69 — Billing UI (membership card, usage, states, plans) */
(function(){
  const P=window.Pegasus, TIERS=window.PEG_TIERS, FEATS=window.PEG_FEATS;
  const fmtDate=iso=>iso?new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
  const days=iso=>iso?Math.max(0,Math.ceil((new Date(iso)-new Date())/864e5)):0;

  function stateBanner(){
    const s=P.session.subscription;
    if(s.status==='past_due') return `<div class="banner bn-past"><div class="banner-msg">⚠ <span><b>Payment failed.</b> Update your payment method to keep your access active.</span></div><button class="btn btn-sm btn-pri" onclick="PegBilling.portal()">Update Payment →</button></div>`;
    if(s.status==='trialing'){const d=days(s.trial_end);const chargeDate=s.trial_end?fmtDate(s.trial_end):'your trial end date';return `<div class="banner bn-trial"><div class="banner-msg">🎁 <span><b>Trial active${d?` — ${d} day${d===1?'':'s'} left`:''}.</b> First charge on ${chargeDate}.</span></div><button class="btn btn-sm btn-ghost" onclick="PegBilling.portal()">Manage →</button></div>`;}
    if(s.status==='canceled') return `<div class="banner bn-cancel"><div class="banner-msg">◷ <span><b>Plan canceled.</b> Access continues until ${fmtDate(s.current_period_end)}.</span></div><button class="btn btn-sm btn-pri" onclick="PegBilling.portal()">Reactivate →</button></div>`;
    return '';
  }
  function membershipCard(){
    const s=P.session.subscription, t=P.session.tier, m=TIERS[t];
    const sb={active:'b-active',trialing:'b-trial',past_due:'b-past',canceled:'b-cancel'}[s.status]||'b-none';
    const renewLbl=s.status==='trialing'?'First charge':(s.cancel_at_period_end?'Access ends':'Next renewal');
    const renewDate=s.status==='trialing'?(s.trial_end?fmtDate(s.trial_end):'Not set'):fmtDate(s.current_period_end);
    return `<div class="card"><div class="card-head"><div class="card-title">⬢ Membership</div><span class="badge ${sb}">${(s.status||'free').replace('_',' ')}</span></div><div class="card-body">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div style="width:46px;height:46px;border-radius:12px;background:${t==='gold'?'var(--gold-dim)':'var(--blue-dim)'};border:1px solid ${t==='gold'?'rgba(170,137,38,0.25)':'rgba(34,113,195,0.25)'};display:flex;align-items:center;justify-content:center;font-size:20px">⬢</div>
        <div><div style="font-size:17px;font-family:var(--serif);font-weight:300">${m.name}</div><div style="font-size:11px;color:${m.color};font-family:var(--mono)">${m.layer}</div></div></div>
      <div class="kv"><span class="kv-k">Billing cycle</span><span class="kv-v" style="text-transform:capitalize">${s.billing_cycle}</span></div>
      <div class="kv"><span class="kv-k">${renewLbl}</span><span class="kv-v">${renewDate}</span></div>
      <div style="margin-top:16px;display:flex;gap:8px">
        ${t!=='gold'?`<button class="btn btn-pri" style="flex:1;justify-content:center" onclick="location.href='/membership.html'">Upgrade Access</button>`:''}
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="PegBilling.portal()">Manage Billing</button></div></div></div>`;
  }
  function dealRoomCard(){
    const t=P.session.tier,u=P.session.usage,cap=TIERS[t].limits.dealRooms;
    if(t==='gold')return `<div class="stat" style="--accent:var(--gold)"><div class="stat-ic">◈</div><div class="stat-v" style="font-size:18px;font-family:var(--serif);font-weight:300;color:var(--gold)">Unlimited</div><div class="stat-l">Deal Room Access</div><div class="stat-m" style="color:var(--gold)">${u.rooms} active workspaces</div></div>`;
    if(t==='pro'){const atCap=u.rooms>=cap,pct=Math.min(100,u.rooms/cap*100);return `<div class="stat" style="--accent:var(--blue)"><div class="stat-ic">◈</div><div class="stat-v">${u.rooms} <small>of ${cap} used</small></div><div class="stat-l">Active Deal Rooms</div><div class="bar"><div class="bar-f" style="width:${pct}%;background:${atCap?'var(--amber)':'var(--blue)'}"></div></div>${atCap?`<div class="stat-m" style="color:var(--amber);cursor:pointer" onclick="location.href='/membership.html'">At capacity — upgrade →</div>`:`<div class="stat-m" style="color:var(--text3)">${cap-u.rooms} remaining</div>`}</div>`;}
    return `<div class="stat" style="--accent:var(--text3)"><div class="stat-ic">◈</div><div class="stat-v" style="font-size:15px;color:var(--text2)">◈</div><div class="stat-l">Deal Rooms</div><div class="stat-m" style="color:var(--text3);cursor:pointer" onclick="location.href='/deal-rooms.html'">Explore workspaces →</div></div>`;
  }
  function aiCard(){
    const t=P.session.tier,u=P.session.usage,limit=TIERS[t].limits.aiQueries;
    if(limit===Infinity)return `<div class="stat" style="--accent:var(--green)"><div class="stat-ic">🧠</div><div class="stat-v">${u.aiUsed} <small>queries</small></div><div class="stat-l">AI Intelligence · Month</div><div class="stat-m" style="color:var(--green)">Unlimited access</div></div>`;
    const rem=Math.max(0,limit-u.aiUsed),pct=Math.min(100,u.aiUsed/limit*100),near=pct>=80;
    return `<div class="stat" style="--accent:${near?'var(--amber)':'var(--green)'}"><div class="stat-ic">🧠</div><div class="stat-v">${rem} <small>left</small></div><div class="stat-l">AI Queries Remaining</div><div class="bar"><div class="bar-f" style="width:${pct}%;background:${near?'var(--amber)':'var(--green)'}"></div></div><div class="stat-m" style="color:${near?'var(--amber)':'var(--text3)'}">${u.aiUsed} / ${limit} used</div></div>`;
  }
  function matchCard(){
    const me=TIERS[P.session.tier].limits.matchEngine;
    const map={full:['Real-time','var(--gold)','Institutional'],standard:['Daily','var(--blue-lt)','Standard'],none:['🔒 Locked','var(--text3)','Gold-only']};
    const [v,c,l]=map[me];
    return `<div class="stat" style="--accent:${c}"><div class="stat-ic">◎</div><div class="stat-v" style="font-size:18px;font-family:var(--serif);font-weight:300;color:${c}">${v}</div><div class="stat-l">Match Engine</div><div class="stat-m" style="color:${me==='none'?'var(--gold)':'var(--text3)'};${me==='none'?'cursor:pointer':''}" ${me==='none'?`onclick="location.href='/membership.html'"`:''}>${me==='none'?'<span style="cursor:pointer" onclick="location.href=\'/match-engine.html\'">See how it works →</span>':l+' tier'}</div></div>`;
  }
  function plans(cycle){
    const cur=P.session.tier,rank={starter:0,pro:1,gold:2};
    const card=k=>{const T=TIERS[k],price=cycle==='monthly'?T.monthly:Math.round(T.annual/12),isCur=cur===k,isFeat=k==='pro';
      return `<div class="plan ${isFeat?'feat':''}">${isCur?'<div class="plan-tag pt-cur">Current Plan</div>':isFeat?'<div class="plan-tag pt-pop">Most Adopted</div>':''}
        <div class="plan-name">${T.name}</div><div class="plan-blurb">${T.layer}</div>
        <div class="plan-price">$${price}<sub>/mo</sub></div><div class="plan-per">${cycle==='annual'?`$${T.annual}/yr · save 30%`:'billed monthly'}</div>
        <ul class="plan-feats">${FEATS[k].map(([f,on])=>`<li class="${on?'':'off'}">${f}</li>`).join('')}</ul>
        ${isCur?'<button class="plan-btn pb-cur">Current Plan</button>':`<button class="plan-btn ${isFeat||k==='gold'?'pb-sol':'pb-out'}" onclick="PegBilling.checkout('${k}','${cycle}')">${rank[k]>rank[cur]?'Upgrade':'Switch'} to ${T.name}</button>`}</div>`;};
    return `<div class="plans">${card('starter')}${card('pro')}${card('gold')}</div>`;
  }
  async function checkout(t,c){
    var st=P.store.get();
    var uid=st.user&&st.user.id;
    // Logged-out / preview visitor (e.g. public homepage): you can't subscribe
    // without an account, so route into the signup funnel and remember the plan.
    if(st.mode==='demo' || !uid || uid==='demo'){
      try{ sessionStorage.setItem('peg_intended_plan', JSON.stringify({tier:t,cycle:c})); }catch(e){}
      window.location.href='/signup.html?next=/membership.html&plan='+encodeURIComponent(t);
      return;
    }
    // Signed-in member -> start real Stripe Checkout
    var email=(st.user&&st.user.email)||(st.profile&&st.profile.email)||'';
    P.toast('💳','var(--blue-dim)','Starting checkout','Redirecting to secure Stripe…');
    try{
      var res=await fetch('/.netlify/functions/create-checkout-session',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ tier:t, cycle:c, userId:uid, email:email, origin:window.location.origin })
      });
      var data={}; try{ data=await res.json(); }catch(e){}
      if(!res.ok || !data.url) throw new Error(data.error || ('Checkout unavailable (HTTP '+res.status+'). Verify Stripe price IDs are set in Netlify env vars.'));
      window.location.href=data.url;   // -> Stripe Checkout
    }catch(e){
      console.error('[Billing] checkout failed:', e);
      P.toast('✗','var(--red,#c0392b)','Checkout failed', (e&&e.message)||'Please try again');
    }
  }
  async function portal(){
    if(P.session.demo){ P.toast('⚙','var(--blue-dim)','Preview mode','Sign in on the live site to manage billing'); return; }
    var st=P.store.get();
    var uid=st.user&&st.user.id;
    if(!uid||uid==='demo'){ P.toast('!','var(--amber-dim)','Sign in required','Please sign in to manage billing'); return; }
    P.toast('⚙','var(--blue-dim)','Opening billing','Redirecting to Stripe…');
    try{
      var res=await fetch('/.netlify/functions/create-portal-session',{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ userId:uid, origin:window.location.origin })
      });
      var data={}; try{ data=await res.json(); }catch(e){}
      if(res.status===409 || data.error==='no_customer'){
        P.toast('ℹ','var(--blue-dim)','No billing account yet','Choose a plan below to set up billing first');
        return;
      }
      if(!res.ok || !data.url) throw new Error(data.error || ('Billing portal unavailable (HTTP '+res.status+'). Verify Stripe + Supabase env vars in Netlify.'));
      window.location.href=data.url;   // -> Stripe Billing Portal
    }catch(e){
      console.error('[Billing] portal failed:', e);
      P.toast('✗','var(--red,#c0392b)','Could not open billing', (e&&e.message)||'Please try again');
    }
  }

  window.PegBilling={stateBanner,membershipCard,dealRoomCard,aiCard,matchCard,plans,checkout,portal};
})();
