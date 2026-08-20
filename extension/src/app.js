/**
 * ZARV — extension dashboard
 * --------------------------
 * Everything here runs inside the extension page. There is no backend: the
 * vault is local storage, the signing is WebCrypto + viem in this tab, and the
 * only network call the extension can make is to the Robinhood RPC listed in
 * the manifest. Nothing is ever posted to a server of ours, because there is
 * no server of ours.
 */

import { vaultExists, createVault, unlockVault, getWallets, lockVault } from './vault.js';
import { readDrop, mintWith, balanceOf, addressFor, rpcUrl, explorerTx, GAS_LIMIT } from './chain.js';

const $ = (id) => document.getElementById(id);
let wallets = [], plan = null, dropInfo = null;

/* ───────── audio ───────── */
let AC = null, audioReady = false, soundOn = true;
function unlockAudio() {
  if (audioReady) return;
  try {
    AC = AC || new AudioContext();
    if (AC.state === 'suspended') AC.resume();
    audioReady = true;
    $('snd').className = 'chip on';
    $('sndtxt').textContent = 'SND ON';
  } catch {}
}
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, unlockAudio, { passive: true }));

function tone(f, d, type, vol, to) {
  if (!soundOn || !audioReady) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + d + 0.02);
  } catch {}
}
function noise(d, vol) {
  if (!soundOn || !audioReady) return;
  try {
    const n = Math.floor(AC.sampleRate * d), b = AC.createBuffer(1, n, AC.sampleRate), c = b.getChannelData(0);
    for (let i = 0; i < n; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = AC.createBufferSource(); s.buffer = b;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100;
    const g = AC.createGain(); g.gain.value = vol || 0.06;
    s.connect(f); f.connect(g); g.connect(AC.destination); s.start();
  } catch {}
}
const SFX = {
  blip: () => tone(1250, 0.04, 'square', 0.03),
  tick: () => tone(1900, 0.022, 'square', 0.018),
  ok:   () => { tone(660, 0.1, 'sine', 0.075); setTimeout(() => tone(990, 0.17, 'sine', 0.075), 90); },
  err:  () => tone(210, 0.34, 'sawtooth', 0.075, 70),
  scan: () => tone(420, 0.26, 'sine', 0.05, 1600),
  fire: () => { noise(0.36, 0.09); tone(130, 0.55, 'sawtooth', 0.09, 900); },
  win:  () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.085), i * 95)),
};
$('snd').onclick = () => {
  if (!audioReady) { unlockAudio(); SFX.ok(); return; }
  soundOn = !soundOn;
  $('snd').className = 'chip' + (soundOn ? ' on' : '');
  $('sndtxt').textContent = soundOn ? 'SND ON' : 'SND OFF';
  if (soundOn) SFX.blip();
};

/* ───────── theme ───────── */
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'steel' ? 'void' : 'steel';
  document.documentElement.dataset.theme = next;
  $('themetxt').textContent = next.toUpperCase();
  chrome.storage.local.set({ zarv_theme: next });
  SFX.blip();
};
chrome.storage.local.get('zarv_theme').then((g) => {
  if (g.zarv_theme) {
    document.documentElement.dataset.theme = g.zarv_theme;
    $('themetxt').textContent = g.zarv_theme.toUpperCase();
  }
});

/* ───────── matrix rain ───────── */
(function () {
  const cv = $('rain'), cx = cv.getContext('2d');
  const G = '01アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF<>[]{}/|=+*';
  let cols, drops;
  const size = () => {
    cv.width = innerWidth; cv.height = innerHeight;
    cols = Math.floor(cv.width / 15);
    drops = Array.from({ length: cols }, () => Math.random() * -70);
  };
  size(); addEventListener('resize', size);
  setInterval(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    cx.fillStyle = bg + '18';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.font = '14px monospace';
    for (let i = 0; i < cols; i++) {
      cx.fillStyle = Math.random() > 0.985 ? '#ff5ad9' : '#00e5ff';
      cx.fillText(G[Math.floor(Math.random() * G.length)], i * 15, drops[i] * 15);
      if (drops[i] * 15 > cv.height && Math.random() > 0.972) drops[i] = 0;
      drops[i]++;
    }
  }, 58);
})();

