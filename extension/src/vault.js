/**
 * ZARV — key vault
 * ----------------
 * Keys are encrypted with a password before they ever touch chrome.storage.
 * PBKDF2-SHA256 (310k iterations) derives the key, AES-GCM does the sealing —
 * both from the browser's own WebCrypto, no crypto library involved.
 *
 * The decrypted keys live in a module-level variable for the life of the tab
 * and are dropped on lock. Nothing here ever leaves the machine: there is no
 * server in this extension, and no host permission that would let it reach one
 * other than the RPC the user chose.
 */

const ITERATIONS = 310000;
const STORE_KEY = 'zarv_vault_v1';

let unlocked = null; // [{ address, privateKey }] while unlocked, else null

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function vaultExists() {
  const got = await chrome.storage.local.get(STORE_KEY);
  return Boolean(got[STORE_KEY]);
}

export async function createVault(password, wallets) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const payload = enc.encode(JSON.stringify(wallets));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  await chrome.storage.local.set({
    [STORE_KEY]: { v: 1, salt: b64(salt), iv: b64(iv), data: b64(cipher) },
  });
  unlocked = wallets;
}

export async function unlockVault(password) {
  const got = await chrome.storage.local.get(STORE_KEY);
  const rec = got[STORE_KEY];
  if (!rec) throw new Error('no vault yet');
  const key = await deriveKey(password, unb64(rec.salt));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.data));
  } catch {
    // AES-GCM fails authentication on a wrong password — there is no separate
    // password check to leak anything.
    throw new Error('wrong password');
  }
  unlocked = JSON.parse(dec.decode(plain));
  return unlocked;
}

export function getWallets() {
  return unlocked;
}

export function lockVault() {
  unlocked = null;
}

export async function destroyVault() {
  await chrome.storage.local.remove(STORE_KEY);
  unlocked = null;
}
