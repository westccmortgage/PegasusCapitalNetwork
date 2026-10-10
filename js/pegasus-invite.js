/* ============================================================================
   Pegasus — "Invite colleagues" card (member referrals)
   js/pegasus-invite.js
   PegInvite.mount(hostEl): signed-in, active members invite up to 5 people at a
   time (≤10/day, ≤50 total — enforced server-side in invite_colleagues()).
   Invitations are emailed by the network on the member's behalf (referral-
   sender), consent-first: nothing is created until the invitee confirms.
   Shows the member's sent invitations and their status (get_my_referrals).
   ========================================================================== */
(function(){
  'use strict';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  var CSS='.pi-card{background:var(--bg1);border:1px solid var(--border);border-radius:var(--r3);padding:16px 18px;box-shadow:var(--sh-card)}'+
    '.pi-t{font-family:var(--serif);font-size:17px;color:var(--text);margin:0 0 3px}'+
    '.pi-s{font-size:12px;color:var(--text3);line-height:1.5;margin-bottom:10px}'+
    '.pi-row{display:flex;gap:6px;margin-bottom:6px}'+
    '.pi-in{flex:1;min-width:0;background:var(--bg1);border:1px solid var(--border);border-radius:var(--r2);padding:8px 10px;color:var(--text);font-size:12.5px;font-family:inherit;outline:none}'+
    '.pi-in:focus{border-color:var(--blue)}.pi-in.nm{flex:.8}'+
    '.pi-ta{width:100%;min-height:52px;resize:vertical;margin-top:4px}'+
    '.pi-add{border:none;background:none;color:var(--blue);font-size:11.5px;cursor:pointer;padding:2px 0;font-family:inherit}'+
    '.pi-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;flex-wrap:wrap}'+
    '.pi-msg{font-size:11.5px;margin-top:8px;line-height:1.5;color:var(--text3)}.pi-msg.err{color:var(--gold)}.pi-msg.ok{color:var(--green)}'+
    '.pi-list{margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}'+
    '.pi-lh{font-size:9px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text4);margin-bottom:6px}'+
    '.pi-li{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:4px 0;color:var(--text2)}'+
    '.pi-li .e{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
    '.pi-st{font-size:9.5px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text4);white-space:nowrap}'+
    '.pi-st.joined,.pi-st.accepted{color:var(--green)}.pi-st.declined{color:var(--text4)}';
  function css(){ if(document.getElementById('pi-css')) return; var s=document.createElement('style'); s.id='pi-css'; s.textContent=CSS; document.head.appendChild(s); }
  var LBL={queued:'queued',invited:'invited',accepted:'accepted',joined:'joined',declined:'declined'};

  function row(i){ return '<div class="pi-row"><input class="pi-in em" type="email" placeholder="colleague@company.com" aria-label="Email '+i+'"><input class="pi-in nm" type="text" maxlength="120" placeholder="Name (optional)" aria-label="Name '+i+'"></div>'; }

  async function mount(host){
    if(!host) return;
    var sb=null; try{ sb=await window.PegSB.ready; }catch(e){ return; }
    var ses=null; try{ ses=(await sb.auth.getSession()).data.session; }catch(e){}
    if(!ses){ host.innerHTML=''; return; }
    css();
    var n=1;
    function render(){
      var rows=''; for(var i=1;i<=n;i++) rows+=row(i);
      host.innerHTML='<div class="pi-card"><div class="pi-t">Invite colleagues</div>'+
        '<div class="pi-s">Know a lender, broker, developer, or investor who should be here? We’ll send them a short invitation from the network that names you. Nothing is created unless they accept.</div>'+
        '<div id="piRows">'+rows+'</div>'+(n<5?'<button class="pi-add" type="button" id="piAdd">+ Add another</button>':'')+
        '<textarea class="pi-in pi-ta" id="piNote" maxlength="300" placeholder="Personal note (optional) — e.g. why you think they’d find it useful"></textarea>'+
        '<div class="pi-foot"><span class="pi-st">Up to 10 invites a day</span><button class="btn btn-pri btn-sm" type="button" id="piSend">Send invitations</button></div>'+
        '<div class="pi-msg" id="piMsg"></div><div id="piList"></div></div>';
      var add=document.getElementById('piAdd'); if(add) add.onclick=function(){ var keep=collect(); n=Math.min(5,n+1); render(); restore(keep); };
      document.getElementById('piSend').onclick=send;
      list();
    }
    function collect(){ var em=host.querySelectorAll('.pi-in.em'), nm=host.querySelectorAll('.pi-in.nm'), out=[]; for(var i=0;i<em.length;i++) out.push({email:em[i].value.trim(),name:(nm[i]&&nm[i].value.trim())||''}); return {items:out,note:(document.getElementById('piNote')||{}).value||''}; }
    function restore(k){ var em=host.querySelectorAll('.pi-in.em'), nm=host.querySelectorAll('.pi-in.nm'); k.items.forEach(function(it,i){ if(em[i]) em[i].value=it.email; if(nm[i]) nm[i].value=it.name; }); var t=document.getElementById('piNote'); if(t) t.value=k.note; }
    async function send(){
      var btn=document.getElementById('piSend'), msg=document.getElementById('piMsg');
      var k=collect(); var items=k.items.filter(function(x){ return x.email; });
      if(!items.length){ msg.className='pi-msg err'; msg.textContent='Add at least one email address.'; return; }
      btn.disabled=true; btn.textContent='Sending…'; msg.className='pi-msg'; msg.textContent='';
      try{
        var r=await sb.rpc('invite_colleagues',{p_invites:items,p_note:k.note.trim()||null});
        if(r.error) throw r.error;
        var d=r.data||{};
        var skipped=(d.skipped||[]).map(function(s){ return esc(s.email)+' — '+esc(s.reason); });
        if(d.added>0){
          n=1; render();
          var m2=document.getElementById('piMsg'); m2.className='pi-msg ok';
          m2.innerHTML='✓ '+d.added+' invitation'+(d.added===1?'':'s')+' on the way.'+(skipped.length?'<br><span style="color:var(--text3)">Skipped: '+skipped.join('; ')+'</span>':'');
        }else{
          msg.className='pi-msg err'; msg.innerHTML=esc(d.message||'No invitations were sent.')+(skipped.length?'<br>'+skipped.join('; '):'');
          btn.disabled=false; btn.textContent='Send invitations';
        }
      }catch(e){ msg.className='pi-msg err'; msg.textContent='Could not send right now. Please try again.'; btn.disabled=false; btn.textContent='Send invitations'; }
    }
    async function list(){
      var host2=document.getElementById('piList'); if(!host2) return;
      try{
        var r=await sb.rpc('get_my_referrals'); var rows=(r&&Array.isArray(r.data))?r.data:[];
        if(!rows.length){ host2.innerHTML=''; return; }
        host2.innerHTML='<div class="pi-list"><div class="pi-lh">Your invitations ('+rows.length+')</div>'+rows.slice(0,8).map(function(x){
          return '<div class="pi-li"><span class="e">'+esc(x.full_name||x.email)+'</span><span class="pi-st '+esc(x.status)+'">'+esc(LBL[x.status]||x.status)+'</span></div>';
        }).join('')+'</div>';
      }catch(e){}
    }
    render();
  }
  window.PegInvite={ mount:mount };
})();
