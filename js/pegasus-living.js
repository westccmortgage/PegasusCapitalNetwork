/* Pegasus living environment — constellation + ambient signals + telemetry (shared) */

/* Living World — Pegasus constellation environment (interaction through the environment) */
(function(){
  var c=document.getElementById("cinCanvas"); if(!c) return;
  var ctx=c.getContext("2d"); if(!ctx) return;
  var sec=c.parentElement, DPR=Math.min(window.devicePixelRatio||1,2);
  var W=0,H=0,stars=[],clouds=[],fg=[],pulses=[],t0=0,reduce=false,energy=0;
  try{reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;}catch(e){}
  var CPTS=[[0,0],[-0.12,-0.2],[-0.36,-0.34],[-0.6,-0.4],[-0.84,-0.3],[-0.42,-0.04],[-0.66,-0.06],[0.26,-0.16],[0.46,-0.3],[0.56,-0.46],[0.2,0.16],[0.46,0.26],[0.7,0.2],[0.06,0.36],[0.32,0.4]];
  var CEDGES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[2,5],[0,7],[7,8],[8,9],[0,10],[10,11],[11,12],[0,13],[10,14]];
  function rnd(a,b){return a+Math.random()*(b-a);}
  function build(){
    stars=[]; var n=Math.min(150,Math.floor(W*H/8500));
    for(var i=0;i<n;i++){var d=rnd(.2,1);stars.push({x:rnd(0,W),y:rnd(0,H),r:.4+d*1.1,a:.12+d*.4,tw:rnd(.3,.8),ph:rnd(0,6.28),d:d});}
    clouds=[]; for(var ci=0;ci<3;ci++)clouds.push({x:rnd(0,W),y:rnd(H*.3,H*.85),rx:rnd(W*.28,W*.55),ry:rnd(H*.14,H*.24),a:rnd(.03,.06),sp:rnd(.003,.008)*(Math.random()<.5?-1:1)});
    fg=[]; for(var fi=0;fi<5;fi++)fg.push({x:rnd(0,W),y:rnd(0,H),r:rnd(40,90),a:rnd(.015,.04),sp:rnd(.004,.01)*(Math.random()<.5?-1:1),vy:rnd(-.003,.003)});
    pulses=[];
  }
  function size(){var r=sec.getBoundingClientRect();W=r.width;H=r.height;c.width=W*DPR;c.height=H*DPR;c.style.width=W+"px";c.style.height=H+"px";ctx.setTransform(DPR,0,0,DPR,0,0);build();}
  function env(p){ if(p<.35)return p/.35; if(p<.65)return 1; if(p<.85)return 1-(p-.65)/.2; return 0; }
  window.cinEnergize=function(){ energy=Math.min(1,energy+.6); };
  function nodePos(idx,ts){var cx=W*.5,cy=H*.4,sc=Math.min(W,H)*0.36,rot=reduce?0:Math.sin(ts*.00006)*0.05,x=CPTS[idx][0],y=CPTS[idx][1],ca=Math.cos(rot),sa=Math.sin(rot);return {x:cx+(x*ca-y*sa)*sc,y:cy+(x*sa+y*ca)*sc};}
  function frame(ts){
    if(document.hidden){if(!reduce)requestAnimationFrame(frame);return;}
    var dt=ts-(t0||ts);t0=ts;if(dt>60)dt=60;ctx.clearRect(0,0,W,H);
    if(!reduce)energy*=Math.pow(.97,dt/16.67);
    for(var ci=0;ci<clouds.length;ci++){var cl=clouds[ci];if(!reduce)cl.x+=cl.sp*dt;if(cl.x<-cl.rx)cl.x=W+cl.rx;if(cl.x>W+cl.rx)cl.x=-cl.rx;
      var cg=ctx.createRadialGradient(cl.x,cl.y,0,cl.x,cl.y,cl.rx);cg.addColorStop(0,"rgba(46,104,168,"+cl.a+")");cg.addColorStop(1,"rgba(46,104,168,0)");
      ctx.fillStyle=cg;ctx.save();ctx.translate(cl.x,cl.y);ctx.scale(1,cl.ry/cl.rx);ctx.beginPath();ctx.arc(0,0,cl.rx,0,6.2832);ctx.fill();ctx.restore();}
    for(var i=0;i<stars.length;i++){var s=stars[i];var x=s.x-(reduce?0:((ts*.0015*s.d)%(W+20)));if(x<-10)x+=W+20;
      var tw=reduce?1:(.78+.22*Math.sin(ts*.0006*s.tw+s.ph));ctx.globalAlpha=s.a*tw;ctx.fillStyle="#cfe0ff";ctx.beginPath();ctx.arc(x,s.y,s.r,0,6.2832);ctx.fill();}
    ctx.globalAlpha=1;
    var cyc=reduce?0.5:((ts%16000)/16000),formed=reduce?1:env(cyc);
    var lineA=Math.min(.5,(.05+formed*.13)+energy*.22), nodeA=(.3+formed*.4)+energy*.3;
    ctx.strokeStyle="rgba(150,190,240,"+lineA+")";ctx.lineWidth=1;
    for(var e=0;e<CEDGES.length;e++){var a=nodePos(CEDGES[e][0],ts),b=nodePos(CEDGES[e][1],ts);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    for(var k=0;k<CPTS.length;k++){var p=nodePos(k,ts),rr=1.6+(k===0?1:0)+Math.sin(ts*.0009+k)*0.4;
      var ng=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,rr*5);ng.addColorStop(0,"rgba(205,167,72,"+Math.min(.95,nodeA)+")");ng.addColorStop(.5,"rgba(205,167,72,"+Math.min(.3,nodeA*.3)+")");ng.addColorStop(1,"rgba(205,167,72,0)");
      ctx.fillStyle=ng;ctx.beginPath();ctx.arc(p.x,p.y,rr*5,0,6.2832);ctx.fill();
      ctx.fillStyle="rgba(240,220,150,"+Math.min(1,nodeA+.15)+")";ctx.beginPath();ctx.arc(p.x,p.y,rr*.85,0,6.2832);ctx.fill();}
    if(!reduce&&energy>.2&&pulses.length<4&&Math.random()<.05){pulses.push({e:CEDGES[(Math.random()*CEDGES.length)|0],t:0,sp:rnd(.0014,.0026)});}
    for(var pi=pulses.length-1;pi>=0;pi--){var pu=pulses[pi];if(!reduce)pu.t+=pu.sp*dt;if(pu.t>1){pulses.splice(pi,1);continue;}
      var a2=nodePos(pu.e[0],ts),b2=nodePos(pu.e[1],ts),px=a2.x+(b2.x-a2.x)*pu.t,py=a2.y+(b2.y-a2.y)*pu.t,fd=Math.sin(pu.t*Math.PI);
      var pg=ctx.createRadialGradient(px,py,0,px,py,5);pg.addColorStop(0,"rgba(180,215,255,"+(.85*fd)+")");pg.addColorStop(1,"rgba(180,215,255,0)");ctx.fillStyle=pg;ctx.beginPath();ctx.arc(px,py,5,0,6.2832);ctx.fill();}
    for(var fi=0;fi<fg.length;fi++){var fp=fg[fi];if(!reduce){fp.x+=fp.sp*dt;fp.y+=fp.vy*dt;}if(fp.x<-fp.r)fp.x=W+fp.r;if(fp.x>W+fp.r)fp.x=-fp.r;
      var fgr=ctx.createRadialGradient(fp.x,fp.y,0,fp.x,fp.y,fp.r);fgr.addColorStop(0,"rgba(120,150,210,"+fp.a+")");fgr.addColorStop(1,"rgba(120,150,210,0)");ctx.fillStyle=fgr;ctx.beginPath();ctx.arc(fp.x,fp.y,fp.r,0,6.2832);ctx.fill();}
    if(!reduce)requestAnimationFrame(frame);
  }
  size(); if(reduce){frame(0);}else{requestAnimationFrame(frame);}
  var rt;window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(size,200);});
})();
/* Network telemetry — institutional, unhurried */
(function(){
  var box=document.getElementById("cinTele"); if(!box) return; var txt=box.querySelector(".ttext"); if(!txt) return;
  var msgs=["Private credit mandate under review","Cross-border introduction in progress","Family-office allocation session \u2014 APAC","Development capital syndicate forming","Bridge facility inquiry received","Institutional desk online \u2014 New York","Discreet opportunity added to the network","Strategic relationship initiated"];
  var i=Math.floor(Math.random()*msgs.length);
  function show(){txt.textContent=msgs[i%msgs.length];txt.classList.add("show");}
  show(); var reduce=false; try{reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;}catch(e){}
  if(!reduce) setInterval(function(){txt.classList.remove("show");setTimeout(function(){i++;show();},650);},6500);
})();


