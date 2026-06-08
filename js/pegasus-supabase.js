/* PEGASUS v69 — Supabase client (single instance). Loads supabase-js from CDN
   if not already present. window.PegSB resolves to the client (or null in
   pure-preview if the CDN/credentials are unavailable). */
(function(){
  const C = window.PEG_CONFIG;
  let client = null, ready;
  function load(){
    if(window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((res)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload=()=>res(); s.onerror=()=>res(); document.head.appendChild(s);
    });
  }
  ready = load().then(()=>{
    try{
      if(window.supabase && C.SUPABASE_URL && C.SUPABASE_ANON){
        client = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON, {
          auth:{ persistSession:true, autoRefreshToken:true, storageKey:'pegasus.auth' }
        });
      }
    }catch(e){ client=null; }
    return client;
  });
  window.PegSB = { ready, get:()=>client };
})();
