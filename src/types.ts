export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: string;
  decimals: number;
}

export interface Wallet {
  address: string;
  privateKey: string;
}

export interface MintConfig {
  type: 'public' | 'allowlist';
  contractAddress: string;
  chain: string;
  quantity: number;
  maxGasPrice: string;
  priorityFee: string;
  wallets: Wallet[];
  rpcUrl: string;
  mintStartTime?: number;
}

export interface TransactionData {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
}

export interface MintResult {
  wallet: string;
  txHash: string;
  status: 'success' | 'failed' | 'pending';
  error?: string;
}
