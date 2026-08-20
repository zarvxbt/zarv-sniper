/**
 * ZARV — SeaDrop public mint engine
 * =================================
 *
 * Written against OpenSea's SeaDrop contract source rather than any client
 * library, and organised around the one thing that actually decides whether a
 * mint lands: the guard sequence inside `mintPublic()`.
 *
 * `SeaDrop.mintPublic()` runs seven checks in a fixed order and reverts on the
 * first one that fails. Every guard below mirrors one of them, evaluated
 * locally against live chain state before anything is signed. If a mint is
 * going to revert, this says which guard and why — for the price of a few
 * `eth_call`s instead of a burnt transaction.
 *
 * Guard order, matching the contract:
 *
 *   1. NotActive                            stage window
 *   2. MintQuantityCannotBeZero             quantity > 0
 *   3. MintQuantityExceedsMaxMintedPerWallet  wallet cap, via getMintStats
 *   4. MintQuantityExceedsMaxSupply         collection cap, via getMintStats
 *   5. FeeRecipientCannotBeZeroAddress      recipient is set
 *   6. FeeRecipientNotAllowed               recipient passes the drop's allow rule
 *   7. IncorrectPayment                     msg.value == price * quantity
 *
 * Guards 3 and 4 are the interesting ones. They depend on `getMintStats(minter)`
 * on the token contract, which is per-wallet state — meaning a drop can be live,
 * cheap and open, and still revert for one wallet and not another. Nothing in
 * the drop config tells you that; only the stats call does.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from './chains.js';
import type { MintConfig, MintResult } from './types.js';

/** SeaDrop is deployed at the same address on every chain it supports. */
export const SEADROP_ADDRESS =
  process.env.SEADROP_ADDRESS || '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';

/** Passing the zero address as `minterIfNotPayer` makes SeaDrop credit msg.sender. */
const SELF = '0x0000000000000000000000000000000000000000';

/** OpenSea's collector, used only when a drop leaves recipients unrestricted. */
const DEFAULT_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';

/** A SeaDrop mint costs ~135k gas; 250k leaves room without over-reserving. */
export const GAS_LIMIT = 250_000n;

const SEADROP_ABI = parseAbi([
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
  'function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
  'function getFeeRecipientIsAllowed(address nftContract, address feeRecipient) view returns (bool)',
]);

const TOKEN_ABI = parseAbi([
  'function getMintStats(address minter) view returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply)',
  'function name() view returns (string)',
]);

// ─────────────────────────────── types ───────────────────────────────

