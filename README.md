# ZARV Sniper

A command-line NFT mint sniper for OpenSea SeaDrop public stages, on Robinhood Chain, Base and Ethereum.

Every value in the transaction — price, fee recipient, per-wallet cap, the live window — is read from the SeaDrop contract itself. There is no OpenSea account, no login, no API key, and nothing to rate-limit you at the moment the stage opens.

```
  ╔═══════════════════════════════════════════╗
  ║           Z A R V   S N I P E R           ║
  ║     SeaDrop · on-chain calldata · fast     ║
  ╚═══════════════════════════════════════════╝
```

## What it does

- **Reads the drop from chain state.** Price, fee recipient and per-wallet limit come from `SeaDrop.getPublicDrop()` and `getAllowedFeeRecipients()`, not from a guess or an API.
- **Shows you the drop before you commit.** Price, cap, live window and calldata size are printed, and you confirm before anything is signed.
- **Multi-wallet.** Paste as many keys as you like; they mint in parallel.
- **Scheduling.** Fire now, or hold until a specific time.
- **Masked key entry.** Keys render as stars, are held in memory for the run, and are never written to disk.
- **Gas guards.** Rejects a tip above your ceiling before it can be bounced by every node.
- **Two interfaces.** A local web dashboard, or the CLI wizard. Same mint code behind both.

## Requirements

Node.js 18 or newer (`node --version`) and a wallet with gas on the chain you are minting on.

## Install

```bash
git clone https://github.com/YOUR_USERNAME/zarv-sniper.git
cd zarv-sniper
npm install
npm run build
```

## Run

Two interfaces, same engine underneath.

### Dashboard

```bash
npm run ui
```

Opens a local dashboard at `http://127.0.0.1:3000` — wallet grid, on-chain drop preview, live log, per-wallet status. Read the drop before committing, then fire.

The server binds to `127.0.0.1` only. The page is served by your own machine, so keys typed into it never cross the network. **Never run a version of this that sends keys to a remote server** — hosted key entry is indistinguishable from a wallet drainer, whatever the intent.

### CLI

```bash
npm start
```

The wizard asks seven things:

| Step | What it wants |
|------|---------------|
| 1. Private keys | One per line, hidden as you type. Each is confirmed back by its address so you can check you pasted the right one. Blank line to finish. |
| 2. Chain | Robinhood, Base or Ethereum. |
| 3. Contract | The NFT contract address. |
| 4. Quantity | How many per wallet. |
| 5. Gas | Tip and ceiling. Defaults are 0.05 / 1 gwei. |
| 6. RPC | Blank for the public endpoint, or paste a URL or an Alchemy key. |
| 7. Timing | Fire now, or wait for a time. |

Then it prints a summary and asks `Fire?`. Nothing is sent until you type `y`.

## Understanding the gas ceiling

Three numbers, and confusing them is the most common way to lose a mint:

| Term | What it is | Who sets it |
|------|-----------|-------------|
| Base fee | The network's price. Burned. | The chain |
| Priority fee (tip) | Paid on top, to the block producer | You |
| Max fee | The ceiling you will tolerate | You |

You pay `base fee + tip`. The ceiling is only a cap.

**But the ceiling is not free.** Before a node will accept your transaction it checks that your wallet holds `gasLimit × maxFee + mint price`. At 250,000 gas, a 50 gwei ceiling reserves 0.0125 ETH — so a thin wallet gets rejected outright even on a free mint where the real cost is a fraction of a cent. On a chain with a 0.02 gwei base fee, a 1 gwei ceiling is ample.

## Scope

Public SeaDrop stages only.

Allowlist stages come in two kinds. Merkle-gated stages use `mintAllowList()` and are buildable from public data. Signed stages use `mintSigned()` and carry a signature only OpenSea's server can produce. Neither is supported here yet.

## Security

Private keys are pasted at run time, masked on screen, held in memory for that run, and never written to disk or sent anywhere except as a locally-signed transaction. `.env`, `wallets/` and `*.key` are git-ignored.

Use dedicated hot wallets funded with only what you intend to spend.

`src/mint.ts` is about 250 lines and is the whole of what gets signed and sent. Read it.

## Credits

The local SeaDrop approach here — reading the drop from the singleton rather than the token contract, resolving the fee recipient on-chain, and passing `address(0)` as `minterIfNotPayer` — follows [nft-public-mint](https://github.com/morsyxbt/nft-public-mint) by [@morsyxbt](https://github.com/morsyxbt), MIT licensed. Credit where it is due.

## Disclaimer

Use at your own risk. Blockchain transactions are irreversible. This software is provided as is, without warranty of any kind.

## License

MIT — see [LICENSE](LICENSE).

## Chrome extension

The same engine as a browser extension, in `extension/`. No terminal, no Node.

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** and select the `extension/` folder

Keys are encrypted with AES-GCM (PBKDF2-SHA256) before they touch extension
storage. The manifest grants network access to Robinhood RPC endpoints and
nothing else, so there is no server it could send them to.

## Live site

Scan any Robinhood Chain drop without installing anything:
https://zsniper.vercel.app