/* ───────── log ───────── */
function log(text, cls) {
  const el = $('log');
  if (el.dataset.clean !== '1') { el.innerHTML = ''; el.dataset.clean = '1'; }
  const d = document.createElement('div');
  d.className = 'l ' + (cls || '');
  d.textContent = text;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

/* ───────── lock screen ───────── */
function lockUI(mode, msg) {
  const create = mode === 'create';
  $('lockmode').textContent = create ? 'CREATE VAULT' : 'UNLOCK';
  $('lockform').innerHTML = create
    ? '<label>Private keys (one per line)</label>' +
      '<textarea id="ck" class="masked" spellcheck="false"></textarea>' +
      '<label>Password</label><input id="cp" type="password">' +
      '<label>Confirm password</label><input id="cp2" type="password">' +
      '<button class="pri" id="cgo" style="width:100%;margin-top:14px">Encrypt &amp; save</button>' +
      '<div class="hint">Encrypted with AES-GCM in this browser. Forget the password and the keys are gone &mdash; there is no recovery.</div>'
    : '<label>Password</label><input id="up" type="password" autofocus>' +
      '<button class="pri" id="ugo" style="width:100%;margin-top:14px">Unlock</button>' +
      '<div class="hint" id="wipehint">Wrong vault? <a href="#" id="wipe">Erase it</a> and start over.</div>';
  $('lockmsg').textContent = msg || '';
  $('lockmsg').style.color = 'var(--err)';

  if (create) {
    $('cgo').onclick = async () => {
      const keys = $('ck').value.split('\n').map((k) => k.trim()).filter(Boolean);
      const p1 = $('cp').value, p2 = $('cp2').value;
      if (!keys.length) return ($('lockmsg').textContent = 'no keys entered');
      if (p1.length < 8) return ($('lockmsg').textContent = 'password must be 8+ characters');
      if (p1 !== p2) return ($('lockmsg').textContent = 'passwords do not match');
      let parsed;
      try {
        parsed = keys.map((k) => ({ address: addressFor(k), privateKey: k.startsWith('0x') ? k : '0x' + k }));
      } catch {
        return ($('lockmsg').textContent = 'one of those is not a valid private key');
      }
      await createVault(p1, parsed);
      enter(parsed);
    };
  } else {
    const go = async () => {
      try {
        const w = await unlockVault($('up').value);
        enter(w);
      } catch (e) {
        $('lockmsg').textContent = e.message;
        SFX.err();
      }
    };
    $('ugo').onclick = go;
    $('up').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('wipe').onclick = async (e) => {
      e.preventDefault();
      if (!confirm('Erase the stored vault? The keys in it cannot be recovered.')) return;
      await chrome.storage.local.remove('zarv_vault_v1');
      lockUI('create');
    };
  }
}

function enter(w) {
  wallets = w;
  $('lock').style.display = 'none';
  $('app').style.display = 'block';
  renderWallets();
  log(wallets.length + ' wallet(s) unlocked', 'ok');
  SFX.ok();
  refreshBalances();
}

$('lockbtn').onclick = () => {
  lockVault();
  wallets = [];
  location.reload();
};

/* ───────── wallets ───────── */
let balances = {}, wstate = {};
function renderWallets() {
  $('wallets').innerHTML = wallets.map((w) => {
    const s = wstate[w.address] || {};
    const bal = balances[w.address];
    return '<div class="w ' + (s.cls || '') + '"><div class="dot"></div>' +
      '<div class="addr">' + w.address + '</div>' +
      '<div class="bal">' + (bal === undefined ? '' : bal) + '</div>' +
      '<div class="st">' + (s.text || 'ready') + '</div></div>';
  }).join('');
}

async function refreshBalances() {
  const url = rpcUrl($('rpc').value);
  await Promise.all(wallets.map(async (w) => {
    try {
      const b = await balanceOf(url, w.address);
      balances[w.address] = (Number(b) / 1e18).toFixed(5);
    } catch { balances[w.address] = '?'; }
  }));
  renderWallets();
}
$('refresh').onclick = () => { SFX.blip(); refreshBalances(); };

$('manage').onclick = () => {
  SFX.blip();
  const box = $('managebox');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
};
$('cancelkeys').onclick = () => { $('managebox').style.display = 'none'; };
$('savekeys').onclick = async () => {
  const keys = $('newkeys').value.split('\n').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return log('no keys entered', 'err');
  const pw = prompt('Vault password (to re-encrypt):');
  if (!pw) return;
  try {
    await unlockVault(pw); // proves the password before overwriting anything
  } catch {
    SFX.err();
    return log('wrong password - vault unchanged', 'err');
  }
  let parsed;
  try {
    parsed = keys.map((k) => ({ address: addressFor(k), privateKey: k.startsWith('0x') ? k : '0x' + k }));
  } catch {
    SFX.err();
    return log('one of those is not a valid private key', 'err');
  }
  await createVault(pw, parsed);
  wallets = parsed; balances = {}; wstate = {};
  $('newkeys').value = '';
  $('managebox').style.display = 'none';
  renderWallets(); refreshBalances();
  log(parsed.length + ' wallet(s) saved', 'ok');
  SFX.ok();
};

/* ───────── scan ───────── */
const kv = (k, v) => '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>';
function arm() {
  const ready = wallets.length > 0 && !!plan;
  $('fire').disabled = !ready;
  $('fire').className = 'fire' + (ready ? ' armed' : '');
}

$('check').onclick = async () => {
  SFX.scan();
  const nft = $('contract').value.trim();
  const qty = Number($('qty').value) > 0 ? Number($('qty').value) : 1;
  if (!/^0x[a-fA-F0-9]{40}$/.test(nft)) { SFX.err(); return log('contract address looks wrong', 'err'); }
  $('check').disabled = true;
  $('drop').innerHTML = '<div class="empty">// scanning chain state...</div>';
  try {
    const p = await readDrop(rpcUrl($('rpc').value), nft, qty);
    if (!p) {
      plan = null; dropInfo = null;
      $('cd').style.display = 'none';
      $('led-drop').className = 'led err';
      $('drop').innerHTML = '<div class="empty" style="color:var(--err)">No public SeaDrop stage for this contract. ' +
        'Either it is not a SeaDrop collection, the stage is unconfigured, or the drop restricts fee recipients.</div>';
      SFX.err();
    } else {
      plan = p; dropInfo = p.drop;
      $('cd').style.display = 'block';
      $('led-drop').className = 'led on';
      $('drop').innerHTML =
        kv('Status', '<span class="badge ' + (p.live ? 'live">LIVE' : 'off">NOT ACTIVE') + '</span>') +
        kv('Fee recipient', p.feeRecipient) +
        kv('Price', p.priceEth + ' x ' + qty + ' = ' + p.totalEth) +
        kv('Max / wallet', p.drop.maxTotalMintableByWallet) +
        kv('Opens', new Date(p.drop.startTime * 1000).toLocaleString()) +
        kv('Closes', new Date(p.drop.endTime * 1000).toLocaleString()) +
        kv('Calldata', p.calldataBytes + ' bytes');
      log('drop read ok -- ' + (p.live ? 'stage is LIVE' : 'stage not active yet'), p.live ? 'ok' : '');
      if (qty > p.drop.maxTotalMintableByWallet) log('quantity exceeds the per-wallet cap of ' + p.drop.maxTotalMintableByWallet, 'err');
      SFX.ok();
    }
  } catch (e) {
    plan = null; SFX.err(); log(String(e.shortMessage || e.message || e), 'err');
  }
  $('check').disabled = false;
  arm();
};

/* ───────── countdown ───────── */
const pad = (n) => (n < 10 ? '0' + n : '' + n);
setInterval(() => {
  if (!dropInfo) return;
  const now = Math.floor(Date.now() / 1000), box = $('cd'), t = $('cdt'), lbl = $('cdlbl');
  let left, mode;
  if (now < dropInfo.startTime) { left = dropInfo.startTime - now; mode = 'open'; }
  else if (now <= dropInfo.endTime) { left = dropInfo.endTime - now; mode = 'close'; }
  else { box.className = 'card over'; lbl.textContent = 'STAGE'; t.textContent = 'CLOSED'; return; }
  box.className = 'card' + (mode === 'close' ? ' closing' : '');
  lbl.textContent = mode === 'open' ? 'STAGE OPENS IN' : 'STAGE CLOSES IN';
  const dd = Math.floor(left / 86400);
  t.textContent = (dd > 0 ? dd + 'd ' : '') + pad(Math.floor((left % 86400) / 3600)) + ':' +
    pad(Math.floor((left % 3600) / 60)) + ':' + pad(left % 60);
  if (mode === 'open' && left <= 5) SFX.tick();
}, 1000);

/* ───────── fire ───────── */
$('fire').onclick = async () => {
  const tip = $('tip').value.trim() || '0.05';
  const max = $('max').value.trim() || '1';
  if (Number(tip) > Number(max)) { SFX.err(); return log('tip cannot exceed the ceiling - invalid under EIP-1559', 'err'); }

  // The node reserves gasLimit x maxFee up front, so a thin wallet is rejected
  // before the tx is even considered. Catch that here rather than on-chain.
  const need = (Number(GAS_LIMIT) * Number(max) * 1e9 + Number(plan.value)) / 1e18;
  const thin = wallets.filter((w) => balances[w.address] !== undefined &&
    balances[w.address] !== '?' && Number(balances[w.address]) < need);
  if (thin.length) {
    log(thin.length + ' wallet(s) cannot cover ' + need.toFixed(6) + ' ETH (gas reserve + price)', 'err');
    if (!confirm(thin.length + ' wallet(s) look underfunded and will likely be rejected. Send anyway?')) return;
  }

  if (!confirm('Send ' + wallets.length + ' transaction(s)?')) return;
  SFX.fire();
  $('fire').disabled = true; $('fire').className = 'fire';

  const at = $('at').value.trim();
  if (at) {
    const [h, m, s] = at.split(':').map(Number);
    const target = new Date();
    target.setHours(h || 0, m || 0, s || 0, 0);
    if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1);
    const wait = target.getTime() - Date.now();
    log('holding ' + (wait / 1000).toFixed(1) + 's until ' + target.toLocaleTimeString());
    await new Promise((r) => setTimeout(r, wait));
    log('FIRING', 'hi');
  }

  const url = rpcUrl($('rpc').value);
  wallets.forEach((w) => { wstate[w.address] = { cls: 'run', text: 'sending' }; });
  renderWallets();

  const results = await Promise.all(wallets.map(async (w) => {
    try {
      const r = await mintWith(url, w, plan, tip, max, log);
      wstate[w.address] = r.ok ? { cls: 'ok', text: 'minted' } : { cls: 'err', text: 'reverted' };
      renderWallets();
      log(w.address + '  ' + explorerTx(r.hash), r.ok ? 'hi' : 'err');
      return r.ok;
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      wstate[w.address] = { cls: 'err', text: 'failed' };
      renderWallets();
      log(w.address + ' - ' + msg, 'err');
      return false;
    }
  }));

  const ok = results.filter(Boolean).length;
  log('done -- ' + ok + '/' + results.length + ' minted', ok ? 'ok' : 'err');
  if (ok) SFX.win(); else SFX.err();
  refreshBalances();
  arm();
};

/* ───────── boot ───────── */
(async () => {
  // A contract handed over from the site lands here, so "SNIPE" can prefill.
  const params = new URLSearchParams(location.search);
  if (params.get('contract')) $('contract').value = params.get('contract');
  if (params.get('qty')) $('qty').value = params.get('qty');
  lockUI((await vaultExists()) ? 'unlock' : 'create');
})();
