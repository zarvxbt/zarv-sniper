/**
 * ZARV MINT SNIPER
 * ----------------
 * On-chain SeaDrop public mint sniper.
 * Built by ZARV.
 */

import readline from 'readline';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain, listChains } from './chains.js';
import { executeUniversalMint } from './mint.js';
import type { MintConfig, Wallet } from './types.js';

// ── Defaults tuned for Robinhood Chain ──
// Base fee there sits around 0.02 gwei, so a 1 gwei ceiling is plenty of room.
// A high ceiling is NOT free: a node reserves gasLimit x maxFee from your
// balance before it will even accept the tx, so 50 gwei bounces thin wallets.
const DEFAULT_PRIORITY_FEE = '0.05'; // gwei
const DEFAULT_MAX_GAS_PRICE = '1';   // gwei
const GAS_LIMIT = 250_000;

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ── Masked input ──
// readline echoes every keystroke by default. We hook its output writer so that
// while `muted` is on, each character is replaced with a star. The key itself
// still arrives intact in the callback — only the screen is masked. Nothing is
// written to disk, and nothing is left visible in your scrollback.
let muted = false;
const rlAny = rl as any;
rlAny._writeToOutput = function (stringToWrite: string) {
  if (!muted) {
    rlAny.output.write(stringToWrite);
    return;
  }
  if (stringToWrite.includes('\n') || stringToWrite.includes('\r')) {
    rlAny.output.write('\n');
    return;
  }
  rlAny.output.write('*');
};

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

// Prompt is printed unmasked, then the mask goes on for whatever is typed.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function banner() {
  console.log('');
  console.log(C.magenta + C.bold + '  ╔═══════════════════════════════════════════╗' + C.reset);
  console.log(C.magenta + C.bold + '  ║           Z A R V   S N I P E R           ║' + C.reset);
  console.log(C.magenta + C.bold + '  ║     SeaDrop · on-chain calldata · fast     ║' + C.reset);
  console.log(C.magenta + C.bold + '  ╚═══════════════════════════════════════════╝' + C.reset);
  console.log(C.dim + '            built by ZARV — Ctrl+C to quit' + C.reset);
  console.log('');
}