/* Ambient ecosystem signals — distant, subconscious, never notifications */
(function(){
  var host=document.getElementById("cinSignals"); if(!host) return;
  var reduce=false; try{reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;}catch(e){}
  if(reduce) return;
  var msgs=["Private introduction forming \u2014 Dubai","Institutional relationship activated \u2014 London","Strategic visibility request \u2014 Los Angeles","Capital alignment in progress \u2014 Miami","Founder session opening \u2014 Abu Dhabi","Private credit dialogue \u2014 Singapore","Cross-border introduction \u2014 New York","Family-office review \u2014 Geneva"];
  var spots=[[8,16],[70,20],[12,66],[74,68],[9,40],[78,44]];
  var mi=Math.floor(Math.random()*msgs.length), si=0, active=0;
  function emit(){
    if(document.hidden||active>=2) return;
    var sp=spots[si%spots.length]; si++;
    var el=document.createElement("div"); el.className="cin-signal";
    el.style.left=sp[0]+"%"; el.style.top=sp[1]+"%"; el.textContent=msgs[mi%msgs.length]; mi++;
    host.appendChild(el); active++;
    requestAnimationFrame(function(){el.classList.add("show");});
    setTimeout(function(){ el.classList.remove("show"); setTimeout(function(){ if(el.parentNode)el.parentNode.removeChild(el); active--; },2200); },4200);
  }
  setTimeout(emit,2500); setInterval(emit,6000);
})();
