// ---------------------------------------------------------------------------
// Cube Clock -- timer, scrambles, sessions, statistics.
//
// Every solve is stored locally in this browser and never leaves the device.
// Only a player's BEST figures per puzzle are published to the shared
// leaderboard, and only when they actually change.
// ---------------------------------------------------------------------------

import * as LB from "./leaderboard.js";

(function(){
  "use strict";

  /* Other players' names are untrusted input rendered into innerHTML. */
  function esc(v){
    return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  /* ============ vectors ============ */
  function sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
  function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  function norm(a){ var m=Math.sqrt(dot(a,a)); return [a[0]/m,a[1]/m,a[2]/m]; }
  function lerp3(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
  function mean3(pts){
    var s=[0,0,0], i;
    for(i=0;i<pts.length;i++){ s[0]+=pts[i][0]; s[1]+=pts[i][1]; s[2]+=pts[i][2]; }
    return [s[0]/pts.length, s[1]/pts.length, s[2]/pts.length];
  }

  /* ============ colours, taken from the real puzzles ============ */
  var STK = { w:"#FCFCFC", y:"#FFD500", r:"#C8102E", o:"#FF5800", b:"#0051BA", g:"#009E60", p:"#8B5CF6" };

  var PUZZLES = [
    { id:"222",  name:"2x2",      n:2, kind:"cube", faces:[STK.r, STK.b, STK.w], accent:STK.r },
    { id:"333",  name:"3x3",      n:3, kind:"cube", faces:[STK.r, STK.b, STK.w], accent:STK.b },
    { id:"444",  name:"4x4",      n:4, kind:"cube", faces:[STK.r, STK.b, STK.w], accent:STK.g },
    { id:"555",  name:"5x5",      n:5, kind:"cube", faces:[STK.r, STK.b, STK.w], accent:STK.o },
    { id:"pyra", name:"Pyraminx", kind:"pyra", faces:[STK.b, STK.y], accent:STK.y },
    { id:"mega", name:"Megaminx", kind:"mega", accent:STK.p }
  ];
  var BY_ID = {};
  PUZZLES.forEach(function(p){ BY_ID[p.id] = p; });

  /* ============ svg helpers ============ */
  function poly(pts, fill, shrink){
    var cx=0, cy=0, i;
    for(i=0;i<pts.length;i++){ cx+=pts[i][0]; cy+=pts[i][1]; }
    cx/=pts.length; cy/=pts.length;
    var d=[];
    for(i=0;i<pts.length;i++){
      d.push((cx+(pts[i][0]-cx)*shrink).toFixed(2)+","+(cy+(pts[i][1]-cy)*shrink).toFixed(2));
    }
    return '<polygon points="'+d.join(" ")+'" fill="'+fill+'" stroke="'+fill+'" stroke-width="1.2" stroke-linejoin="round"/>';
  }
  function vbox(pts, pad){
    var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
    var x0=Math.min.apply(null,xs)-pad, y0=Math.min.apply(null,ys)-pad;
    var x1=Math.max.apply(null,xs)+pad, y1=Math.max.apply(null,ys)+pad;
    return x0.toFixed(2)+" "+y0.toFixed(2)+" "+(x1-x0).toFixed(2)+" "+(y1-y0).toFixed(2);
  }

  /* ---- cube: proper isometric basis (three axes 120 degrees apart) ---- */
  function cubeSVG(n, faces){
    var u=20, K=0.8660254;
    var ex=[K*u, 0.5*u], ey=[-K*u, 0.5*u], ez=[0, -u];
    function P(x,y,z){ return [x*ex[0]+y*ey[0]+z*ez[0], x*ex[1]+y*ey[1]+z*ez[1]]; }
    var hex=[P(0,0,n), P(n,0,n), P(n,0,0), P(n,n,0), P(0,n,0), P(0,n,n)];
    var s='<svg viewBox="'+vbox(hex,4)+'" aria-hidden="true">';
    s += poly(hex, "var(--plastic)", 1);
    var i,j;
    for(i=0;i<n;i++) for(j=0;j<n;j++)             // top, z = n
      s += poly([P(i,j,n), P(i+1,j,n), P(i+1,j+1,n), P(i,j+1,n)], faces[0], 0.86);
    for(i=0;i<n;i++) for(j=0;j<n;j++)             // left, y = n
      s += poly([P(i,n,j), P(i+1,n,j), P(i+1,n,j+1), P(i,n,j+1)], faces[1], 0.86);
    for(i=0;i<n;i++) for(j=0;j<n;j++)             // right, x = n
      s += poly([P(n,i,j), P(n,i+1,j), P(n,i+1,j+1), P(n,i,j+1)], faces[2], 0.86);
    return s+"</svg>";
  }

  /* ---- pyraminx: regular tetrahedron, two faces visible ---- */
  function pyraSVG(faces){
    var S=50;
    var T=[0,-1.343*S], B0=[0,0.38*S], B1=[-0.866*S,-0.19*S], B2=[0.866*S,-0.19*S];
    function lat(A,Q,R,r,i){
      return [ A[0]+((r-i)/3)*(Q[0]-A[0])+(i/3)*(R[0]-A[0]),
               A[1]+((r-i)/3)*(Q[1]-A[1])+(i/3)*(R[1]-A[1]) ];
    }
    function tri9(A,Q,R,color){
      var out="", r, k;
      for(r=0;r<3;r++){
        for(k=0;k<=r;k++) out += poly([lat(A,Q,R,r,k), lat(A,Q,R,r+1,k), lat(A,Q,R,r+1,k+1)], color, 0.84);
        for(k=0;k<r;k++)  out += poly([lat(A,Q,R,r,k), lat(A,Q,R,r,k+1), lat(A,Q,R,r+1,k+1)], color, 0.84);
      }
      return out;
    }
    var s='<svg viewBox="'+vbox([T,B0,B1,B2],4)+'" aria-hidden="true">';
    s += poly([T,B1,B0,B2], "var(--plastic)", 1);
    s += tri9(T,B1,B0,faces[0]);
    s += tri9(T,B0,B2,faces[1]);
    return s+"</svg>";
  }

  /* ---- megaminx: a real dodecahedron, front face plus its five neighbours ---- */
  var DODECA = (function(){
    var P=(1+Math.sqrt(5))/2, iP=1/P, V=[], CEN=[], a,b,c;
    for(a=-1;a<=1;a+=2) for(b=-1;b<=1;b+=2) for(c=-1;c<=1;c+=2) V.push([a,b,c]);
    for(b=-1;b<=1;b+=2) for(c=-1;c<=1;c+=2) V.push([0,b*iP,c*P]);
    for(a=-1;a<=1;a+=2) for(b=-1;b<=1;b+=2) V.push([a*iP,b*P,0]);
    for(a=-1;a<=1;a+=2) for(c=-1;c<=1;c+=2) V.push([a*P,0,c*iP]);
    for(b=-1;b<=1;b+=2) for(c=-1;c<=1;c+=2) CEN.push([0,b*P,c]);
    for(a=-1;a<=1;a+=2) for(b=-1;b<=1;b+=2) CEN.push([a*P,b,0]);
    for(a=-1;a<=1;a+=2) for(c=-1;c<=1;c+=2) CEN.push([a,0,c*P]);
    var faces = CEN.map(function(cen){
      var ranked = V.map(function(v,i){ return {i:i, d:dot(v,cen)}; })
                    .sort(function(x,y){ return y.d-x.d; }).slice(0,5);
      var ids = ranked.map(function(o){ return o.i; });
      var nrm = norm(cen);
      var c0 = mean3(ids.map(function(i){ return V[i]; }));
      var e1 = norm(sub(V[ids[0]], c0));
      var e2 = cross(nrm, e1);
      ids.sort(function(p,q){
        var vp = sub(V[p], c0), vq = sub(V[q], c0);
        return Math.atan2(dot(vp,e2), dot(vp,e1)) - Math.atan2(dot(vq,e2), dot(vq,e1));
      });
      return { n:nrm, ids:ids };
    });
    return { V:V, faces:faces };
  })();

  function megaSVG(){
    var f0 = DODECA.faces[0];
    var w = f0.n;
    var tmp = Math.abs(w[1]) > 0.9 ? [1,0,0] : [0,1,0];
    var r = norm(cross(tmp, w)), up = cross(w, r);
    function align(v){ return [dot(v,r), dot(v,up), dot(v,w)]; }

    // spin so one front-face vertex points straight down, then tip the top toward us
    var v0 = align(DODECA.V[f0.ids[0]]);
    var phi = -Math.PI/2 - Math.atan2(v0[1], v0[0]);
    var th = 16*Math.PI/180, cp=Math.cos(phi), sp=Math.sin(phi), ct=Math.cos(th), st=Math.sin(th);
    function place(v){
      var p = align(v);
      var x = p[0]*cp - p[1]*sp, y = p[0]*sp + p[1]*cp, z = p[2];
      return [x, y*ct - z*st, y*st + z*ct];
    }
    var S = 46;
    function proj(p){ return [p[0]*S, -p[1]*S]; }

    var rv = DODECA.V.map(place);
    var vis = [];
    DODECA.faces.forEach(function(f){
      var nz = place(f.n)[2];
      if(nz <= 0.02) return;
      var W = f.ids.map(function(i){ return rv[i]; });
      vis.push({ nz:nz, W:W, flat:W.map(proj), c:proj(mean3(W)) });
    });

    // front face is the one facing us most directly; the rest take the colours of
    // the neighbouring faces, clockwise from the top, as on the real puzzle
    vis.sort(function(a,b){ return b.nz - a.nz; });
    var front = vis[0];
    front.color = STK.w;
    var ring = vis.slice(1).sort(function(a,b){
      var aa = (Math.atan2(a.c[1], a.c[0])*180/Math.PI + 90 + 360) % 360;
      var bb = (Math.atan2(b.c[1], b.c[0])*180/Math.PI + 90 + 360) % 360;
      return aa - bb;
    });
    var ringColors = [STK.y, STK.b, STK.r, STK.g, STK.p];
    ring.forEach(function(f,i){ f.color = ringColors[i % 5]; });

    var all = [];
    vis.forEach(function(f){ f.flat.forEach(function(p){ all.push(p); }); });
    var s = '<svg viewBox="'+vbox(all,4)+'" aria-hidden="true">';

    // far faces first so the near one sits on top
    vis.slice().sort(function(a,b){ return a.nz - b.nz; }).forEach(function(f){
      s += poly(f.flat, "var(--plastic)", 1);
      var W = f.W, Cf = mean3(W), k;
      var I=[], A=[], Ap=[];
      for(k=0;k<5;k++){
        I.push(lerp3(Cf, W[k], 0.45));
        A.push(lerp3(W[k], W[(k+1)%5], 0.30));
        Ap.push(lerp3(W[k], W[(k+4)%5], 0.30));
      }
      for(k=0;k<5;k++){
        s += poly([W[k], A[k], I[k], Ap[k]].map(proj), f.color, 0.84);
        s += poly([A[k], Ap[(k+1)%5], I[(k+1)%5], I[k]].map(proj), f.color, 0.84);
      }
      s += poly(I.map(proj), f.color, 0.86);
    });
    return s+"</svg>";
  }

  function artFor(p){
    if(p.kind === "cube") return cubeSVG(p.n, p.faces);
    if(p.kind === "pyra") return pyraSVG(p.faces);
    return megaSVG();
  }

  /* ============ scrambles ============ */
  function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
  var AXIS = { U:0, D:0, L:1, R:1, F:2, B:2 };
  function scrambleCube(n){
    var faces = (n===2) ? ["R","U","F"] : ["U","D","L","R","F","B"];
    var len = { 2:11, 3:20, 4:44, 5:60 }[n];
    var wide = n>=4, out=[], hist=[], guard=0;
    while(out.length<len && guard++<4000){
      var f=pick(faces), last=hist[hist.length-1], prev=hist[hist.length-2];
      if(f===last) continue;
      if(last && AXIS[f]===AXIS[last] && f===prev) continue;
      hist.push(f);
      out.push(f + (wide && Math.random()<0.42 ? "w" : "") + pick(["","'","2"]));
    }
    return out.join(" ");
  }
  function scramblePyra(){
    var faces=["U","L","R","B"], out=[], last=null, guard=0;
    while(out.length<10 && guard++<400){
      var f=pick(faces);
      if(f===last) continue;
      last=f; out.push(f+pick(["","'"]));
    }
    ["u","l","r","b"].forEach(function(t){
      var x=Math.random();
      if(x<0.68) out.push(t + (x<0.34 ? "" : "'"));
    });
    return out.join(" ");
  }
  function scrambleMega(){
    var lines=[], l, i, parts;
    for(l=0;l<7;l++){
      parts=[];
      for(i=0;i<5;i++){ parts.push("R"+pick(["++","--"])); parts.push("D"+pick(["++","--"])); }
      parts.push(pick(["U","U'"]));
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }
  function scrambleFor(p){
    if(p.kind==="cube") return scrambleCube(p.n);
    if(p.kind==="pyra") return scramblePyra();
    return scrambleMega();
  }

  /* ============ storage ============ */
  var KEY="cubeclock.v1";
  var store={ solves:{}, opts:{ inspect:false, scramble:false } };
  function load(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw) return;
      var d=JSON.parse(raw);
      if(d && d.solves && typeof d.solves==="object") store.solves=d.solves;
      if(d && d.opts && typeof d.opts==="object"){
        store.opts.inspect = !!d.opts.inspect;
        store.opts.scramble = !!d.opts.scramble;
      }
    }catch(err){ /* private window or blocked storage: run from memory */ }
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(store)); }catch(err){ /* quota or blocked */ }
  }
  function listOf(id){
    if(!store.solves[id]) store.solves[id]=[];
    return store.solves[id];
  }

  /* ============ numbers ============ */
  function eff(s){ return s.p===-1 ? Infinity : s.t + (s.p||0); }
  function fmt(ms){
    if(ms===null||ms===undefined||!isFinite(ms)) return "DNF";
    var cs=Math.floor(ms/10), sec=Math.floor(cs/100), c=cs%100;
    var m=Math.floor(sec/60), ss=sec%60, cc=c<10?"0"+c:""+c;
    return m>0 ? m+":"+(ss<10?"0"+ss:ss)+"."+cc : ss+"."+cc;
  }
  function avgOf(win){
    var n=win.length, dnf=0, i;
    for(i=0;i<n;i++) if(win[i].p===-1) dnf++;
    if(dnf>1) return Infinity;
    var v=win.map(eff).sort(function(a,b){return a-b;}).slice(1,n-1), sum=0;
    for(i=0;i<v.length;i++){ if(!isFinite(v[i])) return Infinity; sum+=v[i]; }
    return sum/v.length;
  }
  function rollingAvg(list,n){
    var out=[], i;
    for(i=0;i<list.length;i++) out.push(i>=n-1 ? avgOf(list.slice(i-n+1,i+1)) : null);
    return out;
  }
  function bestAvg(list,n){
    if(list.length<n) return null;
    var best=null,i,a;
    for(i=0;i+n<=list.length;i++){ a=avgOf(list.slice(i,i+n)); if(isFinite(a)&&(best===null||a<best)) best=a; }
    return best;
  }
  function bestSingle(list){
    var best=null,i,v;
    for(i=0;i<list.length;i++){ v=eff(list[i]); if(isFinite(v)&&(best===null||v<best)) best=v; }
    return best;
  }
  function worstSingle(list){
    var w=null,i,v;
    for(i=0;i<list.length;i++){ v=eff(list[i]); if(isFinite(v)&&(w===null||v>w)) w=v; }
    return w;
  }
  function meanOf(list){
    var sum=0,n=0,i,v;
    for(i=0;i<list.length;i++){ v=eff(list[i]); if(isFinite(v)){ sum+=v; n++; } }
    return n ? sum/n : null;
  }
  function dayKey(ms){ var d=new Date(ms); return d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate(); }
  function shortDate(ms){ return new Date(ms).toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
  function clockTime(ms){ return new Date(ms).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}); }
  function fullDate(ms){ return shortDate(ms)+", "+clockTime(ms); }

  /* ============ sessions ============ */
  var SESSION_GAP = 60*60*1000;
  function sessionsOf(list){
    var out=[], cur=null, i;
    for(i=0;i<list.length;i++){
      var s=list[i];
      if(!cur || s.b || (s.d - list[i-1].d) > SESSION_GAP){
        cur={ start:s.d, end:s.d, solves:[] };
        out.push(cur);
      }
      cur.solves.push(s);
      cur.end=s.d;
    }
    return out;
  }
  var pendingBreak = {};

  /* ============ leaderboard bridge ============ */
  var LBS = { status: "off", message: "", name: "", group: "all" };
  var published = {}, sharedRows = [], timerUnsub = null, leadUnsub = null;

  function statsFor(id){
    var list = listOf(id), best = bestSingle(list);
    if(best === null) return null;
    return { best:best, ao5:bestAvg(list,5), ao12:bestAvg(list,12), solves:list.length };
  }
  function maybePublish(id){
    if(LBS.status !== "live" || !LBS.name) return;
    var st = statsFor(id);
    if(!st) return;
    var key = st.best+"/"+st.ao5+"/"+st.ao12+"/"+st.solves;
    if(published[id] === key) return;      // nothing changed: do not write
    published[id] = key;
    LB.publish(id, st);
  }
  function publishAll(){ PUZZLES.forEach(function(p){ maybePublish(p.id); }); }

  function stopWatch(which){
    if(which === "timer" && timerUnsub){ timerUnsub(); timerUnsub = null; }
    if(which === "lead" && leadUnsub){ leadUnsub(); leadUnsub = null; }
  }

  /* ============ view plumbing ============ */
  function $(id){ return document.getElementById(id); }
  function setShown(el,on){ el.hidden=!on; el.classList.toggle("v-off", !on); }
  var views={ home:$("view-home"), timer:$("view-timer"), leaders:$("view-leaders"), session:$("view-session"), stats:$("view-stats") };
  var current="home";
  function show(name){
    if(name !== "timer") stopWatch("timer");
    if(name !== "leaders") stopWatch("lead");
    current=name;
    Object.keys(views).forEach(function(k){ setShown(views[k], k===name); });
    document.body.classList.toggle("is-timing", name==="timer");
    setShown($("topbar"), name!=="timer");
    if(name!=="timer") window.scrollTo(0,0);
    if(name==="timer") keepAwake(true); else keepAwake(false);
  }
  function tally(){
    var total=0;
    PUZZLES.forEach(function(p){ total+=listOf(p.id).length; });
    $("tally").innerHTML = total ? "<b>"+total+"</b> solve"+(total===1?"":"s")+" logged" : "";
  }

  /* keep the screen on while the timer is open; harmless where unsupported */
  var wakeLock=null;
  function keepAwake(on){
    try{
      if(on && navigator.wakeLock && !wakeLock){
        navigator.wakeLock.request("screen").then(function(l){
          wakeLock=l;
          l.addEventListener("release", function(){ wakeLock=null; });
        }, function(){});
      } else if(!on && wakeLock){
        wakeLock.release(); wakeLock=null;
      }
    }catch(err){ /* not supported */ }
  }
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState==="visible" && current==="timer") keepAwake(true);
  });
  var userGestured = false;
  window.addEventListener("pointerdown", function(e){ if(e.isTrusted) userGestured = true; }, true);
  window.addEventListener("keydown", function(e){ if(e.isTrusted) userGestured = true; }, true);
  function buzz(ms){
    if(!userGestured || !navigator.vibrate) return;
    try{ navigator.vibrate(ms); }catch(err){ /* unsupported */ }
  }

  /* ============ home ============ */
  function renderHome(){
    var html="";
    PUZZLES.forEach(function(p){
      var list=listOf(p.id), pb=bestSingle(list);
      html += '<button class="tile" data-go="'+p.id+'">'+
                '<span class="tile-art">'+artFor(p)+'</span>'+
                '<span class="tile-name">'+p.name+'</span>'+
                '<span class="tile-best">'+
                  (pb===null ? "No times yet" : "Best <b>"+fmt(pb)+"</b> &middot; "+list.length)+
                '</span>'+
              '</button>';
    });
    $("cube-grid").innerHTML=html;
    tally();
  }
  $("cube-grid").addEventListener("click", function(e){
    var b=e.target.closest("[data-go]");
    if(b) openTimer(b.getAttribute("data-go"));
  });

  /* ============ timer ============ */
  var HOLD_MS=320, INSPECT_MS=15000;
  var T={ id:"333", scramble:"", phase:"idle", start:0, inspStart:0, raf:0, hold:0,
          swallow:false, lastIdx:-1, pending:0, moreOpen:false };
  var timerEl=$("t-time"), hintEl=$("t-hint"), padEl=$("t-pad"), rootEl=$("view-timer");
  var isTouch = window.matchMedia("(pointer: coarse)").matches ||
                navigator.maxTouchPoints > 0 || ("ontouchstart" in window);

  function openTimer(id){
    T.id=id; T.lastIdx=-1; T.moreOpen=false;
    var p=BY_ID[id];
    $("t-name").textContent=p.name;
    $("t-sw").style.background=p.accent;
    newScramble();
    syncScrambleBtn();
    resetFace();
    show("timer");
    sharedRows = [];
    stopWatch("timer");
    timerUnsub = LB.watch(id, 5, function(rows){
      sharedRows = rows;
      if(current === "timer") renderSide();
    });
  }
  function newScramble(){
    // Always generated and stored with the solve, so turning the display back on
    // later does not leave a gap in the history.
    T.scramble=scrambleFor(BY_ID[T.id]);
    $("t-scramble").textContent=T.scramble;
  }
  function syncScrambleBtn(){
    var on=!!store.opts.scramble, b=$("t-scrtoggle");
    b.setAttribute("aria-pressed", String(on));
    // On a phone the pressed styling carries the state, so the label can be short.
    b.textContent = window.matchMedia("(max-width:600px)").matches
      ? "Scramble" : (on ? "Scrambles on" : "Scrambles off");
    setShown($("t-scramble"), on);
    setShown($("t-newscr"), on);
  }
  $("t-scrtoggle").addEventListener("click", function(){
    store.opts.scramble=!store.opts.scramble;
    save();
    syncScrambleBtn();
    if(current==="stats") renderStats();
  });
  function resetFace(){
    setSheet(false);
    T.phase="idle"; T.pending=0; T.inspStart=0;
    rootEl.classList.remove("armed","running");
    timerEl.className="t-time num";
    timerEl.textContent="0.00";
    setShown($("t-actions"), false);
    paint();
    renderSide();
  }
  function paint(){
    rootEl.classList.toggle("armed", T.phase==="armed"||T.phase==="iarmed");
    rootEl.classList.toggle("running", T.phase==="running");
    var h;
    if(T.phase==="running") h="";
    else if(T.phase==="armed"||T.phase==="iarmed") h="Let go!";
    else if(T.phase==="hold"||T.phase==="ihold") h="Keep holding&hellip;";
    else if(T.phase==="inspect") h = isTouch ? "Inspecting &mdash; hold when you are ready" : "Inspecting &mdash; hold <kbd>space</kbd> when ready";
    else if(store.opts.inspect) h = isTouch ? "Tap for 15 seconds of inspection" : "Press <kbd>space</kbd> for 15 seconds of inspection";
    else h = isTouch ? "Press and hold, then let go" : "Hold <kbd>space</kbd> to get ready";
    hintEl.innerHTML=h;
  }

  function beginHold(target){
    T.phase=target;
    clearTimeout(T.hold);
    T.hold=setTimeout(function(){
      if(T.phase==="hold") T.phase="armed";
      else if(T.phase==="ihold") T.phase="iarmed";
      else return;
      buzz(18);
      paint();
    }, HOLD_MS);
    paint();
  }
  function startInspection(){
    T.phase="inspect";
    T.inspStart=performance.now();
    setShown($("t-actions"), false);
    cancelAnimationFrame(T.raf);
    (function tick(){
      if(T.phase!=="inspect" && T.phase!=="ihold" && T.phase!=="iarmed") return;
      var el=performance.now()-T.inspStart, cls="insp", txt;
      if(el < INSPECT_MS){
        txt=String(Math.max(0, Math.ceil((INSPECT_MS-el)/1000)));
        if(el > 8000) cls="insp-warn";
      } else if(el < 17000){ txt="+2"; cls="insp-warn"; }
      else { txt="DNF"; cls="insp-bad"; }
      timerEl.className="t-time num "+cls;
      timerEl.textContent=txt;
      T.raf=requestAnimationFrame(tick);
    })();
    paint();
  }
  function onPress(){
    if(sheetOpen()) return;
    if(T.phase==="running"){ stopRun(); T.swallow=true; return; }
    if(T.phase==="idle"){
      if(store.opts.inspect){ startInspection(); T.swallow=true; return; }
      beginHold("hold"); return;
    }
    if(T.phase==="inspect"){ beginHold("ihold"); return; }
  }
  function onRelease(){
    if(T.swallow){ T.swallow=false; return; }
    if(T.phase==="hold"){ clearTimeout(T.hold); T.phase="idle"; paint(); return; }
    if(T.phase==="ihold"){ clearTimeout(T.hold); T.phase="inspect"; paint(); return; }
    if(T.phase==="armed"||T.phase==="iarmed") startRun();
  }
  function startRun(){
    T.pending=0;
    if(T.inspStart){
      var el=performance.now()-T.inspStart;
      if(el > 17000) T.pending=-1;
      else if(el > INSPECT_MS) T.pending=2000;
    }
    T.phase="running";
    T.start=performance.now();
    cancelAnimationFrame(T.raf);
    timerEl.className="t-time num";
    timerEl.textContent="0.00";
    paint();
    (function tick(){
      if(T.phase!=="running") return;
      timerEl.textContent=fmt(performance.now()-T.start);
      T.raf=requestAnimationFrame(tick);
    })();
  }
  function stopRun(){
    var ms=performance.now()-T.start;
    T.phase="idle";
    cancelAnimationFrame(T.raf);
    buzz(28);
    timerEl.className="t-time num";
    timerEl.textContent=fmt(ms);
    var list=listOf(T.id);
    var rec={ t:Math.round(ms), p:T.pending, d:Date.now(), s:T.scramble };
    if(pendingBreak[T.id]){ rec.b=1; pendingBreak[T.id]=false; }
    list.push(rec);
    T.lastIdx=list.length-1;
    T.inspStart=0; T.pending=0;
    save();
    var v=eff(rec);
    timerEl.textContent = isFinite(v) ? fmt(v) : "DNF";
    timerEl.classList.toggle("dnf", !isFinite(v));
    syncActions();
    setShown($("t-actions"), true);
    newScramble();
    paint();
    renderSide();
    tally();
    maybePublish(T.id);
  }

  padEl.addEventListener("pointerdown", function(e){ e.preventDefault(); onPress(); });
  padEl.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  window.addEventListener("pointerup", function(){ if(current==="timer") onRelease(); });
  window.addEventListener("pointercancel", function(){ if(current==="timer") onRelease(); });

  document.addEventListener("keydown", function(e){
    if(current!=="timer") return;
    if(e.code==="Space"||e.key===" "){ e.preventDefault(); if(!e.repeat) onPress(); return; }
    if(e.key==="Escape"){
      if(sheetOpen()){ setSheet(false); return; }
      if(T.phase==="running"){ e.preventDefault(); stopRun(); return; }
      if(T.phase==="inspect"){ cancelAnimationFrame(T.raf); resetFace(); return; }
      backHome(); return;
    }
    if(T.phase==="running"){ e.preventDefault(); stopRun(); }
  });
  document.addEventListener("keyup", function(e){
    if(current!=="timer") return;
    if(e.code==="Space"||e.key===" "){ e.preventDefault(); onRelease(); }
  });

  function backHome(){ cancelAnimationFrame(T.raf); resetFace(); renderHome(); show("home"); }
  $("t-back").addEventListener("click", backHome);
  $("t-newscr").addEventListener("click", function(){ if(T.phase==="idle") newScramble(); });
  $("t-tosession").addEventListener("click", function(){ openSession(T.id); });
  $("t-inspect").addEventListener("click", function(){
    store.opts.inspect=!store.opts.inspect;
    save();
    syncInspectBtn();
    if(T.phase==="inspect"){ cancelAnimationFrame(T.raf); resetFace(); } else paint();
  });
  function syncInspectBtn(){
    var b=$("t-inspect"), narrow=window.matchMedia("(max-width:600px)").matches;
    b.setAttribute("aria-pressed", String(!!store.opts.inspect));
    b.textContent = store.opts.inspect ? (narrow ? "15s" : "Inspection 15s")
                                       : (narrow ? "Insp off" : "Inspection off");
  }
  window.addEventListener("orientationchange", function(){ setTimeout(function(){ syncInspectBtn(); syncScrambleBtn(); }, 120); });

  function syncActions(){
    var s=listOf(T.id)[T.lastIdx], btns=$("t-actions").querySelectorAll("button");
    btns[0].classList.toggle("on", !!s && s.p===2000);
    btns[1].classList.toggle("on", !!s && s.p===-1);
  }
  $("t-actions").addEventListener("click", function(e){
    var b=e.target.closest("[data-act]");
    if(!b) return;
    var act=b.getAttribute("data-act"), list=listOf(T.id), s=list[T.lastIdx];
    if(!s) return;
    if(act==="plus2") s.p = (s.p===2000) ? 0 : 2000;
    else if(act==="dnf") s.p = (s.p===-1) ? 0 : -1;
    else {
      list.splice(T.lastIdx,1); T.lastIdx=-1;
      setShown($("t-actions"), false);
      timerEl.className="t-time num"; timerEl.textContent="0.00";
      save(); renderSide(); tally(); published[T.id]=null; maybePublish(T.id); return;
    }
    var v=eff(s);
    timerEl.textContent = isFinite(v) ? fmt(v) : "DNF";
    timerEl.classList.toggle("dnf", !isFinite(v));
    save(); syncActions(); renderSide(); tally(); maybePublish(T.id);
  });

  function timeCell(s, pb){
    var v=eff(s), cls="tm";
    if(!isFinite(v)) cls+=" dnf";
    else if(s.p===2000) cls+=" pen";
    if(isFinite(v) && v===pb) cls+=" best";
    return '<span class="'+cls+'">'+(isFinite(v) ? fmt(v)+(s.p===2000?" +2":"") : "DNF")+'</span>';
  }
  function renderSide(){
    var list=listOf(T.id), pb=bestSingle(list);
    $("s-pb").innerHTML = pb===null ? "&mdash;" : fmt(pb);
    var when="";
    if(pb!==null){
      for(var i=0;i<list.length;i++) if(eff(list[i])===pb){ when="set "+shortDate(list[i].d); break; }
    }
    $("s-pbwhen").textContent = when || (list.length ? "" : "no times yet");

    function rowsHtml(arr, offset){
      var out="";
      arr.forEach(function(s,i){
        out += '<li><span class="rk">'+(offset+i+1)+'</span>'+timeCell(s,pb)+'</li>';
      });
      return out;
    }
    var recent=list.slice(-5).reverse();
    $("s-last").innerHTML = recent.length ? rowsHtml(recent,0)
      : '<li><span class="rk">&mdash;</span><span class="tm" style="color:var(--muted);font-weight:400">no solves</span></li>';

    var rest=list.slice(0,-5).slice(-20).reverse();
    var moreBtn=$("s-more");
    setShown(moreBtn, rest.length>0);
    moreBtn.textContent = T.moreOpen ? "Show less" : "Show more ("+rest.length+")";
    setShown($("s-morelist"), T.moreOpen && rest.length>0);
    $("s-morelist").innerHTML = rowsHtml(rest,5);

    var sess=sessionsOf(list), cur=sess.length?sess[sess.length-1]:null;
    var cs=cur?cur.solves:[];
    var cb=bestSingle(cs), cm=meanOf(cs), ca=cs.length>=5?avgOf(cs.slice(-5)):null;
    $("s-sess").innerHTML =
      '<div><span>Solves</span>'+cs.length+'</div>'+
      '<div><span>Best</span>'+(cb===null?"&mdash;":fmt(cb))+'</div>'+
      '<div><span>Mean</span>'+(cm===null?"&mdash;":fmt(cm))+'</div>'+
      '<div><span>Ao5</span>'+(ca===null?"&mdash;":fmt(ca))+'</div>';

    var last=list.length?list[list.length-1]:null;
    var lastTxt = last ? (isFinite(eff(last)) ? fmt(eff(last)) : "DNF") : "\u2014";
    $("ts-main").innerHTML = list.length
      ? "<span>Best</span> "+(pb===null?"\u2014":fmt(pb))+"  <span>Last</span> "+lastTxt
      : "<span>No times yet</span>";

    renderLeaderboard(list, pb);
  }
  $("s-more").addEventListener("click", function(){ T.moreOpen=!T.moreOpen; renderSide(); });

  function renderLeaderboard(list, pb){
    var ranked=list.filter(function(s){ return isFinite(eff(s)); })
                   .slice().sort(function(a,b){ return eff(a)-eff(b); }).slice(0,5);
    var out;
    if(LBS.status === "live" && sharedRows.length){
      out="";
      sharedRows.slice(0,5).forEach(function(r){
        out += '<span class="lead-item'+(r.rank===1?" gold":"")+(r.me?" me":"")+'">'+
                 '<span class="rk">'+r.rank+'</span>'+
                 '<span class="nm">'+esc(r.me ? "You" : r.name)+'</span>'+
                 '<span class="tm">'+fmt(r.best)+'</span>'+
               '</span>';
      });
    } else if(!ranked.length){
      out='<span class="lead-empty">'+
          (LBS.status==="live" ? "No times on the board yet." : "Your best times will line up here.")+
          '</span>';
    } else {
      out="";
      ranked.forEach(function(s,i){
        out += '<span class="lead-item'+(i===0?" gold":"")+'">'+
                 '<span class="rk">'+(i+1)+'</span><span class="tm">'+fmt(eff(s))+'</span>'+
               '</span>';
      });
    }
    $("t-lead-list").innerHTML=out;
    $("s-lead-list").innerHTML=out;
  }

  /* ---- portrait: the side panel is a pull-up sheet ---- */
  function sheetOpen(){ return $("t-side-el").classList.contains("open"); }
  function setSheet(on){
    $("t-side-el").classList.toggle("open", on);
    $("t-backdrop").classList.toggle("open", on);
    $("t-strip").setAttribute("aria-expanded", String(on));
  }
  $("t-strip").addEventListener("click", function(){ setSheet(!sheetOpen()); });
  $("t-backdrop").addEventListener("click", function(){ setSheet(false); });
  $("s-close").addEventListener("click", function(){ setSheet(false); });

  /* ============ session view ============ */
  var sessId="333";
  function pillsHtml(active){
    var html="";
    PUZZLES.forEach(function(p){
      html += '<button class="pill" data-p="'+p.id+'" aria-pressed="'+(p.id===active)+'">'+
              '<span class="sw" style="background:'+p.accent+'"></span>'+p.name+'</button>';
    });
    return html;
  }
  function statTile(label,value,sub,hero){
    return '<div class="stat'+(hero?" hero":"")+'"><i>'+label+'</i><b>'+value+'</b>'+
           (sub?'<small>'+sub+'</small>':'')+'</div>';
  }
  function openSession(id){
    if(id) sessId=id;
    $("sess-pills").innerHTML=pillsHtml(sessId);
    show("session");
    renderSession();
  }
  function renderSession(){
    var p=BY_ID[sessId], list=listOf(sessId), sess=sessionsOf(list);
    $("sess-title").textContent=p.name;
    var cur=sess.length?sess[sess.length-1]:null;
    $("sess-sub").textContent = sess.length
      ? sess.length+" session"+(sess.length===1?"":"s")+" so far"
      : "No sessions yet.";

    if(!cur){
      $("sess-current").innerHTML='<div class="empty-note"><b>No solves in this session</b>'+
        'Time a solve and it will show up here straight away.</div>';
      $("sess-past").innerHTML='<div class="empty-note">Nothing earlier yet.</div>';
      return;
    }
    var cs=cur.solves, dash="&mdash;";
    var b=bestSingle(cs), w=worstSingle(cs), m=meanOf(cs);
    var a5=cs.length>=5?avgOf(cs.slice(-5)):null, a12=cs.length>=12?avgOf(cs.slice(-12)):null;
    var pb=bestSingle(list);
    var chips="";
    cs.slice().reverse().forEach(function(s){
      var v=eff(s), cls="sc-chip";
      if(!isFinite(v)) cls+=" dnf";
      else if(s.p===2000) cls+=" pen";
      if(isFinite(v)&&v===b) cls+=" best";
      chips += '<span class="'+cls+'">'+(isFinite(v)?fmt(v)+(s.p===2000?"+":""):"DNF")+'</span>';
    });
    $("sess-current").innerHTML =
      '<div class="sess-card">'+
        '<div class="tiles" style="border:none;border-radius:10px">'+
          statTile("Solves", String(cs.length), "started "+clockTime(cur.start))+
          statTile("Session best", b===null?dash:fmt(b), (b!==null&&b===pb)?"all-time best":"")+
          statTile("Session mean", m===null?dash:fmt(m), "")+
          statTile("Ao5", a5===null?dash:fmt(a5), cs.length<5?"needs 5 solves":"")+
          statTile("Ao12", a12===null?dash:fmt(a12), cs.length<12?"needs 12 solves":"")+
          statTile("Worst", w===null?dash:fmt(w), "")+
        '</div>'+
        '<div class="sess-chips">'+chips+'</div>'+
      '</div>';

    var past=sess.slice(0,-1).reverse();
    if(!past.length){
      $("sess-past").innerHTML='<div class="empty-note">This is the first session.</div>';
      return;
    }
    var rows="";
    past.forEach(function(s){
      var sb=bestSingle(s.solves), sm=meanOf(s.solves);
      var sa=s.solves.length>=5?bestAvg(s.solves,5):null;
      rows += '<tr>'+
        '<td>'+shortDate(s.start)+'</td>'+
        '<td class="num" style="color:var(--muted)">'+clockTime(s.start)+"&ndash;"+clockTime(s.end)+'</td>'+
        '<td class="num">'+s.solves.length+'</td>'+
        '<td class="t">'+(sb===null?"&mdash;":fmt(sb))+'</td>'+
        '<td class="num">'+(sa===null?"&mdash;":fmt(sa))+'</td>'+
        '<td class="num">'+(sm===null?"&mdash;":fmt(sm))+'</td>'+
      '</tr>';
    });
    $("sess-past").innerHTML='<div class="tbl-scroll"><table><thead><tr>'+
      '<th>Day</th><th>Time</th><th>Solves</th><th>Best</th><th>Best Ao5</th><th>Mean</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  $("sess-pills").addEventListener("click", function(e){
    var b=e.target.closest("[data-p]");
    if(!b) return;
    sessId=b.getAttribute("data-p");
    $("sess-pills").innerHTML=pillsHtml(sessId);
    renderSession();
  });
  $("sess-new").addEventListener("click", function(){
    pendingBreak[sessId]=true;
    var btn=$("sess-new");
    btn.textContent="New session starts on your next solve";
    setTimeout(function(){ btn.textContent="Start a new session"; }, 2600);
  });
  $("sess-solve").addEventListener("click", function(){ openTimer(sessId); });
  $("sess-home").addEventListener("click", function(){ renderHome(); show("home"); });
  $("nav-session").addEventListener("click", function(){ openSession(sessId); });

  /* ============ statistics ============ */
  var statId="333", chartRange=0, histLimit=100;
  function openStats(id){
    if(id) statId=id;
    histLimit=100;
    $("stat-pills").innerHTML=pillsHtml(statId);
    show("stats");
    renderStats();
  }
  function renderStats(){
    var p=BY_ID[statId], list=listOf(statId);
    $("stat-title").textContent=p.name;
    var pb=bestSingle(list), mean=meanOf(list);
    var b5=bestAvg(list,5), b12=bestAvg(list,12);
    var cur5=list.length>=5?avgOf(list.slice(-5)):null;
    var cur12=list.length>=12?avgOf(list.slice(-12)):null;
    var days={}, i;
    for(i=0;i<list.length;i++) days[dayKey(list[i].d)]=1;
    var nDays=Object.keys(days).length;
    var today=list.filter(function(s){ return dayKey(s.d)===dayKey(Date.now()); });
    $("stat-sub").textContent = list.length
      ? list.length+" solves across "+nDays+" day"+(nDays===1?"":"s")+(today.length?" \u00b7 "+today.length+" today":"")
      : "Nothing logged yet.";
    var dash="&mdash;", pbDate=null;
    if(pb!==null) for(i=0;i<list.length;i++) if(eff(list[i])===pb){ pbDate=list[i].d; break; }
    $("stat-tiles").innerHTML =
      statTile("Personal best", pb===null?dash:fmt(pb), pbDate?"set "+shortDate(pbDate):"", true)+
      statTile("Best Ao5", b5===null?dash:fmt(b5), cur5!==null?"now "+fmt(cur5):"needs 5 solves")+
      statTile("Best Ao12", b12===null?dash:fmt(b12), cur12!==null?"now "+fmt(cur12):"needs 12 solves")+
      statTile("Average of all", mean===null?dash:fmt(mean), list.length+" solves")+
      statTile("Days practised", String(nDays), nDays?"first "+shortDate(list[0].d):"");
    renderChart(list);
    renderHistory(list);
    $("b-clear").textContent="Delete every "+p.name+" time";
    $("b-clear").removeAttribute("data-armed");
  }
  $("stat-pills").addEventListener("click", function(e){
    var b=e.target.closest("[data-p]");
    if(!b) return;
    statId=b.getAttribute("data-p"); histLimit=100;
    $("stat-pills").innerHTML=pillsHtml(statId);
    renderStats();
  });
  $("nav-stats").addEventListener("click", function(){ openStats(statId); });
  $("stat-solve").addEventListener("click", function(){ openTimer(statId); });

  function axisFmt(ms){
    var s=ms/1000;
    if(s>=60){ var m=Math.floor(s/60), r=Math.round(s-m*60); return m+":"+(r<10?"0"+r:r); }
    return (Math.abs(s-Math.round(s))<0.001 ? s.toFixed(0) : s.toFixed(1))+"s";
  }
  function niceStep(range){
    var c=[50,100,200,250,500,1000,2000,2500,5000,10000,15000,20000,30000,60000,120000,300000], i;
    for(i=0;i<c.length;i++) if(range/c[i]<=5) return c[i];
    return 600000;
  }
  function renderChart(list){
    if(list.length<2){
      $("chart-wrap").innerHTML='<div class="empty-note"><b>No trend yet</b>Log a couple of solves and the graph appears here.</div>';
      return;
    }
    $("chart-wrap").innerHTML=
      '<div class="chart-card"><div class="chart-top">'+
        '<div class="legend">'+
          '<em><span class="lg-dot"></span>Each solve</em>'+
          '<em><span class="lg-line"></span>Average of 5</em>'+
          '<em><span class="lg-dash"></span>Personal best</em>'+
        '</div>'+
        '<div class="range">'+
          '<button data-range="50" aria-pressed="'+(chartRange===50)+'">Last 50</button>'+
          '<button data-range="200" aria-pressed="'+(chartRange===200)+'">Last 200</button>'+
          '<button data-range="0" aria-pressed="'+(chartRange===0)+'">All</button>'+
        '</div></div>'+
        '<div class="chart-box"><canvas id="chart"></canvas></div></div>';
    $("chart-wrap").querySelector(".range").addEventListener("click", function(e){
      var b=e.target.closest("[data-range]");
      if(!b) return;
      chartRange=parseInt(b.getAttribute("data-range"),10);
      renderChart(listOf(statId));
    });
    drawChart(list);
  }
  function drawChart(full){
    var cv=$("chart");
    if(!cv) return;
    var offset=(chartRange && full.length>chartRange) ? full.length-chartRange : 0;
    var list=offset?full.slice(offset):full;
    var w=cv.clientWidth, h=cv.clientHeight;
    if(!w||!h) return;
    var dpr=Math.min(window.devicePixelRatio||1,2);
    cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
    var g=cv.getContext("2d");
    g.setTransform(dpr,0,0,dpr,0,0);
    g.clearRect(0,0,w,h);
    var cs=getComputedStyle(document.documentElement);
    function C(k){ return cs.getPropertyValue(k).trim(); }
    var muted=C("--muted"), lineC=C("--line"), accent=C("--accent"), pbC=C("--pb");
    var PL=52,PR=14,PT=12,PBm=30, iw=w-PL-PR, ih=h-PT-PBm;
    var vals=list.map(eff), fin=vals.filter(isFinite);
    if(!fin.length){
      g.fillStyle=muted; g.font='12px "Archivo",sans-serif';
      g.fillText("Only DNFs in this range.", PL, PT+ih/2);
      return;
    }
    var lo=Math.min.apply(null,fin), hi=Math.max.apply(null,fin);
    if(hi-lo<200){ lo-=200; hi+=200; }
    var step=niceStep(hi-lo);
    var y0=Math.floor(lo/step)*step, y1=Math.ceil(hi/step)*step;
    if(y1===y0) y1=y0+step;
    if(y0<0) y0=0;
    function X(i){ return PL+(list.length===1?iw/2:(i/(list.length-1))*iw); }
    function Y(v){ return PT+ih-((v-y0)/(y1-y0))*ih; }
    g.font='11px "Azeret Mono",monospace'; g.textBaseline="middle";
    for(var v=y0; v<=y1+1; v+=step){
      var yy=Y(v);
      g.beginPath(); g.strokeStyle=lineC; g.lineWidth=1;
      g.moveTo(PL,Math.round(yy)+0.5); g.lineTo(w-PR,Math.round(yy)+0.5); g.stroke();
      g.fillStyle=muted; g.textAlign="right"; g.fillText(axisFmt(v), PL-8, yy);
    }
    var pb=bestSingle(full);
    if(pb!==null && pb>=y0 && pb<=y1){
      g.save(); g.setLineDash([5,4]); g.strokeStyle=pbC; g.lineWidth=2;
      g.beginPath(); g.moveTo(PL,Y(pb)); g.lineTo(w-PR,Y(pb)); g.stroke(); g.restore();
    }
    var i,x,y;
    g.fillStyle=accent; g.globalAlpha=0.42;
    for(i=0;i<list.length;i++){
      if(!isFinite(vals[i])) continue;
      x=X(i); y=Y(Math.max(y0,Math.min(y1,vals[i])));
      g.beginPath(); g.arc(x,y,2.6,0,Math.PI*2); g.fill();
    }
    g.globalAlpha=1;
    var roll=rollingAvg(list,5);
    g.strokeStyle=accent; g.lineWidth=2; g.lineJoin="round"; g.beginPath();
    var started=false;
    for(i=0;i<roll.length;i++){
      if(roll[i]===null||!isFinite(roll[i])){ started=false; continue; }
      x=X(i); y=Y(Math.max(y0,Math.min(y1,roll[i])));
      if(!started){ g.moveTo(x,y); started=true; } else g.lineTo(x,y);
    }
    g.stroke();
    g.fillStyle=muted; g.textBaseline="alphabetic"; g.textAlign="left";
    g.fillText("#"+(offset+1)+" \u00b7 "+shortDate(list[0].d), PL, h-9);
    g.textAlign="right";
    g.fillText("#"+(offset+list.length)+" \u00b7 "+shortDate(list[list.length-1].d), w-PR, h-9);
  }
  var rzTimer=0;
  window.addEventListener("resize", function(){
    clearTimeout(rzTimer);
    rzTimer=setTimeout(function(){ syncInspectBtn(); syncScrambleBtn(); if(current==="stats") drawChart(listOf(statId)); }, 140);
  });

  function renderHistory(list){
    if(!list.length){
      $("hist-note").textContent="";
      $("hist-wrap").innerHTML='<div class="empty-note"><b>Nothing here yet</b>Your solves will be listed newest first, with the scramble you used.</div>';
      return;
    }
    var pb=bestSingle(list), roll=rollingAvg(list,5);
    var shown=Math.min(histLimit,list.length);
    $("hist-note").textContent = shown<list.length
      ? "Showing the "+shown+" most recent of "+list.length+"."
      : list.length+(list.length===1?" solve.":" solves.");
    var rows="", i, s, v, cls, a5;
    for(i=list.length-1;i>=list.length-shown;i--){
      s=list[i]; v=eff(s); a5=roll[i]; cls="t";
      if(!isFinite(v)) cls+=" dnf"; else if(s.p===2000) cls+=" pen";
      rows += '<tr'+(isFinite(v)&&v===pb?' class="is-pb"':'')+'>'+
        '<td class="num" style="color:var(--muted)">'+(i+1)+'</td>'+
        '<td class="'+cls+'">'+(isFinite(v)?fmt(v)+(s.p===2000?" (+2)":""):"DNF")+'</td>'+
        '<td class="num" style="color:var(--ink-2)">'+(a5===null?"&mdash;":fmt(a5))+'</td>'+
        (store.opts.scramble ? '<td class="sc">'+String(s.s||"").replace(/\n/g," / ")+'</td>' : "")+
        '<td class="num" style="color:var(--muted);font-size:11.5px">'+fullDate(s.d)+'</td>'+
        '<td class="act">'+
          '<button class="mini" data-h="plus2" data-i="'+i+'">+2</button>'+
          '<button class="mini" data-h="dnf" data-i="'+i+'">DNF</button>'+
          '<button class="mini danger" data-h="del" data-i="'+i+'">&#10005;</button>'+
        '</td></tr>';
    }
    $("hist-wrap").innerHTML='<div class="tbl-scroll"><table><thead><tr>'+
      '<th>#</th><th>Time</th><th>Ao5</th>'+(store.opts.scramble?'<th>Scramble</th>':'')+'<th>When</th><th></th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
      (shown<list.length?'<p style="margin:12px 0 0"><button class="ghost" id="hist-more">Show all '+list.length+' solves</button></p>':"");
    var more=$("hist-more");
    if(more) more.addEventListener("click", function(){ histLimit=1e9; renderStats(); });
  }
  $("hist-wrap").addEventListener("click", function(e){
    var b=e.target.closest("[data-h]");
    if(!b) return;
    var idx=parseInt(b.getAttribute("data-i"),10), act=b.getAttribute("data-h");
    var arr=listOf(statId), sv=arr[idx];
    if(!sv) return;
    if(act==="plus2") sv.p = (sv.p===2000)?0:2000;
    else if(act==="dnf") sv.p = (sv.p===-1)?0:-1;
    else { arr.splice(idx,1); if(statId===T.id) T.lastIdx=-1; }
    save(); renderStats(); tally(); published[statId]=null; maybePublish(statId);
  });

  /* ============ backup ============ */
  var box=$("b-box"), say=$("b-say");
  function tell(msg,bad){ say.textContent=msg; say.className = bad?"say bad":"say"; }
  function backupText(){
    return JSON.stringify({ app:"cubeclock", version:1, savedAt:new Date().toISOString(),
                            solves:store.solves, opts:store.opts });
  }
  var loadBtn=document.createElement("button");
  loadBtn.className="ghost";
  loadBtn.textContent="Load pasted times";
  setShown(loadBtn,false);
  $("b-restore").insertAdjacentElement("afterend", loadBtn);

  $("b-copy").addEventListener("click", function(){
    setShown(box,true); box.value=backupText(); box.select();
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(box.value).then(
        function(){ tell("Copied. Paste it somewhere safe."); },
        function(){ tell("Select the text below and copy it."); });
    } else tell("Select the text below and copy it.");
  });
  $("b-restore").addEventListener("click", function(){
    setShown(box,true); box.value=""; box.focus();
    setShown(loadBtn,true);
    tell("Paste a backup below, then press Load pasted times.");
  });
  loadBtn.addEventListener("click", function(){
    var d;
    try{ d=JSON.parse(box.value); }
    catch(err){ tell("That does not look like a Cube Clock backup.", true); return; }
    if(!d||!d.solves||typeof d.solves!=="object"){ tell("No times found in that text.", true); return; }
    var added=0;
    PUZZLES.forEach(function(p){
      var incoming=d.solves[p.id];
      if(!Array.isArray(incoming)) return;
      var arr=listOf(p.id), seen={};
      arr.forEach(function(s){ seen[s.d+":"+s.t]=1; });
      incoming.forEach(function(s){
        if(!s||typeof s.t!=="number"||typeof s.d!=="number") return;
        var k=s.d+":"+s.t;
        if(seen[k]) return;
        seen[k]=1;
        arr.push({ t:s.t, p:(s.p===-1||s.p===2000)?s.p:0, d:s.d,
                   s:typeof s.s==="string"?s.s:"", b:s.b?1:undefined });
        added++;
      });
      arr.sort(function(a,b){ return a.d-b.d; });
    });
    save(); setShown(loadBtn,false); setShown(box,false);
    renderStats(); renderHome(); tally();
    tell(added ? "Restored "+added+" solve"+(added===1?"":"s")+"." : "Those times were already here.");
  });
  $("b-clear").addEventListener("click", function(){
    var btn=$("b-clear");
    if(btn.getAttribute("data-armed")!=="1"){
      btn.setAttribute("data-armed","1");
      btn.textContent="Tap again to delete all "+listOf(statId).length+" times \u2014 this cannot be undone";
      return;
    }
    store.solves[statId]=[];
    T.lastIdx=-1;
    save(); renderStats(); renderHome(); tally();
    tell("Cleared.");
  });

  /* Saving the backup as a file works two different ways depending on where this
     is running. Inside the Claude Artifact viewer a page cannot start its own
     download, so the platform is asked to offer the file. Served normally, an
     ordinary object-URL download is the right thing. */
  function nativeSave(){
    try{
      var blob = new Blob([backupText()], { type:"application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cube-clock-times.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
      tell("Backup saved.");
    }catch(err){
      tell("Could not save the file. Use Copy all times as text instead.", true);
    }
  }
  if(window.claude && typeof window.claude.use === "function"){
    window.claude.use("downloads").then(function(dl){
      if(!dl) return;                      // host will not allow it: copy-as-text remains
      var btn = $("b-export");
      setShown(btn, true);
      btn.addEventListener("click", function(){
        dl.save({ filename:"cube-clock-times.json", data:backupText() }).then(
          function(){ tell("Backup saved."); },
          function(err){
            if(err && err.code === "declined") return;
            tell("Could not save the file. Use Copy all times as text instead.", true);
          });
      });
    }, function(){ /* unavailable: the copy/paste backup still works */ });
  } else {
    setShown($("b-export"), true);
    $("b-export").addEventListener("click", nativeSave);
  }

  /* ============ leaderboard view ============ */
  var leadId = "333";
  function openLeaders(id){
    if(id) leadId = id;
    $("lead-pills").innerHTML = pillsHtml(leadId);
    show("leaders");
    renderLeaders();
  }
  function renderLeaders(){
    var p = BY_ID[leadId];
    $("lead-title").textContent = p.name;
    $("lead-sub").textContent = LBS.group === "all"
      ? "Everyone using this app"
      : "Group \u201c" + LBS.group + "\u201d";

    stopWatch("lead");
    if(LBS.status !== "live"){
      $("lead-wrap").innerHTML = '<div class="empty-note"><b>' +
        (LBS.status === "off" ? "Leaderboard not set up yet" : "Leaderboard unavailable") +
        '</b>' + esc(LBS.message || "") + '</div>';
      $("lead-foot").textContent = "";
      return;
    }
    if(!LBS.name){
      $("lead-wrap").innerHTML = '<div class="empty-note"><b>Pick a name first</b>' +
        'Choose the name your friends will see, then your times appear here.</div>';
      $("lead-foot").textContent = "";
      return;
    }
    $("lead-wrap").innerHTML = '<div class="empty-note">Loading the board&hellip;</div>';
    leadUnsub = LB.watch(leadId, 20, function(rows){
      if(current !== "leaders") return;
      if(!rows.length){
        $("lead-wrap").innerHTML = '<div class="empty-note"><b>Nobody on the board yet</b>' +
          'Be the first \u2014 time a solve and your best lands here.</div>';
        return;
      }
      var body = "";
      rows.forEach(function(r){
        body += '<tr class="' + (r.me ? "me " : "") + (r.rank === 1 ? "gold" : "") + '">' +
          '<td class="medal">' + r.rank + '</td>' +
          '<td class="nm">' + esc(r.name) + (r.me ? ' <span style="color:var(--muted);font-weight:400">(you)</span>' : '') + '</td>' +
          '<td class="t">' + fmt(r.best) + '</td>' +
          '<td class="num">' + (r.ao5 == null ? "&mdash;" : fmt(r.ao5)) + '</td>' +
          '<td class="num">' + (r.ao12 == null ? "&mdash;" : fmt(r.ao12)) + '</td>' +
          '<td class="num" style="color:var(--muted)">' + (r.solves || 0) + '</td>' +
        '</tr>';
      });
      $("lead-wrap").innerHTML = '<div class="tbl-scroll"><table><thead><tr>' +
        '<th></th><th>Player</th><th>Best</th><th>Ao5</th><th>Ao12</th><th>Solves</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
      $("lead-foot").textContent = rows.length + (rows.length === 1 ? " player" : " players") +
        " \u00b7 updates live as people solve";
    });
  }
  $("lead-pills").addEventListener("click", function(e){
    var b = e.target.closest("[data-p]");
    if(!b) return;
    leadId = b.getAttribute("data-p");
    $("lead-pills").innerHTML = pillsHtml(leadId);
    renderLeaders();
  });
  $("nav-leaders").addEventListener("click", function(){ openLeaders(leadId); });
  $("lead-solve").addEventListener("click", function(){ openTimer(leadId); });

  /* ============ player bar ============ */
  function renderLbBar(){
    var dot = $("lb-dot"), txt = $("lb-text"), edit = $("lb-edit");
    dot.className = "lb-dot" + (LBS.status === "live" ? " live" : (LBS.status === "error" ? " err" : ""));
    var bar = $("lb-bar"), nav = $("nav-leaders");
    var localOnly = (LBS.status === "off");
    bar.hidden = localOnly; bar.classList.toggle("v-off", localOnly);
    nav.hidden = localOnly; nav.classList.toggle("v-off", localOnly);
    if(localOnly) return;
    edit.hidden = false; edit.classList.remove("v-off");
    if(LBS.status === "error"){
      txt.innerHTML = esc(LBS.message || "Leaderboard unavailable.");
    } else if(LBS.status === "connecting"){
      txt.innerHTML = "Connecting to the leaderboard&hellip;";
    } else if(!LBS.name){
      txt.innerHTML = "<b>Pick a name</b> to join the leaderboard.";
    } else {
      txt.innerHTML = "Playing as <b>" + esc(LBS.name) + "</b>" +
        (LBS.group === "all" ? "" : " in group <b>" + esc(LBS.group) + "</b>");
    }
    edit.textContent = LBS.name ? "Change name" : "Set your name";
  }
  function showLbForm(on){
    var f = $("lb-form");
    f.hidden = !on; f.classList.toggle("v-off", !on);
    $("lb-edit").hidden = on; $("lb-edit").classList.toggle("v-off", on);
    if(on){
      $("lb-input").value = LBS.name || "";
      $("lb-ginput").value = LBS.group === "all" ? "" : LBS.group;
      $("lb-input").focus();
    }
  }
  $("lb-edit").addEventListener("click", function(){ showLbForm(true); });
  $("lb-cancel").addEventListener("click", function(){ showLbForm(false); });
  $("lb-form").addEventListener("submit", function(e){
    e.preventDefault();
    var name = $("lb-input").value.trim();
    if(!name) return;
    Promise.resolve(LB.setName(name))
      .then(function(){ return LB.setGroup($("lb-ginput").value.trim() || "all"); })
      .then(function(){
        showLbForm(false);
        published = {};          // name/group changed: republish under the new identity
        publishAll();
        if(current === "leaders") renderLeaders();
      });
  });

  /* ============ boot ============ */
  function start(){
    load();
    syncInspectBtn();
    syncScrambleBtn();
    renderHome();
    show("home");
    renderLbBar();

    LB.onChange(function(s){
      var wasLive = LBS.status === "live";
      LBS.status = s.status; LBS.message = s.message;
      LBS.name = s.name; LBS.group = s.group;
      renderLbBar();
      if(current === "leaders") renderLeaders();
      if(current === "timer") renderSide();
      if(!wasLive && s.status === "live" && s.name) publishAll();
    });
    LB.init();
  }
  start();
})();