async function main() {
  banner();

  // ── Step 1: wallets ──
  console.log(C.bold + C.cyan + 'Step 1 — Private keys' + C.reset);
  console.log(C.dim + '  One per line — typing is hidden. Blank line when done.' + C.reset);
  console.log(C.dim + '  Each key is confirmed back by its address. Nothing is saved to disk.' + C.reset);

  const wallets: Wallet[] = [];
  let i = 1;
  while (true) {
    const key = await askHidden(`  › key ${i}: `);
    if (!key) break;
    try {
      const normalized = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
      const account = privateKeyToAccount(normalized);
      wallets.push({ address: account.address, privateKey: normalized });
      console.log(C.green + `  ✓ [W${i - 1}] ${account.address}` + C.reset);
      i++;
    } catch {
      console.log(C.red + '  ✗ Not a valid private key — try again.' + C.reset);
    }
  }

  if (wallets.length === 0) {
    console.log(C.red + '\n  No wallets loaded. Exiting.' + C.reset);
    rl.close();
    return;
  }
  console.log(C.dim + `  ${wallets.length} wallet(s) loaded.\n` + C.reset);

  // ── Step 2: chain ──
  console.log(C.bold + C.cyan + 'Step 2 — Chain' + C.reset);
  const chains = listChains();
  chains.forEach((c, idx) => {
    const info = getChain(c);
    console.log(C.dim + `    ${idx + 1}) ${info.name}  — chain id ${info.chainId}` + C.reset);
  });
  const chainPick = await ask(`  › choose 1-${chains.length}: `);
  const chainKey = chains[Number(chainPick) - 1] || chains[0];
  const chainInfo = getChain(chainKey);
  console.log(C.green + `  ✓ ${chainInfo.name}\n` + C.reset);

  // ── Step 3: contract ──
  console.log(C.bold + C.cyan + 'Step 3 — NFT contract' + C.reset);
  const contractAddress = await ask('  › contract address (0x...): ');
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    console.log(C.red + '  ✗ That is not a valid contract address. Exiting.' + C.reset);
    rl.close();
    return;
  }
  console.log('');

  // ── Step 4: quantity ──
  console.log(C.bold + C.cyan + 'Step 4 — Quantity' + C.reset);
  const qtyRaw = await ask('  › NFTs per wallet [1]: ');
  const quantity = Number(qtyRaw) > 0 ? Number(qtyRaw) : 1;
  console.log('');

  // ── Step 5: gas ──
  console.log(C.bold + C.cyan + 'Step 5 — Gas' + C.reset);
  console.log(
    C.dim +
      `  Your ceiling reserves ${GAS_LIMIT.toLocaleString()} x maxFee from your balance up front.` +
      C.reset
  );
  console.log(C.dim + '  Keep it low unless the chain is genuinely congested.' + C.reset);
  const priorityRaw = await ask(`  › priority fee / tip (gwei) [${DEFAULT_PRIORITY_FEE}]: `);
  const priorityFee = priorityRaw || DEFAULT_PRIORITY_FEE;
  const maxGasRaw = await ask(`  › max fee per gas (gwei) [${DEFAULT_MAX_GAS_PRICE}]: `);
  const maxGasPrice = maxGasRaw || DEFAULT_MAX_GAS_PRICE;

  if (Number(priorityFee) > Number(maxGasPrice)) {
    console.log(C.red + '  ✗ Tip cannot exceed the ceiling — invalid under EIP-1559. Exiting.' + C.reset);
    rl.close();
    return;
  }
  console.log('');

  // ── Step 6: RPC ──
  console.log(C.bold + C.cyan + 'Step 6 — RPC' + C.reset);
  console.log(C.dim + `  Blank uses the public endpoint: ${chainInfo.rpcUrl}` + C.reset);
  const rpcInput = await ask('  › RPC URL (or Alchemy key): ');
  let rpcUrl = chainInfo.rpcUrl;
  if (rpcInput) {
    rpcUrl = rpcInput.startsWith('http')
      ? rpcInput
      : `https://robinhood-mainnet.g.alchemy.com/v2/${rpcInput}`;
  }
  console.log('');

  // ── Step 7: timing ──
  console.log(C.bold + C.cyan + 'Step 7 — Timing' + C.reset);
  console.log(C.dim + '    1) Fire now' + C.reset);
  console.log(C.dim + '    2) Wait for a time  — HH:MM:SS, 24h, today' + C.reset);
  const timingPick = await ask('  › choose 1-2 [1]: ');

  let mintStartTime: number | undefined;
  if (timingPick === '2') {
    const timeStr = await ask('  › start time (HH:MM:SS): ');
    const [h, m, s] = timeStr.split(':').map(Number);
    const target = new Date();
    target.setHours(h || 0, m || 0, s || 0, 0);
    if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1);
    mintStartTime = target.getTime();
    console.log(C.green + `  ✓ Will fire at ${target.toLocaleString()}` + C.reset);
  } else {
    console.log(C.green + '  ✓ Fire now' + C.reset);
  }

  // ── Summary ──
  console.log('');
  console.log(C.bold + '──────── READY ────────' + C.reset);
  console.log(`  Chain      ${chainInfo.name} (${chainInfo.chainId})`);
  console.log(`  Contract   ${contractAddress}`);
  console.log(`  Wallets    ${wallets.length}`);
  console.log(`  Quantity   ${quantity} per wallet → ${quantity * wallets.length} total`);
  console.log(`  Gas        ${maxGasPrice} / ${priorityFee} gwei · limit ${GAS_LIMIT.toLocaleString()}`);
  console.log(`  Timing     ${mintStartTime ? new Date(mintStartTime).toLocaleTimeString() : 'fire immediately'}`);
  console.log(C.bold + '───────────────────────' + C.reset);

  const confirm = await ask(C.yellow + '  › Fire? (y/N): ' + C.reset);
  if (confirm.toLowerCase() !== 'y') {
    console.log(C.dim + '  Cancelled.' + C.reset);
    rl.close();
    return;
  }

  // ── Wait if scheduled ──
  if (mintStartTime) {
    const waitMs = mintStartTime - Date.now();
    if (waitMs > 0) {
      console.log(C.yellow + `\n  Holding ${(waitMs / 1000).toFixed(1)}s until fire time...` + C.reset);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    console.log(C.bold + C.yellow + '  🚀 FIRING' + C.reset);
  }

  const config: MintConfig = {
    type: 'public',
    contractAddress,
    chain: chainKey,
    quantity,
    maxGasPrice,
    priorityFee,
    wallets,
    rpcUrl,
    mintStartTime,
  };

  const results = await executeUniversalMint(config);

  // ── Results ──
  console.log('');
  console.log(C.bold + C.cyan + 'RESULTS' + C.reset);
  console.log(C.cyan + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + C.reset);
  for (const r of results) {
    if (r.status === 'success') {
      console.log(C.green + `  ✓ ${r.wallet}` + C.reset);
      console.log(C.dim + `    ${chainInfo.explorerUrl}/tx/${r.txHash}` + C.reset);
    } else {
      console.log(C.red + `  ✗ ${r.wallet}: ${r.error}` + C.reset);
    }
  }
  const ok = results.filter((r) => r.status === 'success').length;
  console.log('');
  console.log(C.bold + `  Success: ${ok}/${results.length}` + C.reset);
  console.log(C.dim + '\n  — ZARV SNIPER —\n' + C.reset);

  rl.close();
}

main().catch((err) => {
  console.error(C.red + '\nFatal: ' + (err?.message || err) + C.reset);
  rl.close();
  process.exit(1);
});