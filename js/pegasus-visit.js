/* ============================================================================
   PEGASUS — privacy-safe, first-party visit signal (localStorage only).
   - No third-party trackers, no advertising cookies, no fingerprinting.
   - Stores only non-sensitive functional data so the front page can tell a
     new visitor from a returning one and lightly personalize.
   - Logged-in state is recorded ONLY as a boolean flag. Identity, email,
     tokens, and any private profile data never go in here — those come from
     auth/profile at runtime, never from this store.
   Keys recorded: first_visit_at, last_visit_at, prev_visit_at, visit_count,
   last_entry_path, first_source, last_source, logged_in.
   ========================================================================== */
(function(){
  'use strict';
  var KEY='pegasus.visit';
  function nowISO(){ try{ return new Date().toISOString(); }catch(e){ return ''; } }
  function read(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ return {}; } }
  function write(v){ try{ localStorage.setItem(KEY, JSON.stringify(v)); }catch(e){} }

  /* Coarse, non-identifying entry source — a referrer hostname or a utm/ref
     query value, capped in length. Never a full URL or query string. */
  function sourceOf(){
    try{
      var qs=new URLSearchParams(location.search||'');
      var utm=qs.get('utm_source')||qs.get('ref')||qs.get('source');
      if(utm) return String(utm).toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,48) || 'direct';
      var r=document.referrer||'';
      if(!r) return 'direct';
      var h=''; try{ h=new URL(r).hostname; }catch(_){}
      if(!h) return 'direct';
      if(h.indexOf(location.hostname)>=0) return 'internal';
      return h.replace(/^www\./,'').slice(0,48);
    }catch(e){ return 'direct'; }
  }

  /* Non-sensitive boolean only — derived from the presence of an auth token,
     never storing the token or any identity here. */
  function loggedIn(){
    try{
      var raw=localStorage.getItem('pegasus.auth'); if(!raw) return false;
      var pj=JSON.parse(raw);
      return !!(pj && (pj.access_token||(pj.currentSession&&pj.currentSession.access_token)));
    }catch(e){ return false; }
  }

  var v=read(), t=nowISO();
  var isReturning=!!v.first_visit_at;
  if(!v.first_visit_at) v.first_visit_at=t;
  v.prev_visit_at  = v.last_visit_at || '';
  v.last_visit_at  = t;
  v.visit_count    = (v.visit_count||0)+1;
  v.last_entry_path= (location.pathname||'/').slice(0,200);
  if(!v.first_source) v.first_source=sourceOf();
  v.last_source    = sourceOf();
  v.logged_in      = loggedIn();
  write(v);

  window.PegasusVisit={
    get:function(){ return read(); },
    isReturning:function(){ return isReturning; },
    isNew:function(){ return !isReturning; },
    count:function(){ var r=read(); return r.visit_count||0; }
  };
})();