export interface PublicDropStage {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface MintStats {
  minterNumMinted: number;
  currentTotalSupply: number;
  maxSupply: number;
}

/** One reproduced contract guard. `revertsWith` names the on-chain error. */
export interface GuardResult {
  guard: string;
  revertsWith: string;
  passed: boolean;
  detail: string;
}

export interface Preflight {
  wallet: string;
  willRevert: boolean;
  guards: GuardResult[];
  firstFailure: GuardResult | null;
  stats: MintStats | null;
}

/** Outcome of picking a fee recipient the drop will accept. */
export interface FeeRecipientChoice {
  ok: boolean;
  address: string;
  /** How the address was arrived at, for the log line. */
  basis: 'confirmed' | 'listed' | 'default' | 'none';
}

export interface MintPlan {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  /** Kept as `drop` so callers reading plan.drop.* stay unchanged. */
  drop: PublicDropStage;
  feeRecipient: string;
  quantity: number;
  nftContract: string;
}

// ─────────────────────────── chain plumbing ───────────────────────────

function viemChain(chainKey: string, rpcUrl: string) {
  const c = getChain(chainKey);
  return {
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.nativeCurrency, symbol: c.nativeCurrency, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as any;
}

const reader = (rpcUrl: string, chainId: number) =>
  createPublicClient({
    transport: http(rpcUrl),
    chain: {
      id: chainId,
      name: 'chain',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as any,
  });

// ─────────────────────────── protocol reads ───────────────────────────

/**
 * The drop config lives in a mapping on the SeaDrop singleton, keyed by token
 * contract — not on the token contract itself. An unconfigured entry decodes to
 * all zeros instead of reverting, so "all zeros" is the real absence signal.
 */
export async function readStage(
  rpcUrl: string,
  chainId: number,
  nftContract: string
): Promise<PublicDropStage | null> {
  try {
    const s: any = await reader(rpcUrl, chainId).readContract({
      address: SEADROP_ADDRESS as `0x${string}`,
      abi: SEADROP_ABI,
      functionName: 'getPublicDrop',
      args: [nftContract as `0x${string}`],
    });

    const stage: PublicDropStage = {
      mintPrice: BigInt(s.mintPrice),
      startTime: Number(s.startTime),
      endTime: Number(s.endTime),
      maxTotalMintableByWallet: Number(s.maxTotalMintableByWallet),
      feeBps: Number(s.feeBps),
      restrictFeeRecipients: Boolean(s.restrictFeeRecipients),
    };

    const unset =
      stage.startTime === 0 &&
      stage.endTime === 0 &&
      stage.maxTotalMintableByWallet === 0;

    return unset ? null : stage;
  } catch {
    return null;
  }
}

/**
 * Per-wallet mint state, straight from the token contract. This is the source
 * SeaDrop itself consults in `_checkMintQuantity`, so anything derived from it
 * matches what the contract will decide.
 */
export async function readMintStats(
  rpcUrl: string,
  chainId: number,
  nftContract: string,
  minter: string
): Promise<MintStats | null> {
  try {
    const s: any = await reader(rpcUrl, chainId).readContract({
      address: nftContract as `0x${string}`,
      abi: TOKEN_ABI,
      functionName: 'getMintStats',
      args: [minter as `0x${string}`],
    });
    return {
      minterNumMinted: Number(s[0]),
      currentTotalSupply: Number(s[1]),
      maxSupply: Number(s[2]),
    };
  } catch {
    // Not every SeaDrop-compatible token exposes it. Guards that need it will
    // report as unverifiable rather than silently passing.
    return null;
  }
}

/**
 * Pick a recipient the drop will actually accept.
 *
 * Preference is the allow-list, confirmed with `getFeeRecipientIsAllowed` so
 * the answer comes from the same predicate the contract uses rather than from
 * inferring it. Falls back to OpenSea's collector only where the drop leaves
 * recipients unrestricted, and reports failure where it cannot be satisfied.
 */
export async function selectFeeRecipient(
  rpcUrl: string,
  chainId: number,
  nftContract: string,
  restricted: boolean
): Promise<FeeRecipientChoice> {
  const client = reader(rpcUrl, chainId);

  let allowed: readonly string[] = [];
  try {
    allowed = (await client.readContract({
      address: SEADROP_ADDRESS as `0x${string}`,
      abi: SEADROP_ABI,
      functionName: 'getAllowedFeeRecipients',
      args: [nftContract as `0x${string}`],
    })) as readonly string[];
  } catch {
    allowed = [];
  }

  for (const candidate of allowed) {
    try {
      const ok = await client.readContract({
        address: SEADROP_ADDRESS as `0x${string}`,
        abi: SEADROP_ABI,
        functionName: 'getFeeRecipientIsAllowed',
        args: [nftContract as `0x${string}`, candidate as `0x${string}`],
      });
      if (ok) return { ok: true, address: candidate, basis: 'confirmed' };
    } catch {
      // Older deployments may not expose the predicate; the listing stands.
      return { ok: true, address: candidate, basis: 'listed' };
    }
  }

  if (allowed.length > 0) return { ok: true, address: allowed[0], basis: 'listed' };
  if (restricted) return { ok: false, address: SELF, basis: 'none' };
  return { ok: true, address: DEFAULT_FEE_RECIPIENT, basis: 'default' };
}

// ────────────────────────────── calldata ──────────────────────────────

export function buildCalldata(
  nftContract: string,
  feeRecipient: string,
  quantity: number
): `0x${string}` {
  return encodeFunctionData({
    abi: SEADROP_ABI,
    functionName: 'mintPublic',
    args: [
      nftContract as `0x${string}`,
      feeRecipient as `0x${string}`,
      SELF as `0x${string}`,
      BigInt(quantity),
    ],
  });
}

export async function buildMintPlan(
  rpcUrl: string,
  chainId: number,
  nftContract: string,
  quantity: number
): Promise<MintPlan | null> {
  const drop = await readStage(rpcUrl, chainId, nftContract);
  if (!drop) return null;

  const fee = await selectFeeRecipient(rpcUrl, chainId, nftContract, drop.restrictFeeRecipients);
  if (!fee.ok) return null;

  const cost = drop.mintPrice * BigInt(quantity);

  return {
    to: SEADROP_ADDRESS as `0x${string}`,
    data: buildCalldata(nftContract, fee.address, quantity),
    value: cost,
    drop,
    feeRecipient: fee.address,
    quantity,
    nftContract,
  };
}

// ────────────────────────────── preflight ──────────────────────────────

/**
 * Reproduce SeaDrop's guard sequence for one wallet, in contract order.
 *
 * Guards are evaluated in full rather than short-circuiting, so a single pass
 * reports everything wrong instead of one problem at a time. `firstFailure` is
 * still the one the chain would actually revert on.
 */
export async function preflight(
  rpcUrl: string,
  chainId: number,
  plan: MintPlan,
  wallet: string
): Promise<Preflight> {
  const { drop, quantity, nftContract, feeRecipient, value } = plan;
  const now = Math.floor(Date.now() / 1000);
  const stats = await readMintStats(rpcUrl, chainId, nftContract, wallet);
  const guards: GuardResult[] = [];

  // 1 — stage window
  const active = now >= drop.startTime && now <= drop.endTime;
  guards.push({
    guard: 'stage window',
    revertsWith: 'NotActive',
    passed: active,
    detail: active
      ? 'stage is open'
      : now < drop.startTime
        ? `opens ${new Date(drop.startTime * 1000).toLocaleString()}`
        : `closed ${new Date(drop.endTime * 1000).toLocaleString()}`,
  });

  // 2 — non-zero quantity
  guards.push({
    guard: 'quantity',
    revertsWith: 'MintQuantityCannotBeZero',
    passed: quantity > 0,
    detail: `${quantity} requested`,
  });

  // 3 — per-wallet cap, counting what this wallet already holds from the drop
  if (stats) {
    const after = quantity + stats.minterNumMinted;
    guards.push({
      guard: 'wallet cap',
      revertsWith: 'MintQuantityExceedsMaxMintedPerWallet',
      passed: after <= drop.maxTotalMintableByWallet,
      detail: `${stats.minterNumMinted} already minted, ${after}/${drop.maxTotalMintableByWallet} after this`,
    });
  } else {
    guards.push({
      guard: 'wallet cap',
      revertsWith: 'MintQuantityExceedsMaxMintedPerWallet',
      passed: true,
      detail: 'getMintStats unavailable — cannot verify locally',
    });
  }

  // 4 — collection supply
  if (stats) {
    const after = quantity + stats.currentTotalSupply;
    guards.push({
      guard: 'collection supply',
      revertsWith: 'MintQuantityExceedsMaxSupply',
      passed: after <= stats.maxSupply,
      detail: `${stats.currentTotalSupply}/${stats.maxSupply} minted, ${Math.max(0, stats.maxSupply - stats.currentTotalSupply)} left`,
    });
  } else {
    guards.push({
      guard: 'collection supply',
      revertsWith: 'MintQuantityExceedsMaxSupply',
      passed: true,
      detail: 'getMintStats unavailable — cannot verify locally',
    });
  }

  // 5 — recipient is set
  const nonZero = feeRecipient.toLowerCase() !== SELF;
  guards.push({
    guard: 'fee recipient set',
    revertsWith: 'FeeRecipientCannotBeZeroAddress',
    passed: nonZero,
    detail: nonZero ? feeRecipient : 'zero address',
  });

  // 6 — recipient satisfies the drop's restriction rule
  let recipientAllowed = true;
  if (drop.restrictFeeRecipients) {
    try {
      recipientAllowed = Boolean(
        await reader(rpcUrl, chainId).readContract({
          address: SEADROP_ADDRESS as `0x${string}`,
          abi: SEADROP_ABI,
          functionName: 'getFeeRecipientIsAllowed',
          args: [nftContract as `0x${string}`, feeRecipient as `0x${string}`],
        })
      );
    } catch {
      recipientAllowed = true; // predicate unavailable; do not block on it
    }
  }
  guards.push({
    guard: 'fee recipient allowed',
    revertsWith: 'FeeRecipientNotAllowed',
    passed: recipientAllowed,
    detail: drop.restrictFeeRecipients
      ? recipientAllowed ? 'allowed by the drop' : 'not on the drop allow-list'
      : 'drop does not restrict recipients',
  });

  // 7 — exact payment
  const exact = value === drop.mintPrice * BigInt(quantity);
  guards.push({
    guard: 'payment',
    revertsWith: 'IncorrectPayment',
    passed: exact,
    detail: `${formatEther(value)} for ${quantity} at ${formatEther(drop.mintPrice)}`,
  });

  const firstFailure = guards.find((g) => !g.passed) ?? null;
  return { wallet, willRevert: Boolean(firstFailure), guards, firstFailure, stats };
}

// ────────────────────────────── execution ──────────────────────────────

const gwei = (v: string) => BigInt(Math.floor(Number(v) * 1e9));

export async function executeUniversalMint(config: MintConfig): Promise<MintResult[]> {
  const chain = getChain(config.chain);
  const rpcUrl = config.rpcUrl || chain.rpcUrl;
  const chainId = chain.chainId;

  console.log('\n-- BUILDING PLAN FROM ON-CHAIN SEADROP STATE --');

  const plan = await buildMintPlan(rpcUrl, chainId, config.contractAddress, config.quantity);

  if (!plan) {
    console.log('  X No public SeaDrop stage for this contract.');
    console.log('    Either it is not a SeaDrop collection, the stage is not');
    console.log('    configured, or the drop restricts fee recipients and');
    console.log('    none is allowed.');
    return config.wallets.map((w) => ({
      wallet: w.address,
      txHash: '',
      status: 'failed' as const,
      error: 'no public drop',
    }));
  }

  const now = Math.floor(Date.now() / 1000);
  const live = now >= plan.drop.startTime && now <= plan.drop.endTime;

  console.log(`  SeaDrop:        ${plan.to}`);
  console.log(`  NFT:            ${plan.nftContract}`);
  console.log(`  Fee recipient:  ${plan.feeRecipient}`);
  console.log(`  Price:          ${formatEther(plan.drop.mintPrice)} x ${plan.quantity} = ${formatEther(plan.value)}`);
  console.log(`  Max per wallet: ${plan.drop.maxTotalMintableByWallet}`);
  console.log(`  Window:         ${new Date(plan.drop.startTime * 1000).toLocaleString()} -> ${new Date(plan.drop.endTime * 1000).toLocaleString()}`);
  console.log(`  Status:         ${live ? 'LIVE' : 'NOT ACTIVE'}`);
  console.log(`  Calldata:       ${(plan.data.length - 2) / 2} bytes`);

  const chainCfg = viemChain(config.chain, rpcUrl);
  const publicClient = createPublicClient({ transport: http(rpcUrl), chain: chainCfg });

  const maxFee = gwei(config.maxGasPrice);
  const tip = gwei(config.priorityFee);

  const results = await Promise.all(
    config.wallets.map(async (w): Promise<MintResult> => {
      let address = w.address;
      try {
        const key = (w.privateKey.startsWith('0x') ? w.privateKey : `0x${w.privateKey}`) as `0x${string}`;
        const account = privateKeyToAccount(key);
        address = account.address;

        // Ask the guards before spending anything.
        const pf = await preflight(rpcUrl, chainId, plan, address);
        console.log(`\n  ${address}`);
        for (const g of pf.guards) {
          console.log(`    ${g.passed ? 'ok  ' : 'FAIL'} ${g.guard.padEnd(22)} ${g.detail}`);
        }

        if (pf.willRevert) {
          const f = pf.firstFailure!;
          console.log(`    -> would revert with ${f.revertsWith}. Not sending.`);
          return {
            wallet: address,
            txHash: '',
            status: 'failed',
            error: `${f.revertsWith}: ${f.detail}`,
          };
        }

        const walletClient = createWalletClient({ account, transport: http(rpcUrl), chain: chainCfg });
        const txHash = await walletClient.sendTransaction({
          chain: chainCfg,
          to: plan.to,
          data: plan.data,
          value: plan.value,
          gas: GAS_LIMIT,
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: tip,
        });
        console.log(`    sent ${txHash}`);

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
        return {
          wallet: address,
          txHash,
          status: receipt.status === 'success' ? 'success' : 'failed',
          error: receipt.status === 'success' ? undefined : 'reverted on-chain',
        };
      } catch (err: any) {
        return {
          wallet: address,
          txHash: '',
          status: 'failed',
          error: err?.shortMessage || err?.message || String(err),
        };
      }
    })
  );

  return results;
}
