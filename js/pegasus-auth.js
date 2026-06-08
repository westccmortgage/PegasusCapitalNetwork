/* ============================================================================
   PEGASUS v69 — Auth. Real Supabase auth with graceful preview fallback.
   ============================================================================ */
(function(){
  const SB = window.PegSB; const C = window.PEG_CONFIG;
  async function client(){ return await SB.ready; }

  async function signUp({email,password,full_name,role,access_code}){
    const sb = await client(); if(!sb) throw new Error('Auth unavailable');
    const redirectTo = (typeof window!=='undefined' && window.location && window.location.origin)
      ? window.location.origin + '/auth-callback.html'
      : 'https://pegasuscapitalnetwork.com/auth-callback.html';
    const meta = { full_name, role };
    if(access_code) meta.access_code = access_code;
    const { data, error } = await sb.auth.signUp({ email, password,
      options:{ data:meta, emailRedirectTo: redirectTo } });
    if(error) throw error; return data;
  }
  async function signIn({email,password}){
    const sb = await client(); if(!sb) throw new Error('Auth unavailable');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error) throw error; return data;
  }
  async function signOut(){
    const sb = await client(); if(sb) await sb.auth.signOut();
    try{ localStorage.removeItem('pegasus.auth'); }catch(e){}
    location.href='/';
  }
  async function signInWithGoogle(){
    const sb = await client(); if(!sb) throw new Error('Auth unavailable');
    const redirectTo = (typeof window!=='undefined' && window.location && window.location.origin)
      ? window.location.origin + '/auth-callback.html'
      : 'https://pegasuscapitalnetwork.com/auth-callback.html';
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo }
    });
    if(error) throw error; return data;
  }
  async function getSession(){
    const sb = await client(); if(!sb) return null;
    const { data } = await sb.auth.getSession(); return data ? data.session : null;
  }
  function onChange(cb){ client().then(sb=>{ if(sb) sb.auth.onAuthStateChange((_e,s)=>cb(s)); }); }

  // route guards — call at top of a page; redirect if unmet (unless demo fallback)
  async function requireAuth(){
    const s = await getSession();
    if(!s){ if(C.ALLOW_DEMO_FALLBACK) return null; location.href='/'; }
    return s;
  }
  window.PegAuth = { signUp, signIn, signOut, signInWithGoogle, getSession, onChange, requireAuth };
})();
