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

// The SeaDrop singleton. Same address on every chain.
export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';

// OpenSea's fee collector. Only used when the drop does NOT restrict recipients.
const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';

const ZERO = '0x0000000000000000000000000000000000000000';

const SEADROP_ABI = parseAbi([
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
  'function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
]);

export interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface MintPlan {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  drop: PublicDrop;
  feeRecipient: string;
}

function makeClient(rpcUrl: string, chainId: number) {
  return createPublicClient({
    transport: http(rpcUrl),
    chain: {
      id: chainId,
      name: 'chain',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as any,
  });
}

// READ THE DROP FROM THE SEADROP SINGLETON, NOT FROM THE NFT CONTRACT.
// This is the bug that was killing us.
export async function fetchPublicDrop(
  rpcUrl: string,
  chainId: number,
  nftContract: string
): Promise<PublicDrop | null> {
  const client = makeClient(rpcUrl, chainId);
  try {
    const raw: any = await client.readContract({
      address: SEADROP_ADDRESS as `0x${string}`,
      abi: SEADROP_ABI,
      functionName: 'getPublicDrop',
      args: [nftContract as `0x${string}`],
    });
    const drop: PublicDrop = {
      mintPrice: BigInt(raw.mintPrice),
      startTime: Number(raw.startTime),
      endTime: Number(raw.endTime),
      maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
      feeBps: Number(raw.feeBps),
      restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
    };
    // An unset mapping entry decodes to all zeros instead of reverting.
    if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) {
      return null;
    }
    return drop;
  } catch {
    return null;
  }
}

// SeaDrop reverts on a zero fee recipient, and on a disallowed one when the
// drop restricts them. So this MUST come from the chain, never a guess.
export async function resolveFeeRecipient(
  rpcUrl: string,
  chainId: number,
  nftContract: string,
  restricted: boolean
): Promise<string | null> {
  const client = makeClient(rpcUrl, chainId);
  let allowed: string[] = [];
  try {
    allowed = (await client.readContract({
      address: SEADROP_ADDRESS as `0x${string}`,
      abi: SEADROP_ABI,
      functionName: 'getAllowedFeeRecipients',
      args: [nftContract as `0x${string}`],
    })) as string[];
  } catch {
    allowed = [];
  }

  if (allowed.length > 0) return allowed[0];
  if (restricted) return null; // impossible to build a valid public mint
  return OPENSEA_FEE_RECIPIENT;
}

// minterIfNotPayer = address(0) means "credit the caller".
// Passing your own address here is what makes SeaDrop revert.
export function encodeMintPublic(
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
      ZERO as `0x${string}`,
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
  const drop = await fetchPublicDrop(rpcUrl, chainId, nftContract);
  if (!drop) return null;

  const feeRecipient = await resolveFeeRecipient(
    rpcUrl,
    chainId,
    nftContract,
    drop.restrictFeeRecipients
  );
  if (!feeRecipient) return null;

  return {
    to: SEADROP_ADDRESS as `0x${string}`,
    data: encodeMintPublic(nftContract, feeRecipient, quantity),
    value: drop.mintPrice * BigInt(quantity),
    drop,
    feeRecipient,
  };
}

export async function executeUniversalMint(config: MintConfig): Promise<MintResult[]> {
  const chain = getChain(config.chain);
  const rpcUrl = config.rpcUrl || chain.rpcUrl;
  const chainId = chain.chainId;

  console.log('\n-- BUILDING PLAN FROM ON-CHAIN SEADROP STATE --');

  const plan = await buildMintPlan(rpcUrl, chainId, config.contractAddress, config.quantity);

  if (!plan) {
    console.log('  X No public SeaDrop stage found for this contract.');
    console.log('    Either it is not a SeaDrop collection, the stage is not');
    console.log('    configured, or the drop restricts fee recipients.');
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
  console.log(`  NFT:            ${config.contractAddress}`);
  console.log(`  Fee recipient:  ${plan.feeRecipient}`);
  console.log(
    `  Price:          ${formatEther(plan.drop.mintPrice)} x ${config.quantity} = ${formatEther(plan.value)}`
  );
  console.log(`  Max per wallet: ${plan.drop.maxTotalMintableByWallet}`);
  console.log(`  Window:         ${new Date(plan.drop.startTime * 1000).toLocaleString()} -> ${new Date(plan.drop.endTime * 1000).toLocaleString()}`);
  console.log(`  Status:         ${live ? 'LIVE' : 'NOT ACTIVE'}`);
  console.log(`  Calldata:       ${(plan.data.length - 2) / 2} bytes`);

  if (!live) {
    console.log('\n  ! Stage is not live. SeaDrop will revert with NotActive.');
  }
  if (config.quantity > plan.drop.maxTotalMintableByWallet) {
    console.log(
      `\n  ! Quantity ${config.quantity} exceeds the per-wallet cap of ${plan.drop.maxTotalMintableByWallet}.`
    );
  }

  const viemChain = {
    id: chainId,
    name: chain.name,
    nativeCurrency: { name: chain.nativeCurrency, symbol: chain.nativeCurrency, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as any;

  const publicClient = createPublicClient({ transport: http(rpcUrl), chain: viemChain });

  const results = await Promise.all(
    config.wallets.map(async (w): Promise<MintResult> => {
      try {
        const key = w.privateKey.startsWith('0x') ? w.privateKey : `0x${w.privateKey}`;
        const account = privateKeyToAccount(key as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          transport: http(rpcUrl),
          chain: viemChain,
        });

        const txHash = await walletClient.sendTransaction({
          chain: viemChain,
          to: plan.to,
          data: plan.data,
          value: plan.value,
          gas: 250000n,
          maxFeePerGas: BigInt(Math.floor(Number(config.maxGasPrice) * 1e9)),
          maxPriorityFeePerGas: BigInt(Math.floor(Number(config.priorityFee) * 1e9)),
        });

        console.log(`  Sent [${account.address}] ${txHash}`);

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 60_000,
        });

        return {
          wallet: account.address,
          txHash,
          status: receipt.status === 'success' ? 'success' : 'failed',
          error: receipt.status === 'success' ? undefined : 'reverted on-chain',
        };
      } catch (err: any) {
        return {
          wallet: w.address,
          txHash: '',
          status: 'failed',
          error: err?.shortMessage || err?.message || String(err),
        };
      }
    })
  );

  return results;
}
