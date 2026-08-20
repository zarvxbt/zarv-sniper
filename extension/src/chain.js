/**
 * ZARV — Robinhood Chain SeaDrop
 * ------------------------------
 * Same engine as the CLI, running in the extension. The drop is read from the
 * SeaDrop singleton, calldata is built locally, the transaction is signed in
 * this page and broadcast straight to the RPC. No API, no OpenSea, no server.
 */

import {
  createPublicClient, createWalletClient, http,
  encodeFunctionData, parseAbi, formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const SEADROP = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719';
const ZERO = '0x0000000000000000000000000000000000000000';
export const GAS_LIMIT = 250000n;

export const ROBINHOOD = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
};

const ABI = parseAbi([
  'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable',
  'function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
]);

export function rpcUrl(custom) {
  if (!custom) return ROBINHOOD.rpcUrls.default.http[0];
  const t = custom.trim();
  if (t.startsWith('http')) return t;
  return 'https://robinhood-mainnet.g.alchemy.com/v2/' + t;
}

const pub = (url) => createPublicClient({ chain: ROBINHOOD, transport: http(url) });

export function addressFor(key) {
  const k = key.startsWith('0x') ? key : '0x' + key;
  return privateKeyToAccount(k).address;
}

export async function readDrop(url, nft, quantity) {
  const client = pub(url);
  let raw;
  try {
    raw = await client.readContract({
      address: SEADROP, abi: ABI, functionName: 'getPublicDrop', args: [nft],
    });
  } catch {
    return null;
  }
  const drop = {
    mintPrice: BigInt(raw.mintPrice),
    startTime: Number(raw.startTime),
    endTime: Number(raw.endTime),
    maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
    feeBps: Number(raw.feeBps),
    restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
  };
  // An unset mapping entry decodes to zeros rather than reverting.
  if (!drop.startTime && !drop.endTime && !drop.maxTotalMintableByWallet) return null;

  let feeRecipient = OPENSEA_FEE_RECIPIENT;
  try {
    const allowed = await client.readContract({
      address: SEADROP, abi: ABI, functionName: 'getAllowedFeeRecipients', args: [nft],
    });
    if (allowed.length) feeRecipient = allowed[0];
    else if (drop.restrictFeeRecipients) return null; // no valid recipient exists
  } catch { /* fall back to the OpenSea default */ }

  const qty = BigInt(quantity);
  const data = encodeFunctionData({
    abi: ABI,
    functionName: 'mintPublic',
    // address(0) as minterIfNotPayer credits the caller, and keeps the calldata
    // identical for every wallet.
    args: [nft, feeRecipient, ZERO, qty],
  });

  const now = Math.floor(Date.now() / 1000);
  return {
    drop, feeRecipient, data,
    value: drop.mintPrice * qty,
    priceEth: formatEther(drop.mintPrice),
    totalEth: formatEther(drop.mintPrice * qty),
    live: now >= drop.startTime && now <= drop.endTime,
    calldataBytes: (data.length - 2) / 2,
  };
}

export async function balanceOf(url, address) {
  return pub(url).getBalance({ address });
}

export async function mintWith(url, wallet, plan, tipGwei, maxGwei, onLog) {
  const key = wallet.privateKey.startsWith('0x') ? wallet.privateKey : '0x' + wallet.privateKey;
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: ROBINHOOD, transport: http(url) });

  const hash = await client.sendTransaction({
    chain: ROBINHOOD,
    to: SEADROP,
    data: plan.data,
    value: plan.value,
    gas: GAS_LIMIT,
    maxFeePerGas: BigInt(Math.floor(Number(maxGwei) * 1e9)),
    maxPriorityFeePerGas: BigInt(Math.floor(Number(tipGwei) * 1e9)),
  });
  onLog('sent ' + hash, 'ok');

  const receipt = await pub(url).waitForTransactionReceipt({ hash, timeout: 90000 });
  return { hash, ok: receipt.status === 'success', block: receipt.blockNumber };
}

export const explorerTx = (h) => ROBINHOOD.blockExplorers.default.url + '/tx/' + h;
