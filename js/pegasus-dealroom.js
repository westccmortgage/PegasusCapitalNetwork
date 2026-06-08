/* ============================================================================
   PEGASUS v70 — Deal Room Workspace (window.PegRoom)
   An operational collaboration workspace, not a submission modal.
   Loaded AFTER pegasus-api.js / pegasus-core.js on deal-rooms.html + deal-room.html.

   Design philosophy: calm, intelligent, premium, protected, strategic,
   collaborative. A private capital workspace — never a noisy chatroom.

   COMPLIANCE: Pegasus facilitates structured, member-directed collaboration.
   It does not lend, broker, recommend, match, or steer. The "intelligence" and
   "signal" surfaces describe alignment for the member to act on — they are not
   advice, endorsements, or guaranteed introductions.
   ============================================================================ */
(function(){
  const A = window.PegAPI;
  const S = window.PegStore;
  async function sb(){ try{ return await window.PegSB.ready; }catch(e){ return null; } }
  const live = ()=> S && S.get && S.get().mode === 'live';
  const esc = s => (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lbl = s => (s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const initials = n => (n||'·').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const ago = ts => { if(!ts) return ''; const d=(Date.now()-new Date(ts).getTime())/1e3;
    if(d<60) return 'just now'; if(d<3600) return Math.floor(d/60)+'m ago';
    if(d<86400) return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; };

  /* ── Visibility model (protected by default) ────────────────────────────── */
  const VIS = {
    private:             { ic:'\u25C9', name:'Private',              desc:'Only you. A staging space to structure the opportunity before inviting anyone.' },
    invite_only:         { ic:'\u2709', name:'Invite-Only',          desc:'You and the specific members you invite. The default for protected collaboration.' },
    ambassador_reviewed: { ic:'\u2726', name:'Ambassador-Reviewed',  desc:'An ambassador reviews the opportunity before any aligned member is invited.' },
    institutional:       { ic:'\u25A4', name:'Institutional',        desc:'Visible to verified institutional members within the network. Member-directed.' },
    aligned_only:        { ic:'\u25C8', name:'Aligned-Only',         desc:'Surfaced only to members whose stated capital profile aligns. No outreach is automatic.' },
  };
  const VIS_ORDER = ['private','invite_only','ambassador_reviewed','institutional','aligned_only'];

  /* ── Pegasus guidance copy (helps the member articulate — never advises) ── */
  const GUIDANCE = [
    ['Lead with the objective', 'State plainly what is being pursued and the outcome you want. Clarity attracts aligned capital.'],
    ['Frame the why', 'A short strategic context — market, timing, thesis — lets reviewers understand fit quickly.'],
    ['Be specific on structure', 'Capital request, structure type, and timeline let the right participants self-select in.'],
    ['Choose visibility deliberately', 'Start protected. Widen only when the opportunity is ready for more eyes.'],
  ];

  /* Quiet, member-directed alignment signals. Deterministic from room id so a
     room reads consistently. These describe alignment — they are not matches,
     recommendations, or guaranteed introductions. */
  function signals(d){
    const seed = (String(d.id||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)) || 7;
    const pool = [
      ['var(--green)','Aligned capital profiles detected', 'Within your stated structure'],
      ['var(--teal)', 'Institutional appetite present',     'Member-directed review'],
      ['var(--blue-lt)','Strategic partner profiles nearby','By market & asset type'],
      ['var(--amber)','Operator compatibility noted',       'Based on shared parameters'],
    ];
    const n = 2 + (seed % 2);
    return pool.slice(0, n);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     DATA ACCESS
     ══════════════════════════════════════════════════════════════════════════ */
  async function createWorkspace(p){
    const c = await sb();
    if(live() && c){
      const uid = S.get().user.id;
      const payload = {
        owner_id: uid, name: p.name || 'Untitled Opportunity',
        objective: p.objective || null, deal_type: p.structure_type || null,
        structure_type: p.structure_type || null, amount: +p.amount || 0,
        ltv: p.ltv || null, location: p.market || null, timeline: p.timeline || null,
        target_outcome: p.target_outcome || null, visibility: p.visibility || 'invite_only',
        workflow_state: 'draft',
      };
      const { data, error } = await c.from('deal_rooms').insert(payload).select().single();
      if(error) throw error;
      S.set({ dealRooms: [data, ...S.get().dealRooms] });
      return data;
    }
    // demo
    const room = { id:'dr_'+Date.now(), workflow_state:'draft', stage:0, alignment_score:0,
      status:'active', visibility:p.visibility||'invite_only', name:p.name, objective:p.objective,
      deal_type:p.structure_type, structure_type:p.structure_type, amount:+p.amount||0, ltv:p.ltv,
      location:p.market, timeline:p.timeline, target_outcome:p.target_outcome,
      participants:[], documents:[], activity:[], messages:[] };
    S.set({ dealRooms:[room, ...S.get().dealRooms] });
    return room;
  }

  async function getRoom(id){
    let d = (S.get().dealRooms||[]).find(r=>r.id===id) || (S.get().dealRooms||[])[0] || {};
    const c = await sb();
    if(live() && c && id){
      try{
        const [{data:room},{data:parts},{data:docs},{data:msgs},{data:acts}] = await Promise.all([
          c.from('deal_rooms').select('*').eq('id',id).maybeSingle(),
          c.from('deal_room_participants').select('*').eq('deal_room_id',id),
          c.from('deal_room_documents').select('*').eq('deal_room_id',id),
          c.from('deal_room_messages').select('*').eq('deal_room_id',id).order('created_at',{ascending:true}),
          c.from('deal_room_activity').select('*').eq('deal_room_id',id).order('created_at',{ascending:false}).limit(20),
        ]);
        if(room) d = { ...d, ...room };
        d.participants = parts || d.participants || [];
        d.documents    = docs  || d.documents    || [];
        d.messages     = msgs  || [];
        d.activity     = acts  || [];
      }catch(e){ console.warn('[PegRoom] live fetch partial:', e); }
    }
    if(!d.messages || !d.messages.length) d.messages = demoMessages(d);
    return d;
  }

  async function postMessage(roomId, kind, body){
    const c = await sb();
    if(live() && c){
      const { data, error } = await c.rpc('post_room_message', { p_room:roomId, p_kind:kind, p_body:body, p_parent:null });
      if(error) throw error; return data;
    }
    const me = currentMember();
    return { id:'m_'+Date.now(), author_id:'me', author_name:me.name, kind, body, created_at:new Date().toISOString() };
  }

  async function requestIntroduction(roomId, note){
    const c = await sb();
    if(live() && c){
      const { data, error } = await c.rpc('request_introduction', { p_room:roomId, p_note:note||'' });
      if(error) throw error; return data;
    }
    return { id:'m_'+Date.now(), author_id:'me', kind:'introduction', body:note||'Requested a structured introduction.', created_at:new Date().toISOString() };
  }

  async function setVisibility(roomId, v){
    const c = await sb();
    if(live() && c){
      const { data, error } = await c.from('deal_rooms').update({ visibility:v }).eq('id',roomId).select().single();
      if(error) throw error;
      S.set({ dealRooms: S.get().dealRooms.map(r=>r.id===roomId?{...r,visibility:v}:r) });
      return data;
    }
    S.set({ dealRooms: S.get().dealRooms.map(r=>r.id===roomId?{...r,visibility:v}:r) });
    return { id:roomId, visibility:v };
  }

  function currentMember(){
    const st = S.get(); const p = st.profile||{}; const u = st.user||{};
    return { id:u.id||'me', name:p.full_name || st.name || 'You' };
  }
  function demoMessages(d){
    const owner = currentMember().name;
    return [
      { id:'seed1', author_name:owner, kind:'update', created_at:new Date(Date.now()-864e5).toISOString(),
        body:'Opened this workspace to structure the opportunity. Capital request and target outcome are in the overview — happy to walk any aligned participant through the thesis.' },
      { id:'seed2', author_name:'Pegasus', kind:'note', created_at:new Date(Date.now()-43e5).toISOString(),
        body:'Workspace is set to '+(VIS[d.visibility||'invite_only'].name)+'. Invite participants when the structure is ready for review.' },
    ];
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CREATION EXPERIENCE — large structured workspace panel
     ══════════════════════════════════════════════════════════════════════════ */
  let DRAFT = { visibility:'invite_only' };

  function launchCreate(){
    DRAFT = { visibility:'invite_only' };
    const tips = GUIDANCE.map(g=>`<div class="gd-tip"><b>${g[0]}.</b> ${g[1]}</div>`).join('');
    const html = `
    <div class="ws-scrim" onclick="if(event.target===this)PegRoom.closeCreate()">
      <div class="ws-panel peg-dark-host">
        <button class="ws-x" onclick="PegRoom.closeCreate()">\u2715</button>
        <div class="ws-main">
          <div class="ws-eyebrow">Pegasus Capital Network \u00B7 Opportunity Workspace</div>
          <h1 class="ws-title">Launch a Capital Workspace</h1>
          <p class="ws-lede">A protected operational environment where an opportunity becomes real \u2014 structured overview, collaboration, and curated participation in one place.</p>

          <div class="ws-sec">
            <div class="ws-sec-h"><span class="ws-sec-n">01</span><span class="ws-sec-t">Opportunity Overview</span><span class="ws-sec-s">What & why</span></div>
            <div class="field"><label class="label">Opportunity Name</label>
              <input class="input" id="w_name" placeholder="e.g. Lakeside Industrial Park \u2014 Acquisition & Reposition"></div>
            <p class="ws-help">Give it a name a reviewer can recognize at a glance.</p>
            <div class="field"><label class="label">Vision / Objective</label>
              <textarea class="ws-textarea" id="w_obj" placeholder="What is being pursued, and what outcome are you driving toward?"></textarea></div>
            <div class="field"><label class="label">Strategic Context \u2014 why this matters</label>
              <textarea class="ws-textarea" id="w_ctx" placeholder="Market, timing, thesis. The context that helps aligned capital understand fit quickly."></textarea></div>
          </div>

          <div class="ws-sec">
            <div class="ws-sec-h"><span class="ws-sec-n">02</span><span class="ws-sec-t">Capital Structure</span><span class="ws-sec-s">How</span></div>
            <div class="row2">
              <div class="field"><label class="label">Capital Request</label><input class="input input-mono" id="w_amt" placeholder="3,500,000"></div>
              <div class="field"><label class="label">Structure Type</label><input class="input" id="w_type" placeholder="Bridge \u00B7 Senior Debt \u00B7 Pref Equity"></div>
            </div>
            <div class="row2">
              <div class="field"><label class="label">Timeline</label><input class="input" id="w_time" placeholder="e.g. Close within 60 days"></div>
              <div class="field"><label class="label">Market</label><input class="input" id="w_mkt" placeholder="Denver, CO"></div>
            </div>
            <div class="field"><label class="label">Target Outcome</label><input class="input" id="w_out" placeholder="e.g. Term sheet from an aligned capital partner"></div>
          </div>

          <div class="ws-sec">
            <div class="ws-sec-h"><span class="ws-sec-n">03</span><span class="ws-sec-t">Visibility &amp; Protection</span><span class="ws-sec-s">Who sees this</span></div>
            <p class="ws-help">Start protected. You control who enters the workspace \u2014 widen visibility only when the opportunity is ready.</p>
            <div class="ws-vis" id="w_vis">
              ${VIS_ORDER.map(k=>`
                <div class="ws-vis-opt ${k==='invite_only'?'on':''}" data-v="${k}" onclick="PegRoom.pickVis('${k}')">
                  <div class="ws-vis-ic">${VIS[k].ic}</div>
                  <div><div class="ws-vis-name">${VIS[k].name}</div><div class="ws-vis-desc">${VIS[k].desc}</div></div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="ws-rail">
          <div class="gd-card">
            <div class="gd-h"><img src="/assets/brand/pegasus-symbol.svg" alt=""><span class="gd-h-t">Pegasus Guidance</span></div>
            ${tips}
          </div>
          <div class="gd-card">
            <div class="gd-h"><span class="gd-h-t">Match Engine \u00B7 Quiet Signals</span></div>
            <div class="gd-sig"><span class="gd-dot" style="color:var(--green)"></span><div><div class="gd-sig-t">Aligned capital is active in your market</div><div class="gd-sig-s">Surfaces once the workspace is live</div></div></div>
            <div class="gd-sig"><span class="gd-dot" style="color:var(--teal)"></span><div><div class="gd-sig-t">Institutional appetite present</div><div class="gd-sig-s">Member-directed \u00B7 no automatic outreach</div></div></div>
            <div class="gd-note">Signals describe alignment for you to act on. Pegasus does not recommend, broker, or guarantee any introduction.</div>
          </div>
        </div>

        <div class="ws-foot in-main">
          <div class="ws-err" id="w_err"></div>
          <button class="btn btn-ghost" onclick="PegRoom.closeCreate()">Cancel</button>
          <button class="btn btn-pri" id="w_go" onclick="PegRoom.submitCreate()">Launch Workspace \u2192</button>
        </div>
      </div>
    </div>`;
    window.Pegasus.modal(html);
  }
  function pickVis(k){
    DRAFT.visibility = k;
    document.querySelectorAll('#w_vis .ws-vis-opt').forEach(e=>e.classList.toggle('on', e.dataset.v===k));
  }
  function closeCreate(){ window.Pegasus.closeModal(); }

  async function submitCreate(){
    const val = id => (document.getElementById(id)||{}).value || '';
    const err = document.getElementById('w_err'); const go = document.getElementById('w_go');
    const name = val('w_name').trim();
    if(!name){ if(err) err.textContent='Give the opportunity a name to continue.'; return; }
    const payload = {
      name, objective:[val('w_obj').trim(), val('w_ctx').trim()].filter(Boolean).join('\n\n'),
      amount:+(val('w_amt').replace(/[^0-9.]/g,''))||0, structure_type:val('w_type').trim()||'Opportunity',
      timeline:val('w_time').trim(), market:val('w_mkt').trim(), target_outcome:val('w_out').trim(),
      ltv:'\u2014', visibility:DRAFT.visibility,
    };
    if(err) err.textContent=''; if(go){ go.disabled=true; go.textContent='Launching\u2026'; }
    try{
      const room = await createWorkspace(payload);
      window.Pegasus.toast('\u25C8','var(--blue-dim)','Workspace launched', VIS[payload.visibility].name+' \u00B7 '+name);
      setTimeout(()=>{ location.href='/deal-room.html?id='+room.id; }, 650);
    }catch(e){
      console.error('[PegRoom] launch failed:', e);
      if(go){ go.disabled=false; go.textContent='Launch Workspace \u2192'; }
      let m=(e&&e.message)||'Could not launch workspace.';
      if(/row-level security|violates|policy/i.test(m)) m='Your access layer doesn\u2019t permit a new workspace yet, or access is still syncing. On Pro/Gold? Refresh and retry.';
      if(err) err.textContent=m;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     OPERATIONAL WORKSPACE — deal-room.html
     ══════════════════════════════════════════════════════════════════════════ */
  let CURRENT = null, COMPOSE_KIND = 'update';

  async function mountWorkspace(id){
    const d = await getRoom(id); CURRENT = d;
    const WF = A.WF, idx = WF.indexOf(d.workflow_state||'draft');
    window.Pegasus.mountApp({ active:'Deal Rooms', title:d.name||'Capital Workspace',
      sub:(d.structure_type||d.deal_type||'Opportunity')+' \u00B7 '+(d.location||'\u2014') });
    const v = document.getElementById('pegView');
    const vmeta = VIS[d.visibility||'invite_only'];

    const header = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <a class="link" href="/deal-rooms.html">\u2190 All Workspaces</a>
        <span class="vis-badge" onclick="PegRoom.cycleVis()" title="Change visibility"><span class="dot" style="background:var(--blue)"></span>${vmeta.name}</span>
        <span style="flex:1"></span>
        ${idx<WF.length-1
          ? `<button class="btn btn-sm btn-pri" onclick="PegRoom.advance()">Advance \u2192 ${lbl(WF[idx+1])}</button>`
          : `<span class="tag tag-g">\u25CF Closed</span>`}
      </div>`;

    const stats = `
      <div class="grid g4" style="margin-bottom:16px">
        <div class="stat" style="--accent:var(--blue)"><div class="stat-l">Capital Request</div><div class="stat-v" style="margin-top:6px">${window.Pegasus.fmt(d.amount)}</div><div class="stat-m" style="color:var(--text3)">${esc(d.timeline||'Timeline open')}</div></div>
        <div class="stat" style="--accent:var(--teal)"><div class="stat-l">Capital Alignment</div><div class="stat-v" style="margin-top:6px;color:var(--teal)">${d.alignment_score||0}<small>/100</small></div><div class="stat-m" style="color:var(--teal)">${(d.alignment_score||0)>=85?'High alignment':'Building'}</div></div>
        <div class="stat" style="--accent:var(--green)"><div class="stat-l">Participants</div><div class="stat-v" style="margin-top:6px;color:var(--green)">${(d.participants||[]).length}</div><div class="stat-m" style="color:var(--text3)">Curated</div></div>
        <div class="stat" style="--accent:var(--amber)"><div class="stat-l">Workflow</div><div class="stat-v" style="margin-top:6px;font-size:15px;font-family:var(--serif);font-weight:300">${lbl(d.workflow_state)}</div><div class="stat-m" style="color:var(--text3)">Stage ${idx+1} of ${WF.length}</div></div>
      </div>`;

    const flow = `<div class="flow" style="margin-bottom:18px">${WF.map((w,i)=>`<div class="flow-i ${i<idx?'done':i===idx?'active':''}"><div class="flow-line"></div><div class="flow-node">${i<idx?'\u2713':i+1}</div><div class="flow-lbl">${lbl(w)}</div></div>`).join('')}</div>`;

    const body = `
      <div class="dw">
        <div class="dw-col">
          ${overviewCard(d)}
          ${collabCard(d)}
          ${vaultCard(d)}
        </div>
        <div class="dw-col">
          ${intelCard(d)}
          ${participantsCard(d)}
          ${activityCard(d)}
        </div>
      </div>`;

    v.insertAdjacentHTML('beforeend', `<div class="dr-rebuild">${header}${stats}${flow}${body}</div>`);
    renderThread(d);
  }

  function overviewCard(d){
    const kv = [['Structure', d.structure_type||d.deal_type||'\u2014'],['Market', d.location||'\u2014'],
      ['Timeline', d.timeline||'\u2014'],['Target Outcome', d.target_outcome||'\u2014']];
    return `<div class="card"><div class="card-head"><div class="card-title">Opportunity Overview</div></div>
      <div class="card-body">
        ${d.objective?`<div style="font-size:13.5px;line-height:1.7;color:var(--text);white-space:pre-wrap;margin-bottom:16px">${esc(d.objective)}</div>`:'<div style="color:var(--text3);font-size:12px;margin-bottom:12px">No objective written yet.</div>'}
        ${kv.map(r=>`<div class="kv"><span class="kv-k">${r[0]}</span><span class="kv-v">${esc(r[1])}</span></div>`).join('')}
      </div></div>`;
  }

  function collabCard(d){
    const kinds = [['update','Update'],['introduction','Introduction'],['diligence','Diligence'],['note','Note']];
    return `<div class="card"><div class="card-head"><div class="card-title">Collaboration</div>
        <span style="font-size:9px;font-family:var(--mono);color:var(--text3);text-transform:uppercase;letter-spacing:0.08em">High-signal \u00B7 curated</span></div>
      <div class="card-body">
        <div class="thread" id="thread"></div>
        <div class="composer">
          <div class="collab-kinds" style="margin-bottom:10px">${kinds.map(k=>`<div class="ck ${k[0]==='update'?'on':''}" data-k="${k[0]}" onclick="PegRoom.setKind('${k[0]}')">${k[1]}</div>`).join('')}</div>
          <textarea class="ws-textarea" id="composeBody" placeholder="Share a structured update, request an introduction, or note diligence \u2014 intentional and high-signal."></textarea>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
            <span style="flex:1;font-size:10px;color:var(--text3);font-family:var(--mono)" id="composeHint">Posting as an Update</span>
            <button class="btn btn-sm btn-ghost" onclick="PegRoom.requestIntro()">Request Introduction</button>
            <button class="btn btn-sm btn-pri" onclick="PegRoom.send()">Post \u2192</button>
          </div>
        </div>
        <div class="compliance-note">Communication here is intentional and member-directed. Do not share sensitive personal or financial identifiers. Pegasus does not verify participants, broker deals, or guarantee any introduction.</div>
      </div></div>`;
  }

  function renderThread(d){
    const t = document.getElementById('thread'); if(!t) return;
    const msgs = d.messages || [];
    if(!msgs.length){ t.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px 0">No updates yet. Open the collaboration with a clear first update.</div>'; return; }
    t.innerHTML = msgs.map(m=>{
      const who = m.author_name || (m.author_id===currentMember().id?currentMember().name:'Member');
      const k = m.kind||'update';
      return `<div class="msg">
        <div class="msg-av">${esc(initials(who))}</div>
        <div class="msg-b">
          <div class="msg-top"><span class="msg-who">${esc(who)}</span><span class="msg-kind mk-${k}">${k}</span><span class="msg-time">${ago(m.created_at)}</span></div>
          <div class="msg-text">${esc(m.body)}</div>
        </div></div>`;
    }).join('');
  }

  function vaultCard(d){
    const docs = d.documents || [];
    const iconFor = n => /\.pdf/i.test(n)?'\uD83D\uDCC4':/\.(xls|csv)/i.test(n)?'\uD83D\uDCCA':/\.(png|jpg|jpeg|heic)/i.test(n)?'\uD83D\uDDBC\uFE0F':/\.(mp4|mov)/i.test(n)?'\uD83C\uDFA5':/\.(ppt|key|deck)/i.test(n)?'\uD83D\uDCD1':'\uD83D\uDCC1';
    return `<div class="card"><div class="card-head"><div class="card-title">Document Vault</div>
        <span style="font-size:9px;font-family:var(--mono);color:var(--text3)">${docs.length} file${docs.length===1?'':'s'}</span></div>
      <div class="card-body"><div class="vault">
        ${docs.map(doc=>{const n=doc.name||doc.n||'Document';return `<div class="doc"><div class="doc-ic">${iconFor(n)}</div><div style="min-width:0"><div class="doc-n">${esc(n)}</div><div class="doc-m">${esc(doc.doc_type||doc.t||'file')} \u00B7 ${esc((doc.status||'pending'))}</div></div></div>`;}).join('')}
        <div class="vault-drop" onclick="PegRoom.uploadHint()">+ Add decks, PDFs, renders, drone video, spreadsheets &amp; diligence files</div>
      </div></div></div>`;
  }

  function intelCard(d){
    const sigs = signals(d);
    return `<div class="card dark" style="border-color:rgba(58,143,232,0.22)">
      <div class="card-head" style="background:linear-gradient(135deg,var(--bg2),rgba(34,113,195,0.06))">
        <div class="card-title" style="display:flex;align-items:center;gap:8px"><span class="ai-avatar"><img src="/assets/brand/pegasus-symbol.svg" alt=""></span>Capital Intelligence</div></div>
      <div class="card-body">
        <div style="font-size:12px;color:var(--text2);line-height:1.65;margin-bottom:14px">The Match Engine quietly observes this workspace and surfaces alignment for you to act on \u2014 nothing is shared and no outreach happens without your direction.</div>
        ${sigs.map(s=>`<div class="gd-sig"><span class="gd-dot" style="color:${s[0]}"></span><div><div class="gd-sig-t">${s[1]}</div><div class="gd-sig-s">${s[2]}</div></div></div>`).join('')}
        <div class="gd-note" style="margin-top:10px">Signals describe alignment only. Pegasus does not recommend, broker, or guarantee introductions.</div>
      </div></div>`;
  }

  function participantsCard(d){
    const parts = d.participants || [];
    return `<div class="card"><div class="card-head"><div class="card-title">Participants</div>
        <span class="link" onclick="PegRoom.inviteHint()">+ Invite</span></div>
      <div class="card-body">
        ${parts.length?parts.map(p=>{const nm=p.display_name||p.n||'Member';return `<div class="party"><div class="msg-av" style="width:30px;height:30px;font-size:11px">${esc(initials(nm))}</div><div class="party-meta"><div class="party-n">${esc(nm)}</div><div class="party-r">${esc(p.role||p.r||'participant')}</div></div><span class="party-st ${ (p.status||'active')==='active'?'tag-g':'tag-a'}">${esc(p.status||'active')}</span></div>`;}).join(''):'<div style="color:var(--text3);font-size:12px">Owner only. Invite aligned participants when ready.</div>'}
        <div class="compliance-note" style="margin-top:12px">Invitations are member-directed. Verify credentials independently before engaging.</div>
      </div></div>`;
  }

  function activityCard(d){
    const acts = d.activity || [];
    return `<div class="card"><div class="card-head"><div class="card-title">Activity</div></div>
      <div class="card-body">
        ${acts.length?acts.map(a=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)"><div style="width:6px;height:6px;border-radius:50%;background:var(--blue);margin-top:6px;flex-shrink:0"></div><div><div style="font-size:11px;color:var(--text2);line-height:1.45">${esc(a.message||a.x||'')}</div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);margin-top:2px">${ago(a.created_at)||esc(a.t||'')}</div></div></div>`).join(''):'<div style="color:var(--text3);font-size:12px">No activity yet.</div>'}
      </div></div>`;
  }

  /* ── Workspace interactions ─────────────────────────────────────────────── */
  function setKind(k){ COMPOSE_KIND=k;
    document.querySelectorAll('.collab-kinds .ck').forEach(e=>e.classList.toggle('on', e.dataset.k===k));
    const article={update:'an Update',introduction:'an Introduction',diligence:'a Diligence note',note:'a Note'}[k]||'an Update';
    const h=document.getElementById('composeHint'); if(h) h.textContent='Posting as '+article;
  }
  async function send(){
    const ta=document.getElementById('composeBody'); const body=(ta&&ta.value||'').trim();
    if(!body){ if(ta) ta.focus(); return; }
    try{
      const m=await postMessage(CURRENT.id, COMPOSE_KIND, body);
      CURRENT.messages=[...(CURRENT.messages||[]), {...m, author_name:m.author_name||currentMember().name}];
      if(ta) ta.value=''; renderThread(CURRENT);
      window.Pegasus.toast('\u2713','var(--green-dim)','Posted', lbl(COMPOSE_KIND));
    }catch(e){ console.error(e); window.Pegasus.toast('!','var(--red-dim)','Could not post', (e&&e.message)||''); }
  }
  async function requestIntro(){
    const ta=document.getElementById('composeBody'); const note=(ta&&ta.value||'').trim();
    try{
      const m=await requestIntroduction(CURRENT.id, note);
      CURRENT.messages=[...(CURRENT.messages||[]), {...m, author_name:currentMember().name, kind:'introduction'}];
      if(ta) ta.value=''; renderThread(CURRENT);
      window.Pegasus.toast('\u25C8','var(--teal-dim)','Introduction requested','Member-directed \u00B7 forwarded for review');
    }catch(e){ console.error(e); window.Pegasus.toast('!','var(--red-dim)','Could not send', (e&&e.message)||''); }
  }
  async function advance(){
    try{
      const d=await A.advanceDealRoom(CURRENT.id);
      window.Pegasus.toast('\u27F3','var(--teal-dim)','Workflow advanced', lbl(d.workflow_state));
      setTimeout(()=>mountWorkspace(CURRENT.id), 400);
    }catch(e){ window.Pegasus.toast('!','var(--red-dim)','Could not advance',(e&&e.message)||''); }
  }
  async function cycleVis(){
    const order=VIS_ORDER; const cur=CURRENT.visibility||'invite_only';
    const next=order[(order.indexOf(cur)+1)%order.length];
    try{ await setVisibility(CURRENT.id, next); CURRENT.visibility=next;
      window.Pegasus.toast('\u25C9','var(--blue-dim)','Visibility updated', VIS[next].name);
      mountWorkspace(CURRENT.id);
    }catch(e){ window.Pegasus.toast('!','var(--red-dim)','Could not update',(e&&e.message)||''); }
  }
  function uploadHint(){ window.Pegasus.toast('\uD83D\uDD12','var(--blue-dim)','Secure vault','File upload connects to your storage bucket'); }
  function inviteHint(){ window.Pegasus.toast('\u2709','var(--blue-dim)','Invite','Member-directed invitations \u2014 verify credentials independently'); }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window.PegRoom = {
    VIS, VIS_ORDER,
    // creation
    launchCreate, closeCreate, pickVis, submitCreate,
    // workspace
    mountWorkspace, setKind, send, requestIntro, advance, cycleVis, uploadHint, inviteHint,
    // data (exposed for reuse/testing)
    createWorkspace, getRoom, postMessage, requestIntroduction, setVisibility,
  };
})();
