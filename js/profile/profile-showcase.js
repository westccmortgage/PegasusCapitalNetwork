/* ============================================================================
   PEGASUS — Showcase System · profile-showcase.js  (window.PegShowcase)
   A curated, tier-limited member visibility layer. Featured Opportunities,
   not submissions. Editorial cards, elegant limits, admin moderation.

   Plugs into existing globals: Pegasus (tier/limit/toast/modal/mountApp/fmt),
   PegStore, PegSB, PegProfile. Scoped UI to .sc-* (see css/showcase.css).
   Additive — safe to remove by deleting this file + showcase pages.
   ============================================================================ */
(function () {
  'use strict';

  async function sb(){ try{ return await window.PegSB.ready; }catch(e){ return null; } }
  function live(){ var s=window.PegStore; return s && s.get && s.get().mode==='live'; }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function cap(s){ return (s||'').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}); }

  /* ── Language: never "submission" — Featured Opportunities ───────────────── */
  var BADGES = {
    featured:            'Featured',
    off_market:          'Off-Market',
    institutional:       'Institutional',
    growth_capital:      'Growth Capital',
    verified:            'Verified',
    ambassador_reviewed: 'Ambassador Reviewed',
    none:                '—',
  };
  /* Members may self-assign these; reviewed/verified are admin-granted only. */
  var MEMBER_BADGES = ['featured','off_market','institutional','growth_capital'];

  /* Role-contextual category presets */
  function categoriesFor(role){
    role = (role||'').toLowerCase();
    if(role==='agent')                              return ['Featured Listing','Off-Market Deal','Signature Opportunity'];
    if(role==='lender')                             return ['Lending Program','Current Appetite','Guidelines','Flyer'];
    if(role==='investor'||role==='capital'||role==='rwa_partner') return ['Investment Focus','Preferred Structure','Ticket Size'];
    if(role==='founder'||role==='developer')        return ['Venture','Raise','Strategic Opportunity'];
    if(role==='borrower')                           return ['Opportunity','Project','Strategic Goal'];
    if(role==='ecosystem_member')                   return ['Service','Program','Workshop','Consulting','Media','Strategic Collaboration','Educational Session'];
    return ['Featured Opportunity','Program','Offering','Service'];
  }

  /* ── Demo store (offline preview) ────────────────────────────────────────── */
  var DEMO = [];

  /* ══════════════════════════════════════════════════════════════════════════
     DATA
     ══════════════════════════════════════════════════════════════════════════ */
  async function listFor(ownerId, opts){
    opts = opts || {};
    var c = await sb();
    if(live() && c && ownerId){
      try{
        var q = c.from('showcase_items').select('*').eq('owner_id', ownerId)
                 .order('admin_featured',{ascending:false}).order('sort',{ascending:true})
                 .order('created_at',{ascending:false});
        if(opts.publicOnly) q = q.eq('status','active');
        var r = await q;
        return r.data || [];
      }catch(e){ console.warn('[PegShowcase] list failed:', e&&e.message); return []; }
    }
    return DEMO.filter(function(i){ return i.owner_id===ownerId && (!opts.publicOnly || i.status==='active'); });
  }

  async function listForModeration(){
    var c = await sb();
    if(live() && c){
      try{
        var r = await c.from('showcase_items').select('*')
                 .order('status',{ascending:true}).order('created_at',{ascending:false}).limit(200);
        return r.data || [];
      }catch(e){ return []; }
    }
    return DEMO.slice();
  }

  function ownerId(){ var u=(window.PegProfile&&window.PegProfile.currentUser&&window.PegProfile.currentUser())||null; return u?u.id:'me'; }

  async function create(item){
    var c = await sb(); var uid = ownerId();
    var payload = {
      owner_id: uid, title:item.title, summary:item.summary||null, category:item.category||null,
      location:item.location||null, image_url:item.image_url||null,
      cta_label:item.cta_label||null, cta_url:item.cta_url||null,
      price:item.price||null, size_detail:item.size_detail||null,
      opportunity_status:item.opportunity_status||null,
      tags: Array.isArray(item.tags)?item.tags:[],
      badge: MEMBER_BADGES.indexOf(item.badge)>=0 ? item.badge : 'featured',
      status: (item.status==='draft'||item.status==='hidden') ? item.status : 'active',
    };
    if(live() && c){
      var r = await c.from('showcase_items').insert(payload).select().single();
      if(r.error) throw r.error; return r.data;
    }
    var row = Object.assign({ id:'sc_'+Date.now(), admin_featured:false, ambassador_approved:false,
      created_at:new Date().toISOString() }, payload);
    DEMO.unshift(row); return row;
  }

  async function update(id, patch){
    var c = await sb();
    if(live() && c){
      var r = await c.from('showcase_items').update(patch).eq('id',id).select().single();
      if(r.error) throw r.error; return r.data;
    }
    DEMO = DEMO.map(function(i){ return i.id===id?Object.assign({},i,patch):i; });
    return DEMO.find(function(i){return i.id===id;});
  }

  async function remove(id){
    var c = await sb();
    if(live() && c){ var r = await c.from('showcase_items').delete().eq('id',id); if(r.error) throw r.error; return true; }
    DEMO = DEMO.filter(function(i){ return i.id!==id; }); return true;
  }

  async function moderate(id, action){
    var c = await sb();
    if(live() && c){
      var r = await c.rpc('moderate_showcase',{ p_id:id, p_action:action });
      if(r.error) throw r.error; return r.data;
    }
    var map = { hide:{status:'hidden'}, restore:{status:'active'}, flag:{status:'flagged'},
      feature:{admin_featured:true}, unfeature:{admin_featured:false},
      approve_ambassador:{ambassador_approved:true, badge:'ambassador_reviewed'} };
    return update(id, map[action]||{});
  }

  function limit(){ var l = window.Pegasus && window.Pegasus.limit && window.Pegasus.limit('showcase'); return (l==null?1:l); }

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER — card
     ══════════════════════════════════════════════════════════════════════════ */
  function card(it, mode){ // mode: 'public' | 'owner' | 'admin'
    var media = it.image_url
      ? '<img src="'+esc(it.image_url)+'" alt="'+esc(it.title)+'">'
      : '<div class="sc-media-fallback">'+esc((it.title||'P').trim().charAt(0).toUpperCase())+'</div>';
    var badge = (it.badge && it.badge!=='none')
      ? '<span class="sc-badge scb-'+esc(it.badge)+'">'+esc(BADGES[it.badge]||it.badge)+'</span>' : '';
    var pin = it.admin_featured ? '<div class="sc-featured-pin" title="Featured Placement">\u2605</div>' : '';
    var cta = (it.cta_label && it.cta_url)
      ? '<a class="sc-cta" href="'+esc(it.cta_url)+'" target="_blank" rel="noopener">'+esc(it.cta_label)+' \u2192</a>' : '';
    var loc = it.location ? '<span class="sc-loc">\uD83D\uDCCD '+esc(it.location)+'</span>' : '';
    var facts = [];
    if(it.price) facts.push('<span class="sc-fact">'+esc(it.price)+'</span>');
    if(it.size_detail) facts.push('<span class="sc-fact">'+esc(it.size_detail)+'</span>');
    if(it.opportunity_status) facts.push('<span class="sc-fact sc-fact-st">'+esc(it.opportunity_status)+'</span>');
    var factsHtml = facts.length ? '<div class="sc-facts">'+facts.join('')+'</div>' : '';
    var tagsHtml = (it.tags&&it.tags.length) ? '<div class="sc-tags">'+it.tags.map(function(t){return '<span class="sc-tagchip">'+esc(t)+'</span>';}).join('')+'</div>' : '';

    var controls = '';
    if(mode==='owner'){
      controls = '<div class="sc-controls">'+
        '<span class="sc-ctl" onclick="PegShowcase.edit(\''+it.id+'\')">Edit</span>'+
        '<span class="sc-ctl" onclick="PegShowcase.toggleHide(\''+it.id+'\',\''+esc(it.status)+'\')">'+(it.status==='hidden'?'Show':'Hide')+'</span>'+
        '<span class="sc-ctl danger" onclick="PegShowcase.confirmRemove(\''+it.id+'\')">Remove</span>'+
        '<span class="sc-status scs-'+esc(it.status)+'">'+esc(it.status)+'</span></div>';
    } else if(mode==='admin'){
      controls = '<div class="sc-controls">'+
        '<span class="sc-ctl gold" onclick="PegShowcase.adminAct(\''+it.id+'\',\''+(it.admin_featured?'unfeature':'feature')+'\')">'+(it.admin_featured?'Unfeature':'Feature')+'</span>'+
        '<span class="sc-ctl" onclick="PegShowcase.adminAct(\''+it.id+'\',\''+(it.status==='hidden'?'restore':'hide')+'\')">'+(it.status==='hidden'?'Restore':'Hide')+'</span>'+
        '<span class="sc-ctl gold" onclick="PegShowcase.adminAct(\''+it.id+'\',\'approve_ambassador\')">Approve Amb.</span>'+
        '<span class="sc-ctl danger" onclick="PegShowcase.adminRemove(\''+it.id+'\')">Remove</span>'+
        '<span class="sc-status scs-'+esc(it.status)+'">'+esc(it.status)+'</span></div>';
    }

    return '<div class="sc-card '+(it.status!=='active'&&mode!=='admin'?'dim':'')+'">'+
      '<div class="sc-media">'+badge+pin+media+'</div>'+
      '<div class="sc-body">'+
        (it.category?'<div class="sc-cat">'+esc(it.category)+'</div>':'')+
        '<div class="sc-name">'+esc(it.title)+'</div>'+
        factsHtml+
        (it.summary?'<div class="sc-sum">'+esc(it.summary)+'</div>':'')+
        tagsHtml+
        ((loc||cta)?'<div class="sc-meta">'+loc+cta+'</div>':'')+
      '</div>'+ controls +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER — public profile section (read-only; Manage link for owner)
     ══════════════════════════════════════════════════════════════════════════ */
  function sectionHtml(items, opts){
    opts = opts || {};
    var inner;
    if(!items.length){
      if(!opts.isOwner) return ''; // hide entirely on public view when empty
      inner = '<div class="sc-empty"><div class="sc-empty-ic">\u25C8</div>'+
        '<div class="sc-empty-t">Showcase your work</div>'+
        '<div class="sc-empty-s">Highlight a featured opportunity, program, or project \u2014 curated and institutional, never a noisy listing.</div>'+
        '<a class="btn btn-pri" href="/showcase.html">Add a Featured Opportunity \u2192</a></div>';
    } else {
      inner = '<div class="sc-grid">'+items.map(function(it){ return card(it,'public'); }).join('')+'</div>';
    }
    return '<section class="sc-section">'+
      '<div class="sc-head"><div><div class="sc-kicker">Curated Showcase</div><div class="sc-title">Featured Opportunities</div></div>'+
        (opts.isOwner?'<a class="sc-action" href="/showcase.html">Manage \u2192</a>':'')+'</div>'+
      inner+'</section>';
  }

  async function mountInto(target, opts){
    opts = opts || {};
    var host = typeof target==='string' ? document.querySelector(target) : target;
    if(!host) return;
    var items = await listFor(opts.ownerId, { publicOnly: !opts.isOwner });
    var html = sectionHtml(items, opts);
    if(html){ var wrap=document.createElement('div'); wrap.innerHTML=html; host.appendChild(wrap.firstChild); }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MEMBER MANAGER (showcase.html)
     ══════════════════════════════════════════════════════════════════════════ */
  var ROLE = 'member';

  async function mountManager(){
    var p = (window.PegProfile && window.PegProfile.ownProfile && window.PegProfile.ownProfile()) || {};
    ROLE = p.role || 'member';
    window.Pegasus.mountApp({ active:'', title:'Showcase', sub:'Your curated Featured Opportunities' });
    var v = document.getElementById('pegView');
    var items = await listFor(ownerId(), {});
    var max = limit(), used = items.filter(function(i){return i.status==='active'||i.status==='pending';}).length, atCap = (max!==Infinity && used>=max);

    var headerNote = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">'+
      '<p class="sub" style="margin:0;max-width:54ch;text-align:left">A prestige visibility layer \u2014 a limited set of beautifully presented opportunities, not unlimited posting. Quality over quantity keeps the ecosystem protected.</p>'+
      '<span class="sc-count">'+used+' / '+(max===Infinity?'\u221E':max)+' featured</span></div>';

    var grid;
    if(!items.length){
      grid = '<div class="sc-empty"><div class="sc-empty-ic">\u25C8</div>'+
        '<div class="sc-empty-t">Showcase your work</div>'+
        '<div class="sc-empty-s">Highlight a featured opportunity, program, or project \u2014 curated and institutional, never a noisy listing.</div>'+
        '<button class="btn btn-pri" onclick="PegShowcase.edit()">Add a Featured Opportunity \u2192</button></div>';
    } else {
      var cards = items.map(function(it){ return card(it,'owner'); });
      var capNotice = atCap
        ? '<div class="sc-limit" style="grid-column:1/-1"><div class="sc-limit-ic">\u25C8</div>'+
            '<div><div class="sc-limit-t">You\u2019ve filled your '+(max)+' featured '+(max===1?'opportunity':'opportunities')+'</div>'+
            '<div class="sc-limit-s">You can still prepare drafts. Elevate your access layer to publish more.</div></div>'+
            '<a class="btn btn-pri" href="/membership.html">Compare Access Layers \u2192</a></div>'
        : '';
      var addTile = '<div class="sc-add-tile" onclick="PegShowcase.edit()"><div class="sc-add-ic">+</div><div class="sc-add-l">Add Featured Opportunity</div></div>';
      grid = '<div class="sc-grid">'+cards.join('')+addTile+'</div>'+capNotice;
    }
    v.insertAdjacentHTML('beforeend', '<div class="sc-manage">'+headerNote+grid+'</div>');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     EDITOR
     ══════════════════════════════════════════════════════════════════════════ */
  var EDIT_BADGE = 'featured';
  var STATUS_OPTS = ['Available','Under Contract','Funded','Coming Soon','Closed'];

  function previewObj(){
    var g=function(x){return (document.getElementById(x)||{}).value||'';};
    return {
      title: g('sc_title')||'Untitled Opportunity',
      category: g('sc_cat'), location: g('sc_loc'), summary: g('sc_sum'),
      image_url: g('sc_img'), cta_label: g('sc_ctal'), cta_url: g('sc_ctau'),
      price: g('sc_price'), size_detail: g('sc_size'), opportunity_status: g('sc_ostat'),
      tags: g('sc_tags').split(',').map(function(t){return t.trim();}).filter(Boolean),
      badge: EDIT_BADGE, status:'active', admin_featured:false
    };
  }
  function scPreview(){ var host=document.getElementById('sc_prev'); if(host) host.innerHTML = card(previewObj(),'public'); }

  async function scUpload(inputId, targetId){
    var fi=document.getElementById(inputId); var f=fi&&fi.files&&fi.files[0];
    var btn=document.getElementById('sc_upbtn'), err=document.getElementById('sc_err');
    function status(msg, isErr){ if(err){ err.textContent=msg; err.style.color=isErr?'#c0392b':'var(--green,#2e7d32)'; } console.log('[showcase-upload] '+msg); }
    if(!f){ status('No file selected.', true); return; }
    console.log('[showcase-upload] file:', f.name, f.type, (f.size/1048576).toFixed(2)+'MB');

    if(!window.PegProfileMedia){ status('Upload module not loaded (PegProfileMedia missing). Hard-refresh the page.', true); return; }
    if(window.PegProfileMedia.validate){ var v; try{ window.PegProfileMedia.validate(f); }catch(ve){ status((ve&&ve.message)||'Invalid file', true); return; } if(v&&v.error){ status(v.error,true); return; } }

    if(btn){ btn.disabled=true; btn.textContent='Uploading\u2026'; }
    status('Uploading\u2026', false);
    try{
      var url = await window.PegProfileMedia.upload('showcase', f);
      console.log('[showcase-upload] got URL:', url);
      var t=document.getElementById(targetId); if(t) t.value=url;
      scPreview();
      status('\u2713 Uploaded. Image set.', false);
      /* Verify the URL actually loads (catches private-bucket / 403 cases) */
      var probe=new Image();
      probe.onload=function(){ status('\u2713 Image uploaded and visible.', false); };
      probe.onerror=function(){ status('Uploaded, but the image URL is not publicly readable. The storage bucket may be private \u2014 check Supabase Storage \u201cprofile-media\u201d is set to Public.', true); };
      probe.src=url;
    }catch(e){
      console.error('[showcase-upload] FAILED:', e);
      status((e&&e.message)||'Upload failed \u2014 paste an image URL instead.', true);
    }
    finally{ if(btn){ btn.disabled=false; btn.textContent='Upload image'; } }
  }

  async function edit(id){
    var item = id ? (await listFor(ownerId(),{})).find(function(i){return i.id===id;}) : null;
    EDIT_BADGE = (item && item.badge) || 'featured';
    var cats = categoriesFor(ROLE);
    var opt  = function(v){ return '<option '+((item&&item.category===v)?'selected':'')+'>'+esc(v)+'</option>'; };
    var sopt = function(v){ return '<option value="'+esc(v)+'" '+((item&&item.opportunity_status===v)?'selected':'')+'>'+esc(v)+'</option>'; };
    var bp = MEMBER_BADGES.map(function(b){ return '<div class="sce-bp '+(EDIT_BADGE===b?'on':'')+'" data-b="'+b+'" onclick="PegShowcase.pickBadge(\''+b+'\')">'+esc(BADGES[b])+'</div>'; }).join('');
    var val = function(k){ return item && item[k]!=null ? esc(item[k]) : ''; };
    var tagsVal = (item && item.tags && item.tags.length) ? esc(item.tags.join(', ')) : '';

    window.Pegasus.modal(
      '<div class="sce-scrim" onclick="if(event.target===this)Pegasus.closeModal()"><div class="sce-modal">'+
      '<div class="sce-head"><div class="sce-title">'+(id?'Edit':'New')+' Featured Opportunity</div>'+
        '<button class="sce-x" onclick="Pegasus.closeModal()">\u2715</button></div>'+
      '<div class="sce-grid">'+
        '<div class="sce-form">'+
          '<div class="field"><label class="label">Title</label><input class="input" id="sc_title" maxlength="80" value="'+val('title')+'" placeholder="e.g. Off-Market Industrial Portfolio \u2014 Southwest" oninput="PegShowcase.preview()"></div>'+
          '<div class="row2"><div class="field"><label class="label">Category</label><select class="input" id="sc_cat" onchange="PegShowcase.preview()">'+cats.map(opt).join('')+'</select></div>'+
            '<div class="field"><label class="label">Market / Location</label><input class="input" id="sc_loc" maxlength="80" value="'+val('location')+'" placeholder="Denver, CO" oninput="PegShowcase.preview()"></div></div>'+
          '<div class="row2"><div class="field"><label class="label">Price <span class="opt">(optional)</span></label><input class="input" id="sc_price" value="'+val('price')+'" placeholder="$3.5M  \u00B7  $500K\u2013$2M" oninput="PegShowcase.preview()"></div>'+
            '<div class="field"><label class="label">Size <span class="opt">(optional)</span></label><input class="input" id="sc_size" value="'+val('size_detail')+'" placeholder="48 units \u00B7 12,000 sq ft" oninput="PegShowcase.preview()"></div></div>'+
          '<div class="row2"><div class="field"><label class="label">Status <span class="opt">(optional)</span></label><select class="input" id="sc_ostat" onchange="PegShowcase.preview()"><option value="">\u2014</option>'+STATUS_OPTS.map(sopt).join('')+'</select></div>'+
            '<div class="field"><label class="label">Tags <span class="opt">(comma-separated)</span></label><input class="input" id="sc_tags" maxlength="120" value="'+tagsVal+'" placeholder="DSCR, Value-Add, Multifamily" oninput="PegShowcase.preview()"></div></div>'+
          '<div class="field"><label class="label">Short Summary</label><textarea class="ws-textarea" id="sc_sum" maxlength="400" data-count placeholder="Two or three sentences. Editorial and precise \u2014 what it is and why it matters." oninput="PegShowcase.preview()">'+val('summary')+'</textarea></div>'+
          '<div class="field"><label class="label">Image <span class="opt">(optional)</span></label>'+
            '<div class="sce-imgrow"><input class="input" id="sc_img" value="'+val('image_url')+'" placeholder="Paste an image URL, or upload \u2192" oninput="PegShowcase.preview()">'+
              '<button class="btn btn-ghost btn-sm" id="sc_upbtn" type="button" onclick="document.getElementById(\'sc_imgfile\').click()">Upload image</button>'+
              '<input type="file" id="sc_imgfile" accept="image/*" style="display:none" onchange="PegShowcase.upload(\'sc_imgfile\',\'sc_img\')"></div>'+
            '<div class="sce-hint">JPG, PNG, or WebP \u00b7 up to 10MB</div></div>'+
          '<div class="row2"><div class="field"><label class="label">CTA Label <span class="opt">(optional)</span></label><input class="input" id="sc_ctal" value="'+val('cta_label')+'" placeholder="View Details" oninput="PegShowcase.preview()"></div>'+
            '<div class="field"><label class="label">CTA Link <span class="opt">(optional)</span></label><input class="input" id="sc_ctau" value="'+val('cta_url')+'" placeholder="https://\u2026" oninput="PegShowcase.preview()"></div></div>'+
          '<div class="field"><label class="label">Visibility Badge</label><div class="sce-badge-pick" id="sc_bp">'+bp+'</div>'+
            '<div class="sce-hint">Verified &amp; Ambassador-Reviewed badges are granted by Pegasus review.</div></div>'+
        '</div>'+
        '<div class="sce-preview"><div class="sce-prev-label">Live Preview</div><div id="sc_prev"></div></div>'+
      '</div>'+
      '<div class="sce-foot"><div id="sc_err" class="sce-err"></div>'+
        '<button class="btn btn-ghost" onclick="Pegasus.closeModal()">Cancel</button>'+
        '<button class="btn btn-ghost" id="sc_draft" onclick="PegShowcase.save('+(id?'\''+id+'\'':'null')+',true)">Save as Draft</button>'+
        '<button class="btn btn-pri" id="sc_save" onclick="PegShowcase.save('+(id?'\''+id+'\'':'null')+',false)">'+(id?'Save':'Publish')+' \u2192</button></div>'+
      '</div></div>');
    scPreview();
  }
  function pickBadge(b){ EDIT_BADGE=b; document.querySelectorAll('#sc_bp .sce-bp').forEach(function(e){ e.classList.toggle('on', e.dataset.b===b); }); scPreview(); }

  async function save(id, asDraft){
    var g = function(x){ return (document.getElementById(x)||{}).value||''; };
    var err=document.getElementById('sc_err'), btn=document.getElementById(asDraft?'sc_draft':'sc_save');
    var title=g('sc_title').trim();
    if(!title){ if(err) err.textContent='Give your opportunity a title.'; return; }
    var targetStatus = asDraft ? 'draft' : 'active';
    if(targetStatus==='active'){
      var all = await listFor(ownerId(),{});
      var max = limit();
      var usedActive = all.filter(function(i){return (i.status==='active'||i.status==='pending') && i.id!==id;}).length;
      if(max!==Infinity && usedActive>=max){
        if(err) err.textContent='You\u2019ve filled your '+max+' featured '+(max===1?'opportunity':'opportunities')+'. Save as draft, or elevate your access layer to publish more.';
        return;
      }
    }
    var payload={ title:title, category:g('sc_cat').trim(), location:g('sc_loc').trim(), summary:g('sc_sum').trim(),
      image_url:g('sc_img').trim(), cta_label:g('sc_ctal').trim(), cta_url:g('sc_ctau').trim(),
      price:g('sc_price').trim(), size_detail:g('sc_size').trim(), opportunity_status:g('sc_ostat').trim(),
      tags:g('sc_tags').split(',').map(function(t){return t.trim();}).filter(Boolean),
      badge:EDIT_BADGE, status:targetStatus };
    if(err) err.textContent=''; if(btn){ btn.disabled=true; btn.textContent='Saving\u2026'; }
    try{
      if(id) await update(id, payload); else await create(payload);
      window.Pegasus.closeModal();
      window.Pegasus.toast('\u25C8','var(--blue-dim)', asDraft?'Saved as draft':(id?'Updated':'Published'), title);
      mountManager();
    }catch(e){
      console.error('[PegShowcase] save failed:', e);
      if(btn){ btn.disabled=false; btn.textContent=asDraft?'Save as Draft':((id?'Save':'Publish')+' \u2192'); }
      var m=(e&&e.message)||'Could not save.';
      if(/row-level security|violates|policy/i.test(m)) m='You\u2019ve reached your access layer\u2019s featured limit, or access is syncing. Try saving as draft.';
      if(err) err.textContent=m;
    }
  }

  async function toggleHide(id, status){ try{ await update(id,{status:status==='hidden'?'active':'hidden'}); mountManager(); }catch(e){ window.Pegasus.toast('!','var(--red-dim)','Could not update',''); } }
  function confirmRemove(id){
    window.Pegasus.modal('<div class="scrim" onclick="if(event.target===this)Pegasus.closeModal()"><div class="modal"><div class="modal-head"><div style="font-size:15px;font-weight:600">Remove this opportunity?</div><button class="modal-x" onclick="Pegasus.closeModal()">\u2715</button></div><div class="modal-body"><p style="font-size:13px;color:var(--text2);line-height:1.6">This removes the featured opportunity from your showcase. This cannot be undone.</p></div><div class="modal-foot"><span style="flex:1"></span><button class="btn btn-ghost" onclick="Pegasus.closeModal()">Keep</button><button class="btn btn-pri" style="background:var(--red)" onclick="PegShowcase.doRemove(\''+id+'\')">Remove</button></div></div></div>');
  }
  async function doRemove(id){ try{ await remove(id); window.Pegasus.closeModal(); window.Pegasus.toast('\u2713','var(--green-dim)','Removed',''); mountManager(); }catch(e){ window.Pegasus.toast('!','var(--red-dim)','Could not remove',''); } }

  /* ══════════════════════════════════════════════════════════════════════════
     ADMIN MODERATION (showcase-admin.html)
     ══════════════════════════════════════════════════════════════════════════ */
  async function mountAdmin(){
    var isAdm = window.PegStore && window.PegStore.isAdmin && window.PegStore.isAdmin();
    window.Pegasus.mountApp({ active:'Admin Console', title:'Showcase Moderation', sub:'Curate quality \u00B7 protect the ecosystem' });
    var v = document.getElementById('pegView');
    if(!isAdm){ v.insertAdjacentHTML('beforeend','<div class="gate"><div class="gate-ic">\u26E8</div><h2 class="h2">Admin only</h2><p class="sub" style="text-align:center;margin:8px auto 0">This moderation console requires an admin account.</p></div>'); return; }
    var items = await listForModeration();
    var flagged = items.filter(function(i){return i.status==='flagged'||i.status==='pending';});
    var rest = items.filter(function(i){return i.status!=='flagged'&&i.status!=='pending';});
    function block(title, arr){
      return '<section class="sc-section"><div class="sc-head"><div class="sc-title">'+title+'</div><span class="sc-count">'+arr.length+'</span></div>'+
        (arr.length?'<div class="sc-grid">'+arr.map(function(it){return card(it,'admin');}).join('')+'</div>':'<div class="sc-empty"><div class="sc-empty-t" style="font-size:14px">Nothing here</div></div>')+'</section>';
    }
    v.insertAdjacentHTML('beforeend', block('Needs Review', flagged) + block('All Showcase Items', rest));
  }
  async function adminAct(id, action){ try{ await moderate(id, action); window.Pegasus.toast('\u26E8','var(--blue-dim)','Updated', cap(action)); mountAdmin(); }catch(e){ window.Pegasus.toast('!','var(--red-dim)','Action failed',(e&&e.message)||''); } }
  function adminRemove(id){ confirmRemove(id); /* reuse modal; doRemove works for admin via RLS */ }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window.PegShowcase = {
    BADGES, MEMBER_BADGES, categoriesFor,
    listFor, create, update, remove, moderate,
    sectionHtml, mountInto, mountManager, mountAdmin,
    edit, pickBadge, save, preview:scPreview, upload:scUpload, toggleHide, confirmRemove, doRemove, adminAct, adminRemove,
  };
})();
