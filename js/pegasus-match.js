/* ============================================================================
   PEGASUS v69 — Match Engine scoring
   Computes Capital Alignment, Deal Strength, Funding Probability,
   Documentation Readiness, Risk Level. Institutional language only.
   ============================================================================ */
(function(){
  // deal: {loanType, amount, state, assetType, ltv, dscr, constructionStage, timeline, exit, sponsorYears, docsReady(0-100)}
  // appetite: {loanTypes[], states[], min, max, maxLTV, assetTypes[], dscrMin, constructionOK, bridgeOK, prefSponsorYears}
  function scoreMatch(deal, ap){
    let pts=0, max=0; const add=(w,ok)=>{max+=w; if(ok)pts+=w; return ok;};
    const loanOK   = add(20, ap.loanTypes.includes(deal.loanType));
    const stateOK  = add(14, ap.states.includes('ALL')||ap.states.includes(deal.state));
    const sizeOK   = add(14, deal.amount>=ap.min && deal.amount<=ap.max);
    const assetOK  = add(12, ap.assetTypes.includes(deal.assetType));
    const ltvOK    = add(14, deal.ltv<=ap.maxLTV);
    const dscrOK   = add(12, deal.dscr>=ap.dscrMin);
    const constOK  = add(7,  deal.loanType!=='Construction' || ap.constructionOK);
    const bridgeOK = add(7,  deal.loanType!=='Bridge' || ap.bridgeOK);
    const alignment = Math.round((pts/max)*100);

    // Deal Strength: DSCR coverage, leverage (lower=stronger), sponsor experience, exit clarity
    let str=0;
    str += Math.min(30, Math.max(0,(deal.dscr-1.0)/0.6*30));        // 1.0->0, 1.6+->30
    str += Math.min(28, Math.max(0,(0.85-deal.ltv/100)/0.35*28));   // 50% LTV strong, 85% weak
    str += Math.min(24, (deal.sponsorYears/15)*24);                  // experience
    str += deal.exit && deal.exit!=='Undefined' ? 18 : 6;            // exit clarity
    const strength = Math.round(Math.min(100,str));

    const funding = Math.round(alignment*0.6 + strength*0.4);
    const docs = Math.round(deal.docsReady||0);

    // Risk
    let r=0;
    if(deal.ltv>80)r+=2; else if(deal.ltv>70)r+=1;
    if(deal.dscr<1.15)r+=2; else if(deal.dscr<1.25)r+=1;
    if(deal.loanType==='Construction' && deal.constructionStage!=='Complete')r+=1;
    if(deal.sponsorYears<3)r+=1;
    const risk = r>=4?'Elevated':r>=2?'Moderate':'Low';

    const fit = alignment>=85?{label:'High Alignment',cls:'tag-g',color:'var(--green)'}
      : alignment>=70?{label:'Strong Fit',cls:'tag-b',color:'var(--blue-lt)'}
      : alignment>=50?{label:'Conditional Fit',cls:'tag-a',color:'var(--amber)'}
      : {label:'Manual Review',cls:'tag-r',color:'var(--red)'};

    const flags=[];
    if(!loanOK)flags.push('Loan type outside appetite');
    if(!stateOK)flags.push('State not served');
    if(!sizeOK)flags.push('Loan size outside band');
    if(!ltvOK)flags.push('LTV exceeds maximum');
    if(!dscrOK)flags.push('DSCR below minimum');
    if(!assetOK)flags.push('Asset type not preferred');

    return { alignment, strength, funding, docs, risk, fit, flags };
  }

  // demo lender appetite profiles for the engine UI
  const APPETITES = [
    { name:'Capital Lender A', loanTypes:['Construction','Bridge','DSCR'], states:['TX','AZ','FL'], min:1e6, max:15e6, maxLTV:80, assetTypes:['Multifamily','Mixed-Use','Retail'], dscrMin:1.20, constructionOK:true, bridgeOK:true, prefSponsorYears:3, rate:'10.25%' },
    { name:'Capital Lender B',     loanTypes:['DSCR','Bridge'],                states:['ALL'],          min:5e5, max:5e6,  maxLTV:80, assetTypes:['Multifamily','SFR','Retail'],     dscrMin:1.10, constructionOK:false, bridgeOK:true, prefSponsorYears:1, rate:'7.00%' },
    { name:'Capital Lender C',   loanTypes:['Construction'],                 states:['TX'],           min:2e6, max:25e6, maxLTV:82, assetTypes:['Multifamily','Mixed-Use'],        dscrMin:1.15, constructionOK:true, bridgeOK:false, prefSponsorYears:5, rate:'10.50%' },
    { name:'Pacific Multifamily Cap',  loanTypes:['DSCR','Permanent'],             states:['ALL'],          min:1e6, max:30e6, maxLTV:75, assetTypes:['Multifamily'],                     dscrMin:1.25, constructionOK:false, bridgeOK:false, prefSponsorYears:2, rate:'7.25%' },
    { name:'Capital Lender D',   loanTypes:['Bridge','DSCR'],                states:['ALL'],          min:5e5, max:10e6, maxLTV:78, assetTypes:['Multifamily','Mixed-Use','Office'],dscrMin:1.15, constructionOK:false, bridgeOK:true, prefSponsorYears:2, rate:'7.50%' },
  ];

  window.PegasusMatch = { scoreMatch, APPETITES };
})();
