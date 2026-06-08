/* PEGASUS v69 — Tier entitlements (UX gating mirror of server RLS) */
window.PEG_TIERS = {
  starter:{ key:'starter', name:'Starter', layer:'Network Access Layer', monthly:20, annual:168, dot:'#6A90B4', color:'var(--text2)',
    limits:{ dealRooms:0, aiQueries:20, matchRequests:2, matchEngine:'none', analytics:'basic', featured:false, showcase:1 } },
  pro:{ key:'pro', name:'Pro', layer:'Professional Access Layer', monthly:50, annual:420, dot:'#3A8FE8', color:'var(--blue-lt)',
    limits:{ dealRooms:2, aiQueries:Infinity, matchRequests:20, matchEngine:'standard', analytics:'enhanced', featured:false, showcase:3 } },
  gold:{ key:'gold', name:'Gold', layer:'Institutional Access Layer', monthly:100, annual:840, dot:'#AA8926', color:'var(--gold)',
    limits:{ dealRooms:Infinity, aiQueries:Infinity, matchRequests:Infinity, matchEngine:'full', analytics:'institutional', featured:true, showcase:5 } },
};
window.PEG_FEATS = {
  starter:[['Network profile + directory',1],['AI concierge · 20 queries/mo',1],['DSCR & capital calculators',1],['Live marketplace activity',1],['Pegasus Deal Rooms™',0],['Pegasus Match Engine',0]],
  pro:[['Everything in Starter',1],['Unlimited AI intelligence',1],['Up to 2 active Deal Rooms',1],['Standard Match Engine',1],['Priority matching queue',1],['Real-time lender matching',0]],
  gold:[['Everything in Pro',1],['Unlimited Deal Rooms',1],['Full Pegasus Match Engine',1],['Real-time lender matching',1],['Priority network visibility',1],['Advanced analytics + white-glove',1]],
};
