# ZARV Sniper — Chrome extension

SeaDrop mint sniper for Robinhood Chain. Everything runs in your browser.

## Install (unpacked)

1. Download and unzip this folder somewhere you'll keep it
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select this folder
5. Pin the ZARV icon to your toolbar

Click the icon to open the dashboard.

## First run

You'll be asked to create a vault: paste your private keys, choose a password.
The keys are encrypted with AES-GCM (PBKDF2-SHA256, 310k iterations) before
they're written to extension storage.

**There is no password recovery.** Forget it and the keys in the vault are gone
— back your keys up somewhere else.

## Using it

1. Paste the NFT contract address, set quantity
2. **Scan drop** — reads price, fee recipient, per-wallet cap and the live
   window from the SeaDrop contract
3. Check the numbers, then **Fire** — now, or at a set time

## Where your keys go

Nowhere. There is no server in this extension. The manifest grants network
access to Robinhood RPC endpoints and nothing else, so even a bug could not
post your keys somewhere — there's no host to post them to. Signing happens in
the page with viem; only the signed transaction leaves your machine.

Use dedicated hot wallets funded with what you intend to spend.

## Scope

Public SeaDrop stages only. Merkle allowlist and OpenSea-signed stages are not
supported yet.

## License

MIT. The local SeaDrop approach follows
[nft-public-mint](https://github.com/morsyxbt/nft-public-mint) by @morsyxbt,
MIT licensed.
