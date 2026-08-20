// The dashboard, as a single self-contained page. Kept in a .ts file so `tsc`
// carries it into dist/ with everything else — no build step, no asset copying,
// no CDN, no icon font, no sound files. Icons are inline SVG, the rain is a
// canvas, the audio is synthesised with oscillators. Served only to 127.0.0.1.
//
// Note for editors: this is a String.raw template, so a backtick or a dollar-
// brace inside would terminate it. The embedded script uses string
// concatenation throughout for that reason.

export const PAGE = String.raw`<!doctype html>
<html lang="en" data-theme="steel">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZARV // SNIPER</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23101a26'/><text x='16' y='23' font-family='monospace' font-size='19' font-weight='bold' fill='%2300e5ff' text-anchor='middle'>Z</text></svg>">
<style>
  /* ── STEEL: default. Lifted surfaces, softer overlays, still neon. ── */
  html[data-theme="steel"]{
    --bg:#131b26; --bg2:#182231; --panel:rgba(30,42,58,.9); --panel2:#111a25;
    --line:#31465e; --line2:#456b8c;
    --text:#e9f4fb; --dim:#93aec4;
    --neon:#00e5ff; --neon2:#ff5ad9; --ok:#3ddc84; --warn:#ffc93c; --err:#ff5c76;
    --rain:.07; --scan:.07; --vig:.3; --glow:.5;
  }
  /* ── VOID: the darker one, kept behind the toggle. ── */
  html[data-theme="void"]{
    --bg:#04050a; --bg2:#070a12; --panel:rgba(10,14,24,.84); --panel2:#060911;
    --line:#15304a; --line2:#1e4a6b;
    --text:#d6f5ff; --dim:#4d7d99;
    --neon:#00f0ff; --neon2:#ff2bd6; --ok:#39ff8b; --warn:#ffd93d; --err:#ff3b5c;
    --rain:.16; --scan:.2; --vig:.72; --glow:.75;
  }

  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--text);overflow-x:hidden;transition:background .35s;
    font:13px/1.6 ui-monospace,"SF Mono",Menlo,Consolas,"Courier New",monospace}
  #rain{position:fixed;inset:0;z-index:0;opacity:var(--rain);pointer-events:none;transition:opacity .35s}
  body::after{content:'';position:fixed;inset:0;z-index:9999;pointer-events:none;
    background:repeating-linear-gradient(180deg,rgba(0,0,0,0) 0 2px,rgba(0,0,0,var(--scan)) 2px 4px);
    mix-blend-mode:multiply}
  body::before{content:'';position:fixed;inset:0;z-index:9998;pointer-events:none;
    background:radial-gradient(ellipse at 50% 40%,transparent 42%,rgba(0,0,0,var(--vig)) 100%)}
  .wrap{position:relative;z-index:1}
  svg.i{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.7;
    stroke-linecap:round;stroke-linejoin:round;flex:none}

  /* ── boot ── */
  #boot{position:fixed;inset:0;z-index:10000;background:var(--bg);
    display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--ok)}
  #boot .lines{width:min(560px,86vw);white-space:pre-wrap}
  #boot.done{opacity:0;transform:scale(1.04);transition:.5s;pointer-events:none}
  .cursor{display:inline-block;width:8px;height:15px;background:var(--ok);
    vertical-align:-2px;animation:blink .9s steps(1) infinite}
  @keyframes blink{50%{opacity:0}}

  /* ── header ── */
  header{padding:20px 26px 16px;border-bottom:1px solid var(--line);
    background:linear-gradient(180deg,rgba(0,229,255,.06),transparent);
    display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brandrow{display:flex;align-items:center;gap:13px}
  .mark{width:38px;height:38px;border:1px solid var(--neon);border-radius:6px;
    display:grid;place-items:center;color:var(--neon);
    box-shadow:0 0 16px rgba(0,229,255,calc(var(--glow) * .4)) inset,0 0 12px rgba(0,229,255,.18)}
  .mark svg{width:20px;height:20px}
  .logo{font-size:29px;font-weight:800;letter-spacing:.3em;line-height:1;position:relative;
    color:var(--neon);text-shadow:0 0 10px rgba(0,229,255,var(--glow))}
  .logo::before,.logo::after{content:attr(data-t);position:absolute;left:0;top:0;width:100%;overflow:hidden}
  .logo::before{color:var(--neon2);animation:g1 3.4s infinite steps(1);clip-path:inset(0 0 62% 0)}
  .logo::after{color:var(--ok);animation:g2 4.1s infinite steps(1);clip-path:inset(58% 0 0 0)}
  @keyframes g1{0%,92%{transform:none;opacity:0}93%{transform:translateX(-3px);opacity:.8}
    95%{transform:translateX(2px)}97%{transform:none;opacity:0}}
  @keyframes g2{0%,88%{transform:none;opacity:0}89%{transform:translateX(3px);opacity:.75}
    92%{transform:translateX(-2px)}94%{transform:none;opacity:0}}
  .sub{color:var(--dim);font-size:10.5px;letter-spacing:.26em;margin-top:7px}
  .hdr-right{display:flex;align-items:center;gap:15px;flex-wrap:wrap}
  .status-leds{display:flex;gap:13px;font-size:10px;letter-spacing:.14em;color:var(--dim)}
  .led{display:flex;align-items:center;gap:6px}
  .led i{width:7px;height:7px;border-radius:50%;background:var(--line2);display:block;transition:.25s}
  .led.on i{background:var(--ok);box-shadow:0 0 9px var(--ok)}
  .led.err i{background:var(--err);box-shadow:0 0 9px var(--err)}
  .chip{background:none;border:1px solid var(--line2);color:var(--dim);border-radius:5px;
    padding:7px 11px;font:10px ui-monospace,monospace;letter-spacing:.14em;cursor:pointer;
    display:inline-flex;align-items:center;gap:7px;transition:.2s}
  .chip:hover{color:var(--text);border-color:var(--neon)}
  .chip.on{color:var(--neon);border-color:var(--neon);box-shadow:0 0 12px rgba(0,229,255,.22)}
  .chip.locked{color:var(--warn);border-color:var(--warn);animation:blink 1.4s steps(1) infinite}

  main{max-width:1280px;margin:0 auto;padding:22px;
    display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.08fr);gap:18px}
  @media(max-width:920px){main{grid-template-columns:1fr}}

  .card{background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:17px;
    margin-bottom:18px;position:relative;backdrop-filter:blur(8px)}
  .card::before,.card::after{content:'';position:absolute;width:13px;height:13px;pointer-events:none}
  .card::before{top:-1px;left:-1px;border-top:2px solid var(--neon);border-left:2px solid var(--neon)}
  .card::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--neon);border-right:2px solid var(--neon)}
  .card h2{margin:0 0 14px;font-size:10.5px;letter-spacing:.24em;color:var(--neon);
    text-transform:uppercase;display:flex;align-items:center;gap:9px}
  .card h2::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--line2),transparent)}

  label{display:block;font-size:10px;color:var(--dim);margin:12px 0 5px;letter-spacing:.16em;text-transform:uppercase}
  input,select,textarea{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:4px;padding:10px 12px;font:13px ui-monospace,Menlo,Consolas,monospace;transition:.18s}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--neon);
    box-shadow:0 0 0 1px rgba(0,229,255,.3),0 0 18px rgba(0,229,255,.12)}
  textarea{resize:vertical;min-height:92px;letter-spacing:.06em}
  textarea.masked{-webkit-text-security:disc;text-security:disc}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:11px}

  button{background:var(--panel2);border:1px solid var(--line2);color:var(--text);border-radius:4px;
    padding:11px 15px;font:600 11.5px ui-monospace,Menlo,monospace;letter-spacing:.13em;
    cursor:pointer;text-transform:uppercase;transition:.18s;
    display:inline-flex;align-items:center;justify-content:center;gap:8px}
  button:hover:not(:disabled){border-color:var(--neon);color:var(--neon);box-shadow:0 0 16px rgba(0,229,255,.18)}
  button:disabled{opacity:.34;cursor:not-allowed}
  button.fire{width:100%;margin-top:16px;padding:17px;font-size:15px;letter-spacing:.4em;
    border:1px solid var(--neon2);color:var(--neon2);background:rgba(255,90,217,.08)}
  button.fire:hover:not(:disabled){color:#fff;background:rgba(255,90,217,.2);
    box-shadow:0 0 34px rgba(255,90,217,.42);animation:shake .28s}
  @keyframes shake{25%{transform:translateX(-1.5px)}75%{transform:translateX(1.5px)}}
  button.fire:disabled{border-color:var(--line);color:var(--dim);background:none}
  .armed{animation:armed 1.05s infinite}
  @keyframes armed{50%{box-shadow:0 0 30px rgba(255,90,217,.4)}}
  .hint{font-size:10.5px;color:var(--dim);margin-top:8px;line-height:1.65}

  #cd{display:none;margin-bottom:18px;text-align:center;padding:19px}
  #cd .lbl{font-size:10px;letter-spacing:.3em;color:var(--dim);margin-bottom:9px}
  #cd .t{font-size:42px;font-weight:800;letter-spacing:.09em;color:var(--neon);
    text-shadow:0 0 18px rgba(0,229,255,var(--glow));font-variant-numeric:tabular-nums}
  #cd.closing .t{color:var(--warn);text-shadow:0 0 18px rgba(255,201,60,var(--glow))}
  #cd.over .t{color:var(--err);font-size:26px}

  .wallets{display:flex;flex-direction:column;gap:7px;margin-top:13px}
  .w{display:flex;align-items:center;gap:11px;background:var(--panel2);
    border:1px solid var(--line);border-left:2px solid var(--dim);
    border-radius:4px;padding:10px 12px;font-size:11.5px;transition:.22s}
  .w .dot{width:7px;height:7px;border-radius:50%;background:var(--dim);flex:none}
  .w.ok{border-left-color:var(--ok)} .w.ok .dot{background:var(--ok);box-shadow:0 0 9px var(--ok)}
  .w.err{border-left-color:var(--err)} .w.err .dot{background:var(--err);box-shadow:0 0 9px var(--err)}
  .w.run{border-left-color:var(--warn)} .w.run .dot{background:var(--warn);animation:blink .55s infinite}
  .w .addr{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.03em}
  .w .st{font-size:10px;color:var(--dim);letter-spacing:.13em;text-transform:uppercase}

  .kv{display:flex;justify-content:space-between;gap:15px;padding:8px 0;
    border-bottom:1px solid var(--line);font-size:12px}
  .kv:last-child{border-bottom:none}
  .kv span:first-child{color:var(--dim);letter-spacing:.1em;text-transform:uppercase;font-size:10px;padding-top:2px}
  .kv span:last-child{text-align:right;word-break:break-all}
  .badge{display:inline-block;padding:3px 11px;border-radius:3px;font-size:9.5px;letter-spacing:.2em}
  .badge.live{background:rgba(61,220,132,.13);color:var(--ok);border:1px solid rgba(61,220,132,.45)}
  .badge.off{background:rgba(255,92,118,.13);color:var(--err);border:1px solid rgba(255,92,118,.45)}

  #log{background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:13px;
    height:296px;overflow:auto;font-size:11.5px;white-space:pre-wrap;word-break:break-word;line-height:1.75}
  #log::-webkit-scrollbar{width:7px}
  #log::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
  #log .l{padding:1px 0;color:var(--dim)}
  #log .l::before{content:'> ';color:var(--line2)}
  #log .l.ok{color:var(--ok)} #log .l.err{color:var(--err)} #log .l.hi{color:var(--neon)}
  .empty{color:var(--dim);font-size:11.5px;padding:11px 0;letter-spacing:.08em}
  footer{text-align:center;color:var(--dim);font-size:10px;padding:26px;letter-spacing:.22em}
</style>
</head>
<body>

<div id="boot"><div class="lines" id="bootlines"></div></div>
<canvas id="rain"></canvas>

<div class="wrap">
<header>
  <div class="brandrow">
    <div class="mark">
      <svg viewBox="0 0 24 24" class="i"><path d="M12 2 4 6v6c0 4.4 3.4 8.2 8 10 4.6-1.8 8-5.6 8-10V6z"/><path d="M9 9h6l-6 6h6"/></svg>
    </div>
    <div>
      <div class="logo" data-t="ZARV">ZARV</div>
      <div class="sub">SEADROP SNIPER // ON-CHAIN CALLDATA // LOCAL NODE</div>
    </div>
  </div>
  <div class="hdr-right">
    <div class="status-leds">
      <div class="led" id="led-link"><i></i>LINK</div>
      <div class="led" id="led-wallet"><i></i>KEYS</div>
      <div class="led" id="led-drop"><i></i>DROP</div>
    </div>
    <button class="chip" id="theme" type="button">
      <svg viewBox="0 0 24 24" class="i"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>
      <span id="themetxt">STEEL</span>
    </button>
    <button class="chip locked" id="snd" type="button">
      <svg viewBox="0 0 24 24" class="i"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
      <span id="sndtxt">ENABLE SND</span>
    </button>
  </div>
</header>

<main>
  <div>
    <div class="card">
      <h2><svg viewBox="0 0 24 24" class="i"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><circle cx="17.5" cy="14.5" r="1.3"/></svg>Wallets</h2>
      <textarea id="keys" class="masked" placeholder="one private key per line" spellcheck="false"></textarea>
      <div class="row" style="margin-top:10px">
        <button type="button" id="reveal">
          <svg viewBox="0 0 24 24" class="i"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>
          <span id="revealtxt">Show keys</span>
        </button>
        <button type="button" id="load">
          <svg viewBox="0 0 24 24" class="i"><path d="M12 3v11M8 10.5l4 4 4-4"/><path d="M4 17v3h16v-3"/></svg>Load
        </button>
      </div>
      <div class="hint">Keys stay on this machine. This page is served by your own process &mdash; nothing is uploaded anywhere.</div>
      <div class="wallets" id="wallets"></div>
    </div>

    <div class="card">
      <h2><svg viewBox="0 0 24 24" class="i"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>Target</h2>
      <label>Chain</label>
      <select id="chain"></select>
      <label>NFT contract</label>
      <input id="contract" placeholder="0x..." spellcheck="false">
      <div class="row">
        <div><label>Qty / wallet</label><input id="qty" value="1"></div>
        <div><label>RPC (blank = public)</label><input id="rpc" placeholder="URL or Alchemy key" spellcheck="false"></div>
      </div>
      <button type="button" id="check" style="width:100%;margin-top:15px">
        <svg viewBox="0 0 24 24" class="i"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>Scan drop
      </button>
    </div>

    <div class="card">
      <h2><svg viewBox="0 0 24 24" class="i"><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5z"/></svg>Gas &amp; timing</h2>
      <div class="row">
        <div><label>Priority fee (gwei)</label><input id="tip" value="0.05"></div>
        <div><label>Max fee (gwei)</label><input id="max" value="1"></div>
      </div>
      <div class="hint">Your ceiling reserves 250,000 &times; max fee from the wallet before the tx is accepted. High ceilings bounce thin wallets.</div>
      <label>Fire at (HH:MM:SS &mdash; blank = now)</label>
      <input id="at" placeholder="blank = fire immediately">
      <button class="fire" id="fire" disabled>
        <svg viewBox="0 0 24 24" class="i" style="width:17px;height:17px"><path d="M12 2c3.5 3.4 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2-6.6 5.5-10z"/><path d="M12 13c1.2 1.2 1.8 2.2 1.8 3.2a1.8 1.8 0 0 1-3.6 0c0-1 .6-2 1.8-3.2z"/></svg>
        FIRE
      </button>
    </div>
  </div>

  <div>
    <div class="card" id="cd">
      <div class="lbl" id="cdlbl">STAGE OPENS IN</div>
      <div class="t" id="cdt">--:--:--</div>
    </div>
    <div class="card">
      <h2><svg viewBox="0 0 24 24" class="i"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>Drop</h2>
      <div id="drop"><div class="empty">// awaiting scan &mdash; enter a contract and hit SCAN DROP</div></div>
    </div>
    <div class="card">
      <h2><svg viewBox="0 0 24 24" class="i"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M6.5 9.5 9.5 12l-3 2.5M12 15h5.5"/></svg>Live feed</h2>
      <div id="log"><div class="l">system idle</div></div>
    </div>
  </div>
</main>

<footer>ZARV SNIPER // BOUND TO 127.0.0.1 // KEYS NEVER LEAVE THIS MACHINE</footer>
</div>

<script>
var $ = function(id){ return document.getElementById(id); };
var wallets = [], dropOk = false, dropData = null;

/* ══════════ audio ══════════
   Browsers refuse to start an AudioContext until the user has interacted with
   the page — that is why the first build stayed silent. The context is created
   lazily and resumed on the first real gesture, and the SND chip shows LOCKED
   until that has happened so the state is never a mystery. */
var AC = null, audioReady = false, soundOn = true;

function unlockAudio(){
  if(audioReady) return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if(AC.state === 'suspended') AC.resume();
    audioReady = true;
    $('snd').className = 'chip on';
    $('sndtxt').textContent = 'SND ON';
  }catch(e){}
}
['pointerdown','keydown','touchstart'].forEach(function(ev){
  window.addEventListener(ev, unlockAudio, { once:false, passive:true });
});

function tone(freq, dur, type, vol, slideTo){
  if(!soundOn || !audioReady || !AC) return;
  try{
    if(AC.state === 'suspended') AC.resume();
    var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }catch(e){}
}
function noise(dur, vol){
  if(!soundOn || !audioReady || !AC) return;
  try{
    var n = Math.floor(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for(var i=0;i<n;i++) d[i] = (Math.random()*2-1) * (1 - i/n);
    var s = AC.createBufferSource(); s.buffer = b;
    var f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100;
    var g = AC.createGain(); g.gain.value = vol || 0.05;
    s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
  }catch(e){}
}
var SFX = {
  blip: function(){ tone(1250, 0.04, 'square', 0.03); },
  tick: function(){ tone(1900, 0.022, 'square', 0.018); },
  ok:   function(){ tone(660, 0.1, 'sine', 0.075); setTimeout(function(){ tone(990, 0.17, 'sine', 0.075); }, 90); },
  err:  function(){ tone(210, 0.34, 'sawtooth', 0.075, 70); },
  scan: function(){ tone(420, 0.26, 'sine', 0.05, 1600); },
  fire: function(){ noise(0.36, 0.09); tone(130, 0.55, 'sawtooth', 0.09, 900); },
  win:  function(){ [523,659,784,1047].forEach(function(f,i){ setTimeout(function(){ tone(f, 0.22, 'sine', 0.085); }, i*95); }); }
};

$('snd').onclick = function(){
  if(!audioReady){ unlockAudio(); SFX.ok(); return; }
  soundOn = !soundOn;
  this.className = 'chip' + (soundOn ? ' on' : '');
  $('sndtxt').textContent = soundOn ? 'SND ON' : 'SND OFF';
  if(soundOn) SFX.blip();
};

/* ══════════ theme ══════════ */
$('theme').onclick = function(){
  var next = document.documentElement.dataset.theme === 'steel' ? 'void' : 'steel';
  document.documentElement.dataset.theme = next;
  $('themetxt').textContent = next.toUpperCase();
  SFX.blip();
};

/* ══════════ matrix rain ══════════ */
(function(){
  var cv = $('rain'), cx = cv.getContext('2d'), cols, drops;
  var GLYPHS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>[]{}/\\|=+*';
  function size(){
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    cols = Math.floor(cv.width / 15);
    drops = []; for(var i=0;i<cols;i++) drops[i] = Math.random() * -70;
  }
  size(); window.addEventListener('resize', size);
  setInterval(function(){
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    cx.fillStyle = bg ? bg + '18' : 'rgba(4,5,10,.09)';
    cx.fillRect(0,0,cv.width,cv.height);
    cx.font = '14px monospace';
    for(var i=0;i<cols;i++){
      cx.fillStyle = Math.random() > 0.985 ? '#ff5ad9' : '#00e5ff';
      cx.fillText(GLYPHS[Math.floor(Math.random()*GLYPHS.length)], i*15, drops[i]*15);
      if(drops[i]*15 > cv.height && Math.random() > 0.972) drops[i] = 0;
      drops[i]++;
    }
  }, 58);
})();

/* ══════════ boot ══════════ */
(function(){
  var LINES = [
    'ZARV SNIPER v1.0 // initialising','',
    '[ok] local node .............. 127.0.0.1',
    '[ok] seadrop abi ............. loaded',
    '[ok] calldata engine ......... on-chain',
    '[ok] keystore ................ memory only',
    '[ok] uplink .................. none (by design)','',
    'ready.'
  ];
  var el = $('bootlines'), li = 0, ci = 0, out = '';
  function step(){
    if(li >= LINES.length){
      setTimeout(function(){
        $('boot').className = 'done';
        setTimeout(function(){ $('boot').style.display = 'none'; }, 520);
        $('led-link').className = 'led on';
      }, 320);
      return;
    }
    var line = LINES[li];
    if(ci < line.length){
      out += line[ci++];
      el.innerHTML = out + '<span class="cursor"></span>';
      if(ci % 3 === 0) SFX.tick();
      setTimeout(step, 9);
    } else {
      out += '\n'; li++; ci = 0;
      el.innerHTML = out + '<span class="cursor"></span>';
      setTimeout(step, 55);
    }
  }
  setTimeout(step, 240);
})();

/* ══════════ log ══════════ */
function log(text, cls){
  var el = $('log');
  if(el.dataset.clean !== '1'){ el.innerHTML = ''; el.dataset.clean = '1'; }
  var d = document.createElement('div');
  d.className = 'l ' + (cls || '');
  d.textContent = text;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
new EventSource('/api/events').onmessage = function(e){
  var line = JSON.parse(e.data);
  var cls = /fail|revert|error|not active/i.test(line) ? 'err'
          : /success|verified|sent|minted|ok\b/i.test(line) ? 'ok' : '';
  log(line, cls);
  if(cls === 'ok') SFX.blip();
};

/* ══════════ countdown ══════════ */
var pad = function(n){ return n < 10 ? '0' + n : '' + n; };
setInterval(function(){
  if(!dropData) return;
  var now = Math.floor(Date.now()/1000), box = $('cd'), t = $('cdt'), lbl = $('cdlbl');
  var left, mode;
  if(now < dropData.startUnix){ left = dropData.startUnix - now; mode = 'open'; }
  else if(now <= dropData.endUnix){ left = dropData.endUnix - now; mode = 'close'; }
  else { box.className = 'card over'; lbl.textContent = 'STAGE'; t.textContent = 'CLOSED'; return; }
  box.className = 'card' + (mode === 'close' ? ' closing' : '');
  lbl.textContent = mode === 'open' ? 'STAGE OPENS IN' : 'STAGE CLOSES IN';
  var dd = Math.floor(left/86400);
  t.textContent = (dd > 0 ? dd + 'd ' : '') + pad(Math.floor((left%86400)/3600)) + ':' +
    pad(Math.floor((left%3600)/60)) + ':' + pad(left%60);
  if(mode === 'open' && left <= 5) SFX.tick();
  if(mode === 'open' && left === 0) SFX.ok();
}, 1000);

/* ══════════ wallets ══════════ */
$('reveal').onclick = function(){
  SFX.blip();
  var t = $('keys');
  t.classList.toggle('masked');
  $('revealtxt').textContent = t.classList.contains('masked') ? 'Show keys' : 'Hide keys';
};
$('keys').addEventListener('keydown', function(){ SFX.tick(); });

function renderWallets(state){
  $('wallets').innerHTML = wallets.map(function(w){
    var s = (state && state[w.address]) || {};
    return '<div class="w ' + (s.cls || '') + '"><div class="dot"></div>' +
      '<div class="addr">' + w.address + '</div>' +
      '<div class="st">' + (s.text || 'ready') + '</div></div>';
  }).join('');
}
function armCheck(){
  var ready = wallets.length > 0 && dropOk;
  $('fire').disabled = !ready;
  $('fire').className = 'fire' + (ready ? ' armed' : '');
}

$('load').onclick = function(){
  SFX.blip();
  var keys = $('keys').value.split('\n').map(function(k){ return k.trim(); }).filter(Boolean);
  if(!keys.length){ SFX.err(); return log('no keys entered', 'err'); }
  fetch('/api/wallets', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ keys: keys }) })
  .then(function(r){ return r.json(); }).then(function(r){
    if(r.error){ SFX.err(); $('led-wallet').className = 'led err'; return log(r.error, 'err'); }
    wallets = r.wallets; renderWallets();
    $('led-wallet').className = 'led on';
    log(wallets.length + ' wallet(s) loaded', 'ok');
    if(r.invalid) log(r.invalid + ' key(s) invalid, skipped', 'err');
    SFX.ok(); armCheck();
  });
};

/* ══════════ scan ══════════ */
var kv = function(k, v){ return '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>'; };

$('check').onclick = function(){
  SFX.scan();
  var body = { chain: $('chain').value, contract: $('contract').value.trim(),
    rpcUrl: $('rpc').value.trim(), quantity: Number($('qty').value) || 1 };
  if(!/^0x[a-fA-F0-9]{40}$/.test(body.contract)){ SFX.err(); return log('contract address looks wrong', 'err'); }
  $('check').disabled = true;
  $('drop').innerHTML = '<div class="empty">// scanning chain state...</div>';
  fetch('/api/drop', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  .then(function(r){ return r.json(); }).then(function(d){
    if(d.error){
      dropOk = false; dropData = null;
      $('cd').style.display = 'none';
      $('led-drop').className = 'led err';
      $('drop').innerHTML = '<div class="empty" style="color:var(--err)">' + d.error + '</div>';
      SFX.err();
    } else {
      dropOk = true; dropData = d;
      $('cd').style.display = 'block';
      $('led-drop').className = 'led on';
      $('drop').innerHTML =
        kv('Status', '<span class="badge ' + (d.live ? 'live">LIVE' : 'off">NOT ACTIVE') + '</span>') +
        kv('SeaDrop', d.seadrop) + kv('Fee recipient', d.feeRecipient) +
        kv('Price', d.price + ' x ' + body.quantity + ' = ' + d.total) +
        kv('Max / wallet', d.maxPerWallet) + kv('Opens', d.start) + kv('Closes', d.end) +
        kv('Calldata', d.calldataBytes + ' bytes');
      log('drop read ok -- ' + (d.live ? 'stage is LIVE' : 'stage not active yet'), d.live ? 'ok' : '');
      SFX.ok();
    }
    $('check').disabled = false; armCheck();
  }).catch(function(err){
    dropOk = false; SFX.err(); log(String(err), 'err');
    $('check').disabled = false; armCheck();
  });
};

/* ══════════ fire ══════════ */
$('fire').onclick = function(){
  if(!confirm('Send ' + wallets.length + ' transaction(s)?')) return;
  SFX.fire();
  $('fire').disabled = true; $('fire').className = 'fire';
  var state = {};
  wallets.forEach(function(w){ state[w.address] = { cls:'run', text:'sending' }; });
  renderWallets(state);
  var body = { chain: $('chain').value, contract: $('contract').value.trim(),
    rpcUrl: $('rpc').value.trim(), quantity: Number($('qty').value) || 1,
    tip: $('tip').value.trim() || '0.05', max: $('max').value.trim() || '1',
    at: $('at').value.trim() };
  fetch('/api/mint', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) })
  .then(function(r){ return r.json(); }).then(function(res){
    if(res.error){ log(res.error, 'err'); SFX.err(); }
    else {
      res.results.forEach(function(r){
        state[r.wallet] = r.status === 'success' ? { cls:'ok', text:'minted' }
                                                : { cls:'err', text: r.error || 'failed' };
      });
      renderWallets(state);
      var ok = res.results.filter(function(r){ return r.status === 'success'; }).length;
      log('done -- ' + ok + '/' + res.results.length + ' minted', ok ? 'ok' : 'err');
      res.results.forEach(function(r){
        if(r.txHash) log('  ' + r.wallet + '  ' + res.explorer + '/tx/' + r.txHash, 'hi');
      });
      if(ok) SFX.win(); else SFX.err();
    }
    armCheck();
  }).catch(function(err){ log(String(err), 'err'); SFX.err(); armCheck(); });
};

fetch('/api/chains').then(function(r){ return r.json(); }).then(function(cs){
  $('chain').innerHTML = cs.map(function(c){
    return '<option value="' + c.key + '">' + c.name + ' -- ' + c.chainId + '</option>';
  }).join('');
});
</script>
</body>
</html>`;