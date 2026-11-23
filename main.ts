// Trend-guard bot for cbBTC (agent-fun/bars-replay/v1), long only, one position.
//
// Why it is built this way: a full-size round trip in this replay costs roughly
// 30-45 bps once the 4 bps fee, the 2 bps modelled slippage and the constant-
// product price impact against the pool depth are all paid, so a bot that
// trades the chop pays the window's whole move to the pool and keeps nothing.
// This bot therefore trades rarely and deliberately:
//
//   - Entry: it stays in cash until the trailing 2-hour (120-bar) return is
//     above +0.25% -- a move has to be underway, not just hoped for. A window
//     that opens by falling never gets bought into at the top.
//   - Hold: while the position is on it is left alone. There is no profit
//     target and no short-horizon exit; trends are ridden to the end of the
//     window unless one of the guards below fires.
//   - Guards (any one sells the whole position):
//       * hard stop: the position is worth 2.5% less than it cost;
//       * trailing stop: the close is 3.5% under the highest close since entry;
//       * regime break: the trailing 4-hour (240-bar) return is under -2%.
//     In a rising window none of them comes close to firing (they are far
//     outside the noise: a 1-minute close moves ~9 bps), so the hold behaves
//     like buy-and-hold; in a falling window they cut the loss early and the
//     bot keeps most of its cash while holders ride the fall to the bottom.
//   - Re-entry: after an exit the bar is higher -- at least 120 bars flat, a
//     fresh 120-bar closing high and a trailing 2-hour return above +0.8% --
//     so a stopped-out bot does not churn back into a bounce that is failing.
//
// Sizing: a buy spends 98% of the cash (and never more than the weight cap
// leaves room for), which keeps the order's own price impact near 10-18 bps
// at the depths this pool shows while capturing nearly the whole move.
//
// Everything is decided from the account and the bars in each batch, in
// integer arithmetic on the raw prices, so two runs over the same window give
// the same orders byte for byte: no clock, no randomness, no floats in any
// comparison. Orders carry a 300 bps max slippage against the latest close;
// a refused order is simply decided again on the next bar, because every rule
// below is read from the state the batch reports, not from orders remembered.

import { runBars, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Trailing windows, in bars of the symbol (1 bar = 1 minute). */
const MOM_BARS = 120; // 2 hours: the entry momentum and the re-entry high
const REGIME_BARS = 240; // 4 hours: the downtrend guard
/** Bars to stay flat after an exit before a re-entry is even considered. */
const REENTRY_COOLDOWN = 120;
/** Slippage cap on every order, against the latest close it was decided on. */
const MAX_SLIPPAGE_BPS = 300;

/** The closes of the symbol's bars, oldest first, raw price units. */
const closes: bigint[] = [];
/** The highest close since the current position appeared; 0 while flat. */
let peak = 0n;
/** Whether a position has been held at any earlier batch of this run. */
let everHeld = false;
/** Consecutive batches spent flat since the last batch that held a position. */
let flatBars = 0;

await runBars({
  onBatch(state, batch) {
    // Fold this batch's bar in first: every decision reads the latest close.
    let close: bigint | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      close = BigInt(bar.c);
      closes.push(close);
      if (closes.length > REGIME_BARS + 1) closes.shift();
    }

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      everHeld = true;
      flatBars = 0;
      if (close !== null && close > peak) peak = close;
    } else {
      peak = 0n;
      if (everHeld) flatBars++;
    }
    if (state.warmingUp || close === null) return [];

    const orders: OrderInput[] = [];

    if (held !== undefined) {
      // ----- exits: any guard sells the whole position -----
      const value = state.value(SYMBOL, held.qty);
      const hardStop = value * 1000n <= held.cost * 975n; // worth 2.5% under its cost
      const trailed = peak > 0n && close * 1000n <= peak * 965n; // 3.5% under the peak close
      let regimeBreak = false;
      if (closes.length > REGIME_BARS) {
        const then = closes[closes.length - 1 - REGIME_BARS]!;
        regimeBreak = close * 100n < then * 98n; // trailing 4h return under -2%
      }
      if (hardStop || trailed || regimeBreak) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
      return orders;
    }

    // ----- entries: only once 2 hours of closes exist to measure momentum -----
    if (closes.length <= MOM_BARS) return orders;
    const then = closes[closes.length - 1 - MOM_BARS]!;
    if (!everHeld) {
      // First entry: the trailing 2h return above +0.25% (close/then > 401/400).
      if (close * 400n > then * 401n) {
        const order = buy(state);
        if (order !== null) orders.push(order);
      }
    } else if (flatBars >= REENTRY_COOLDOWN) {
      // Re-entry: a fresh 120-bar closing high and the trailing 2h return
      // above +0.8% (close/then > 126/125).
      let high = 0n;
      for (let i = closes.length - MOM_BARS; i < closes.length; i++) {
        if (closes[i]! > high) high = closes[i]!;
      }
      if (close >= high && close * 125n > then * 126n) {
        const order = buy(state);
        if (order !== null) orders.push(order);
      }
    }
    return orders;
  },
});

/** A buy of 98% of the cash, capped by the weight room; null when under the minimum notional. */
function buy(state: {
  cash: bigint;
  weightRoom(symbol: string): bigint;
  hello: { fees: { min_notional_quote_units: string } };
}): OrderInput | null {
  const room = state.weightRoom(SYMBOL);
  const budget = state.cash < room ? state.cash : room;
  const notional = (budget * 98n) / 100n;
  if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return null;
  return { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
}
