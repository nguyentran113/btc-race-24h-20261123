[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/nguyentran113/btc-race-24h-20261123/rank.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/nguyentran113/btc-race-24h-20261123/reward.svg)](https://make.fun/c/btc-race-24h-20261123-0511)

# Trend-Guard cbBTC Bot

A paper-trading bot for the make.fun **btc-race-24h** competition
(`agent-fun/bars-replay/v1`). It trades Coinbase Wrapped BTC (cbBTC) against
USDC on 1-minute bars with $1,000 of paper money, long only, at most one
position. It speaks the replay protocol through the kit's SDK shim, vendored
unchanged at `vendor/makefun-bars.ts`; the strategy itself is `main.ts`.

## Strategy

In this replay a full-size round trip costs roughly 30–45 bps once the 4 bps
fee, the 2 bps modelled slippage and the constant-product price impact against
the pool's depth are all paid. A bot that trades every wiggle hands the whole
window's move to the pool, so this bot trades rarely:

- **Entry — wait for a move that is already underway.** The bot sits in cash
  until the trailing 2-hour (120-bar) return exceeds **+0.25%**. A window that
  opens by falling is never bought into at the top, and chop below the
  threshold is ignored entirely.
- **Hold — ride the trend.** Once in, there is no profit target and no
  short-horizon exit. The position is held to the end of the window unless a
  guard fires.
- **Guards — get out only when the trend is actually broken.** Any one of
  these sells the whole position:
  - *Hard stop:* position worth **2.5%** less than it cost;
  - *Trailing stop:* close **3.5%** below the highest close since entry;
  - *Regime break:* trailing 4-hour (240-bar) return below **−2%**.

  All three sit far outside the 1-minute noise (a minute's close moves ~9 bps),
  so in a rising window they never come close to firing and the hold behaves
  like buy-and-hold; in a falling window they cut the loss early and most of
  the cash survives while unguarded holders ride the fall to the bottom.
- **Re-entry — demand proof.** After an exit, re-entry needs at least 120 bars
  flat, a fresh 120-bar closing high, and a trailing 2-hour return above
  **+0.8%**, so a stopped-out bot does not churn back into a failing bounce.

**Sizing:** a buy spends 98% of the cash (never more than the position-weight
cap allows), keeping the order's own price impact near 10–18 bps at the depths
this pool typically shows. Every order carries a 300 bps max slippage against
the latest close; a refused order is simply decided again on the next bar,
because every rule is read from the account state each batch reports.

## Determinism

All comparisons are integer arithmetic on the raw bar prices and account
amounts — no floats, no wall clock, no randomness, no network, no files. Two
executions over the same window produce byte-identical orders.

## Files

- `main.ts` — the bot (Node 22, standard library only, erasable TypeScript).
- `vendor/makefun-bars.ts` — the kit's protocol shim, copied byte for byte.
- `.makefun/owner.json` — the entrant's wallet claim file.
- `LICENSE` — MIT.

## License

MIT — see `LICENSE`.
