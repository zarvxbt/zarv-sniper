/**
 * ZARV SNIPER — local dashboard
 * -----------------------------
 * Serves the UI on 127.0.0.1 and runs the same mint code the CLI does.
 *
 * There is no remote server anywhere in this design. The page is served from
 * the user's own machine, the keys are typed into a page their own process is
 * hosting, and the signed transaction goes straight to the RPC. Nothing about
 * a key ever crosses the network. That is deliberate — a hosted version of
 * this, where keys travel to someone else's box, would be indistinguishable
 * from a drainer and should never be built.
 */

import http from 'http';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain, listChains } from './chains.js';
import { buildMintPlan, executeUniversalMint, SEADROP_ADDRESS } from './mint.js';
import { PAGE } from './ui.js';
import type { MintConfig, Wallet } from './types.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

// Keys live in this process's memory for the lifetime of the run, exactly as
// they do in the CLI. They are never written to disk and never leave the box.
let wallets: Wallet[] = [];

// ── live output ──
// mint.ts writes progress with console.log. Rather than thread an emitter
// through it, we tee stdout to any connected dashboard while a run is active.
const listeners = new Set<http.ServerResponse>();
const realLog = console.log.bind(console);

function broadcast(line: string) {
  for (const res of listeners) {
    try { res.write(`data: ${JSON.stringify(line)}\n\n`); } catch { /* client gone */ }
  }
}

console.log = (...args: unknown[]) => {
  realLog(...args);
  // Strip ANSI so the browser gets clean text.
  broadcast(args.map(String).join(' ').replace(/\x1b\[[0-9;]*m/g, ''));
};

// ── helpers ──

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad JSON')); }
    });
    req.on('error', reject);
  });
}

const send = (res: http.ServerResponse, code: number, data: unknown) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

function resolveRpc(chainKey: string, input: string): string {
  const chain = getChain(chainKey);
  if (!input) return chain.rpcUrl;
  if (input.startsWith('http')) return input;
  return `https://robinhood-mainnet.g.alchemy.com/v2/${input}`;
}

const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleString();

// ── routes ──

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  try {
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }

    if (req.method === 'GET' && url === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }

    if (req.method === 'GET' && url === '/api/chains') {
      return send(res, 200, listChains().map((key) => {
        const c = getChain(key);
        return { key, name: c.name, chainId: c.chainId };
      }));
    }

    if (req.method === 'POST' && url === '/api/wallets') {
      const { keys } = await readJson(req);
      if (!Array.isArray(keys)) return send(res, 400, { error: 'no keys given' });

      const loaded: Wallet[] = [];
      let invalid = 0;
      for (const raw of keys) {
        try {
          const k = (String(raw).startsWith('0x') ? String(raw) : `0x${raw}`) as `0x${string}`;
          const account = privateKeyToAccount(k);
          loaded.push({ address: account.address, privateKey: k });
        } catch { invalid++; }
      }
      if (!loaded.length) return send(res, 400, { error: 'no valid private keys' });

      wallets = loaded;
      return send(res, 200, {
        wallets: loaded.map((w) => ({ address: w.address })),
        invalid: invalid || undefined,
      });
    }

    if (req.method === 'POST' && url === '/api/drop') {
      const { chain, contract, rpcUrl, quantity } = await readJson(req);
      if (!/^0x[a-fA-F0-9]{40}$/.test(contract || '')) {
        return send(res, 400, { error: 'invalid contract address' });
      }
      const info = getChain(chain);
      const rpc = resolveRpc(chain, rpcUrl || '');
      const qty = Number(quantity) > 0 ? Number(quantity) : 1;

      const plan = await buildMintPlan(rpc, info.chainId, contract, qty);
      if (!plan) {
        return send(res, 400, {
          error: 'No public SeaDrop stage found. Either this is not a SeaDrop ' +
                 'collection, the stage is not configured, or the drop restricts fee recipients.',
        });
      }

      const now = Math.floor(Date.now() / 1000);
      return send(res, 200, {
        seadrop: SEADROP_ADDRESS,
        feeRecipient: plan.feeRecipient,
        price: `${Number(plan.drop.mintPrice) / 1e18}`,
        total: `${Number(plan.value) / 1e18}`,
        maxPerWallet: plan.drop.maxTotalMintableByWallet,
        start: fmtTime(plan.drop.startTime),
        end: fmtTime(plan.drop.endTime),
        // Raw unix too, so the dashboard can run a live countdown.
        startUnix: plan.drop.startTime,
        endUnix: plan.drop.endTime,
        live: now >= plan.drop.startTime && now <= plan.drop.endTime,
        calldataBytes: (plan.data.length - 2) / 2,
      });
    }

    if (req.method === 'POST' && url === '/api/mint') {
      if (!wallets.length) return send(res, 400, { error: 'load wallets first' });
      const body = await readJson(req);
      const info = getChain(body.chain);

      if (Number(body.tip) > Number(body.max)) {
        return send(res, 400, { error: 'tip cannot exceed the ceiling — invalid under EIP-1559' });
      }

      // Scheduled fire: hold here, then run. The browser request stays open.
      if (body.at) {
        const [h, m, s] = String(body.at).split(':').map(Number);
        const target = new Date();
        target.setHours(h || 0, m || 0, s || 0, 0);
        if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1);
        const waitMs = target.getTime() - Date.now();
        console.log(`Holding ${(waitMs / 1000).toFixed(1)}s until ${target.toLocaleTimeString()}...`);
        await new Promise((r) => setTimeout(r, waitMs));
        console.log('FIRING');
      }

      const config: MintConfig = {
        type: 'public',
        contractAddress: body.contract,
        chain: body.chain,
        quantity: Number(body.quantity) > 0 ? Number(body.quantity) : 1,
        maxGasPrice: String(body.max || '1'),
        priorityFee: String(body.tip || '0.05'),
        wallets,
        rpcUrl: resolveRpc(body.chain, body.rpcUrl || ''),
      };

      const results = await executeUniversalMint(config);
      return send(res, 200, { results, explorer: info.explorerUrl });
    }

    send(res, 404, { error: 'not found' });
  } catch (err: any) {
    send(res, 500, { error: err?.shortMessage || err?.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  realLog('');
  realLog('  ZARV Sniper — dashboard running');
  realLog(`  http://${HOST}:${PORT}`);
  realLog('');
  realLog('  Local only. Keys never leave this machine.');
  realLog('  Ctrl+C to stop.');
  realLog('');
});