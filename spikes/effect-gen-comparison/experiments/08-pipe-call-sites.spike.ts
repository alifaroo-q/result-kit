/**
 * Experiment 08 — the same three call-sites, written four ways.
 *
 * This is the artifact the ADR grilling reacts to. Nothing here is a
 * micro-benchmark or a toy: each call-site is a shape that actually occurs in
 * a checkout flow, and all four spellings of each are asserted to produce the
 * SAME value, so the comparison is purely about how they read and how they
 * type — not about what they do.
 *
 * The four ways:
 *   1. `pipe` + bare lambdas   — the candidate (data-first core, no `dual`)
 *   2. `/fluent` chaining      — the shipped hero surface
 *   3. `safeTry`               — do-notation
 *   4. nested free functions   — the shipped lean path, written inside-out
 *
 * Call-site C is the honest stress test: seven steps. Two and three steps
 * flatter the nested form; the argument for a pipeline operator is only ever
 * made at length.
 */
import { describe, expect, it } from 'vitest';
import {
  andThen,
  defineError,
  err,
  inspect,
  map,
  mapErr,
  match,
  ok,
  orElse,
  safeTry,
  safeUnwrap,
  type Result,
} from '../../../src/index.ts';
import { from } from '../../../src/fluent/index.ts';
import { pipe } from './07-pipe-candidate.spike.ts';

/* ------------------------------------------------------------------ *
 * Domain — one set of steps, shared by all twelve spellings
 * ------------------------------------------------------------------ */

const invalidQuantity = defineError.withData<{ raw: string }>()(
  'invalid_quantity',
  'Quantity must be a positive integer',
);
const overLimit = defineError.withData<{ requested: number }>()(
  'over_limit',
  'Quantity exceeds the per-order limit',
);
const reservationFailed = defineError.withData<{ sku: string }>()(
  'reservation_failed',
  'Could not reserve stock',
);
const priceUnavailable = defineError(
  'price_unavailable',
  'Pricing service unreachable',
);

type InvalidQuantity = ReturnType<typeof invalidQuantity>;
type OverLimit = ReturnType<typeof overLimit>;
type ReservationFailed = ReturnType<typeof reservationFailed>;
type PriceUnavailable = ReturnType<typeof priceUnavailable>;

interface Line {
  readonly sku: string;
  readonly qty: number;
}
interface Reservation {
  readonly id: string;
  readonly qty: number;
}

const SKU = 'WIDGET-1';
const LIMIT = 10;

const parseQuantity = (raw: string): Result<number, InvalidQuantity> => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0
    ? ok(n)
    : err(invalidQuantity({ raw }));
};

const checkLimit = (qty: number): Result<number, OverLimit> =>
  qty <= LIMIT ? ok(qty) : err(overLimit({ requested: qty }));

const toLine = (qty: number): Line => ({ sku: SKU, qty });

const priceOf = (line: Line): Result<number, PriceUnavailable> =>
  line.qty === 7 ? err(priceUnavailable()) : ok(line.qty * 250);

const applyDiscount = (cents: number): number =>
  cents >= 1000 ? Math.round(cents * 0.9) : cents;

/**
 * Recovery that is *selective* — it rescues a pricing outage and re-raises
 * anything else. A blanket `() => ok(999)` collapses the error channel to
 * `never`, which then makes a downstream `mapErr` callback take a `never`
 * parameter; realistic recovery preserves the union it cannot handle.
 */
const listPrice = <E extends { readonly type: string }>(
  e: E,
): Result<number, E> => (e.type === 'price_unavailable' ? ok(999) : err(e));

const reserve = async (
  qty: number,
): Promise<Result<Reservation, ReservationFailed>> =>
  qty === 9 ? err(reservationFailed({ sku: SKU })) : ok({ id: 'r-1', qty });

const toReceipt = (r: Reservation): string => `${r.id}:${r.qty}`;

const audited: string[] = [];
const audit = (cents: number): void => void audited.push(`priced:${cents}`);

/* ================================================================== *
 * CALL-SITE A — sync, three steps, error-widening
 *   Result<number, InvalidQuantity>
 *     -> Result<number, InvalidQuantity | OverLimit>
 *     -> Result<Line,   InvalidQuantity | OverLimit>
 * ================================================================== */

const a1_pipe = (raw: string) =>
  pipe(
    parseQuantity(raw),
    (r) => andThen(r, checkLimit),
    (r) => map(r, toLine),
  );

const a2_fluent = (raw: string) =>
  from(parseQuantity(raw)).andThen(checkLimit).map(toLine).toResult();

const a3_safeTry = (raw: string) =>
  safeTry(function* () {
    const qty = yield* safeUnwrap(parseQuantity(raw));
    const checked = yield* safeUnwrap(checkLimit(qty));
    return ok(toLine(checked));
  });

const a4_nested = (raw: string) =>
  map(andThen(parseQuantity(raw), checkLimit), toLine);

describe('call-site A — sync, error-widening', () => {
  const ways = { a1_pipe, a2_fluent, a3_safeTry, a4_nested };

  for (const [name, run] of Object.entries(ways)) {
    it(`${name}: agrees on Ok`, () => {
      expect(run('3')).toEqual(ok({ sku: SKU, qty: 3 }));
    });
    it(`${name}: agrees on the first Err`, () => {
      expect(run('x')).toEqual(err(invalidQuantity({ raw: 'x' })));
    });
    it(`${name}: agrees on the widened Err`, () => {
      expect(run('99')).toEqual(err(overLimit({ requested: 99 })));
    });
  }
});

