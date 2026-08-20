# ZARV

NFT mint tooling for Robinhood Chain. Three pieces, one engine.

| | What it is | Install |
|---|---|---|
| **[zsniper.vercel.app](https://zsniper.vercel.app)** | Live mint intelligence — scan any drop, live feed, trending, watchlist | none |
| **Chrome extension** | The sniper. Encrypted local vault, mints from your browser | load unpacked |
| **CLI + dashboard** | Same engine on the command line, or a local web dashboard | Node 18+ |

Every value in every transaction is read from the SeaDrop contract itself. No
OpenSea account, no login, no API key, and nothing to rate-limit you at the
moment a stage opens.

---

## The site

**[zsniper.vercel.app](https://zsniper.vercel.app)** — no install, nothing to sign up for.

- **Drop scanner** — real price, per-wallet cap, creator fee, fee recipient, supply bar, open and close times
- **Live countdown** — opens-in / closes-in, days-aware
- **Wallet checker** — how many a given address has already minted, and how many it has left
- **Live mints** — recent `SeaDropMint` events straight off the chain, refreshed every 20s
- **Trending** — collections ranked by items minted in the recent block window
- **Watchlist** — saved in your own browser, with live status and countdowns
- **Shareable links** — `/?c=0x…` scans on load

No database, no accounts, no tracking. The API routes exist only to keep
`eth_getLogs` off the client and dodge CORS on the public RPC.

## The extension

The site tells you what's happening. The extension mints.

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `extension/` folder

On first run you create a vault: paste your keys, choose a password. They're
encrypted with **AES-GCM**, key derived by **PBKDF2-SHA256 at 310,000
iterations**, before they ever touch extension storage.

**Your keys cannot leave your machine.** Not "we promise not to send them" —
they *cannot* be sent. The manifest grants network access to three Robinhood RPC
endpoints and nothing else, so there is no host the extension could post them
to. It's four lines of `manifest.json`; read it yourself.

There is deliberately no hosted version of the minting. A website that takes
private keys is indistinguishable from a wallet drainer, whatever the intent
behind it.

## The CLI and local dashboard

```bash
git clone https://github.com/zarvxbt/zarv-sniper.git
cd zarv-sniper
npm install
npm run build
```

```bash
npm run ui      # local dashboard at 127.0.0.1:3000
npm start       # CLI wizard
```

Multi-wallet, parallel minting, scheduled fire, masked key entry, EIP-1559
guards. Keys are held in memory for the run and never written to disk.

---

## How the mint is built

Most tools ask OpenSea's API for the calldata. That's roughly a second of
round-trip sitting in your critical path, plus a rate limit that can cost you
the mint, plus an outage you can't do anything about.

ZARV reads the drop from the SeaDrop singleton and assembles the transaction
itself:

- `getPublicDrop(nftContract)` on the SeaDrop singleton — price, window, per-wallet cap
- `getAllowedFeeRecipients(nftContract)` — the fee recipient, resolved on-chain rather than guessed
- `mintPublic(nftContract, feeRecipient, address(0), quantity)` — `address(0)` credits the caller, so the calldata is identical for every wallet and can be built once

Because none of that depends on a network round trip at fire time, every
transaction can be signed before the stage opens.

## Understanding the gas ceiling

Three numbers, and mixing them up is the most common way to lose a mint:

| Term | What it is | Who sets it |
|---|---|---|
| Base fee | The network's price. Burned. | The chain |
| Priority fee (tip) | Paid on top, to the block producer | You |
| Max fee | The ceiling you'll tolerate | You |

You pay `base fee + tip`. The ceiling is only a cap.

**But the ceiling is not free.** Before a node will accept your transaction it
checks that your wallet holds `gasLimit × maxFee + mint price`. At 250,000 gas a
50 gwei ceiling reserves 0.0125 ETH — so a thin wallet gets rejected outright,
even on a free mint costing a fraction of a cent. On a chain with a 0.02 gwei
base fee, a 1 gwei ceiling is plenty. ZARV warns you before it fires.

## Scope

Public SeaDrop stages.

Allowlist stages come in two kinds. Merkle-gated stages use `mintAllowList()`
and are buildable from public data. Signed stages use `mintSigned()` and carry a
signature only OpenSea's server can produce. Both are built and in testing —
they ship once they've been run against live drops, not before.

## Security

- Keys are pasted at run time or held in an encrypted local vault
- Never written to disk in plaintext, never transmitted anywhere except as a locally-signed transaction
- `.env`, `wallets/` and `*.key` are git-ignored
- Use dedicated hot wallets funded with only what you intend to spend

`src/mint.ts` is about 250 lines and is the whole of what gets signed and sent.
`extension/src/` is three small files. Read them.

## Chain

| Chain | ID | Explorer |
|---|---|---|
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

The CLI also carries Base and Ethereum configs. Adding a chain is one entry in
`src/chains.ts`.

## Disclaimer

Use at your own risk. Blockchain transactions are irreversible. This software is
provided as is, without warranty of any kind.

## License

MIT — see [LICENSE](LICENSE).

`src/mint.ts` follows the SeaDrop call approach used in
[nft-public-mint](https://github.com/morsyxbt/nft-public-mint) (MIT).

---

Made with ♥ by [zarv](https://x.com/zarvxbt)
