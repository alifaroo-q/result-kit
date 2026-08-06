/**
 * Experiment 05 — scale and reuse.
 *
 *  A. many sequential unwraps in one body (wide, not deep)
 *  B. nesting depth (deep) — where does each model hit the wall?
 *  C. reuse: an Effect value is a re-runnable description; our safeTry runs
 *     once, eagerly. Effect v4's eager gen re-creates the iterator on re-run
 *     (`isFirstExecution` in fromIteratorEagerUnsafe) — a footgun class we
 *     don't have, but the mirror question is whether OUR eager run is safe
 *     against double-driving.
 */
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';
import type { Err, Result } from '../../../src/index.ts';

describe('A: 100k sequential unwraps', () => {
  it('ours: one body, 100_000 Ok unwraps', () => {
    const r = safeTry(function* () {
      let total = 0;
      for (let i = 0; i < 100_000; i++) total += yield* safeUnwrap(ok(1));
      return ok(total);
    });
    expect(r).toEqual(ok(100_000));
  });

  it('effect: one body, 100_000 succeed yields', () => {
    const value = Effect.runSync(
      Effect.gen(function* () {
        let total = 0;
        for (let i = 0; i < 100_000; i++) total += yield* Effect.succeed(1);
        return total;
      }),
    );
    expect(value).toBe(100_000);
  });
});

describe('B: nesting depth', () => {
  const oursAtDepth = (depth: number): Result<number, never> => {
    const go = (n: number): Result<number, never> =>
      safeTry(function* (): Generator<Err<never>, Result<number, never>> {
        if (n === 0) return ok(0);
        const inner = yield* safeUnwrap(go(n - 1));
        return ok(inner + 1);
      });
    return go(depth);
  };

  it('ours: nested safeTry — find the rough wall', () => {
    expect(oursAtDepth(1_000)).toEqual(ok(1_000));
    let wall = 'none up to 20k';
    try {
      oursAtDepth(20_000);
    } catch (e) {
      wall = (e as Error).constructor.name;
    }
    console.log('[05B] ours at depth 20_000:', wall);
  });

  it('effect: nested gen at depth 20_000 (fiber runtime is heap-based)', () => {
    const go = (n: number): Effect.Effect<number> =>
      Effect.gen(function* () {
        if (n === 0) return 0;
        return (yield* go(n - 1)) + 1;
      });
    let outcome: string;
    try {
      outcome = `ok ${Effect.runSync(go(20_000))}`;
    } catch (e) {
      outcome = `threw ${(e as Error).constructor.name}`;
    }
    console.log('[05B] effect at depth 20_000:', outcome);
  });
});

describe('C: reuse semantics', () => {
  it('effect: the SAME gen value can be run twice, body re-executes fresh', () => {
    let runs = 0;
    const eff = Effect.gen(function* () {
      runs += 1;
      return yield* Effect.succeed(runs);
    });
    expect(Effect.runSync(eff)).toBe(1);
    expect(Effect.runSync(eff)).toBe(2); // description, not computation
  });

  it('ours: safeTry is eager and single-shot by design — calling it twice needs a fresh body, which the API forces (it takes a thunk)', () => {
    let runs = 0;
    const run = () =>
      safeTry(function* () {
        runs += 1;
        return ok(runs);
      });
    expect(run()).toEqual(ok(1));
    expect(run()).toEqual(ok(2));
  });

  it('ours: hand-driving a safeUnwrap generator past its short-circuit throws (pinned upstream, re-confirmed here)', () => {
    const gen = safeUnwrap(err('boom' as const));
    const first = gen.next();
    expect(first).toEqual({ done: false, value: err('boom') });
    expect(() => gen.next()).toThrowError(/resumed after short-circuit/);
  });
});