/* ================================================================== *
 * CALL-SITE B — the sync→async seam
 *   a settled Result crosses into promise-land, then two more steps
 * ================================================================== */

const b1_pipe = (raw: string) =>
  pipe(
    parseQuantity(raw),
    (r) => andThen(r, checkLimit),
    // THE SEAM. `pipe` has no name for it — this lambda is the whole
    // ceremony, and it reads like a no-op to anyone who does not already
    // know §10.9. Compare `/fluent`'s `.toAsync()` below.
    (r) => Promise.resolve(r),
    (r) => andThen(r, reserve),
    (r) => map(r, toReceipt),
  );

const b2_fluent = (raw: string) =>
  from(parseQuantity(raw))
    .andThen(checkLimit)
    .toAsync()
    .andThen(reserve)
    .map(toReceipt)
    .toResult();

const b3_safeTry = (raw: string) =>
  safeTry(async function* () {
    const qty = yield* safeUnwrap(parseQuantity(raw));
    const checked = yield* safeUnwrap(checkLimit(qty));
    const reservation = yield* safeUnwrap(await reserve(checked));
    return ok(toReceipt(reservation));
  });

const b4_nested = (raw: string) =>
  map(
    andThen(
      Promise.resolve(andThen(parseQuantity(raw), checkLimit)),
      reserve,
    ),
    toReceipt,
  );

describe('call-site B — sync→async seam', () => {
  const ways = { b1_pipe, b2_fluent, b3_safeTry, b4_nested };

  for (const [name, run] of Object.entries(ways)) {
    it(`${name}: agrees on Ok`, async () => {
      await expect(run('3')).resolves.toEqual(ok('r-1:3'));
    });
    it(`${name}: agrees on the pre-seam Err (async work never starts)`, async () => {
      await expect(run('x')).resolves.toEqual(
        err(invalidQuantity({ raw: 'x' })),
      );
    });
    it(`${name}: agrees on the post-seam Err`, async () => {
      await expect(run('9')).resolves.toEqual(
        err(reservationFailed({ sku: SKU })),
      );
    });
  }
});

/* ================================================================== *
 * CALL-SITE C — seven steps: parse, limit, line, price, audit,
 * recover, discount, render. The length at which a pipeline operator
 * is supposed to pay for itself.
 * ================================================================== */

const c1_pipe = (raw: string) =>
  pipe(
    parseQuantity(raw),
    (r) => andThen(r, checkLimit),
    (r) => map(r, toLine),
    (r) => andThen(r, priceOf),
    (r) => inspect(r, audit),
    (r) => orElse(r, listPrice),
    (r) => map(r, applyDiscount),
    (r) => mapErr(r, (e) => e.type),
    (r) => match(r, { ok: (c) => `£${(c / 100).toFixed(2)}`, err: (t) => t }),
  );

const c2_fluent = (raw: string) =>
  from(parseQuantity(raw))
    .andThen(checkLimit)
    .map(toLine)
    .andThen(priceOf)
    .inspect(audit)
    .orElse(listPrice)
    .map(applyDiscount)
    .mapErr((e) => e.type)
    .match({ ok: (c) => `£${(c / 100).toFixed(2)}`, err: (t) => t });

const c3_safeTry = (raw: string) => {
  const priced = safeTry(function* () {
    const qty = yield* safeUnwrap(parseQuantity(raw));
    const checked = yield* safeUnwrap(checkLimit(qty));
    const line = toLine(checked);
    const cents = yield* safeUnwrap(priceOf(line));
    audit(cents);
    return ok(cents);
  });
  // `safeTry` has no `orElse`: recovery is not a step inside a do-block, it
  // wraps one. Two constructs where the other three use one.
  const recovered = orElse(priced, listPrice);
  return match(mapErr(recovered, (e) => e.type), {
    ok: (c) => `£${(applyDiscount(c) / 100).toFixed(2)}`,
    err: (t) => t,
  });
};

const c4_nested = (raw: string) =>
  match(
    mapErr(
      map(
        orElse(
          inspect(
            andThen(map(andThen(parseQuantity(raw), checkLimit), toLine), priceOf),
            audit,
          ),
          listPrice,
        ),
        applyDiscount,
      ),
      (e) => e.type,
    ),
    { ok: (c) => `£${(c / 100).toFixed(2)}`, err: (t) => t },
  );

describe('call-site C — seven steps with recovery and a terminal', () => {
  const ways = { c1_pipe, c2_fluent, c3_safeTry, c4_nested };

  for (const [name, run] of Object.entries(ways)) {
    it(`${name}: agrees on the priced path`, () => {
      audited.length = 0;
      expect(run('5')).toBe('£11.25'); // 5*250 = 1250, discounted 1125
      expect(audited).toEqual(['priced:1250']);
    });
    it(`${name}: agrees on the recovered path`, () => {
      audited.length = 0;
      expect(run('7')).toBe('£9.99'); // priceOf fails, listPrice recovers
      expect(audited).toEqual([]);
    });
    it(`${name}: agrees when recovery declines the error`, () => {
      expect(run('x')).toBe('invalid_quantity');
    });
  }
});
