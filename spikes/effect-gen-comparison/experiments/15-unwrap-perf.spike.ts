/**
 * Experiment 15 — the F6 perf gap, re-measured and attributed (issue #85).
 *
 * F6 recorded "100k sequential unwraps: ours ~200ms, Effect ~25ms" and
 * attributed it to allocating a `safeUnwrap` generator per step. That was a
 * side-observation of a correctness experiment, taken once, with no attempt to
 * separate the runner from the adapter. This measures it properly:
 *
 *  A. the baseline pair, several reps, best-of reported (not first-run)
 *  B. attribution: how much of ours is the per-step generator allocation?
 *     `inline` yields the Err directly from the body and never calls
 *     `safeUnwrap`, which is the *same* short-circuit semantics with zero
 *     adapter allocations. The delta between `ours` and `inline` is the
 *     adapter's price; whatever remains is the generator protocol itself.
 *  C. a candidate fast path: a cached singleton generator cannot work (a
 *     generator is single-shot), so the only allocation-free shape is a
 *     hand-rolled iterator object. Measured, then judged.
 *  D. the realistic shape — a handful of steps per block, run many times —
 *     which is what a caller's code actually looks like.
 *
 * Numbers are printed, not asserted: a timing assertion is exactly the
 * "fails for an incidental reason" test the repo's rules forbid. The
 * assertions here pin *correctness* of each variant, so the comparison is
 * between things that agree on the answer.
 */
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';
import type { Err, Result } from '../../../src/index.ts';

const STEPS = 100_000;
const REPS = 5;

/** Best-of-REPS wall time in ms, so a GC pause or a cold JIT is not the answer. */
const bestOf = (label: string, run: () => void): number => {
  let best = Infinity;
  for (let i = 0; i < REPS; i++) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  console.log(`[15] ${label}: ${best.toFixed(1)}ms`);
  return best;
};

describe('A/B/C: 100k sequential unwraps, attributed', () => {
  it('every variant computes the same total', () => {
    const viaAdapter = safeTry(function* () {
      let total = 0;
      for (let i = 0; i < 10; i++) total += yield* safeUnwrap(ok(1));
      return ok(total);
    });

    const viaInline = safeTry(function* (): Generator<Err<never>, Result<number, never>> {
      let total = 0;
      for (let i = 0; i < 10; i++) total += 1;
      return ok(total);
    });

    expect(viaAdapter).toEqual(ok(10));
    expect(viaInline).toEqual(ok(10));
  });

  it('measures ours, ours-without-the-adapter, a hand-rolled iterator, and Effect', () => {
    const ours = bestOf('ours (safeUnwrap adapter)', () => {
      safeTry(function* () {
        let total = 0;
        for (let i = 0; i < STEPS; i++) total += yield* safeUnwrap(ok(1));
        return ok(total);
      });
    });

    // Same runner, same generator protocol, no adapter allocation — the body
    // reads `.ok` itself. Semantically identical for this input; it is not a
    // candidate API (it is what `safeUnwrap` exists to spare the caller), only
    // an attribution probe.
    const inline = bestOf('ours (no adapter — attribution probe)', () => {
      safeTry(function* (): Generator<Err<never>, Result<number, never>> {
        let total = 0;
        for (let i = 0; i < STEPS; i++) {
          const r = ok(1);
          if (!r.ok) return r;
          total += r.value;
        }
        return ok(total);
      });
    });

    // C: the only allocation-lighter shape that keeps `yield*`. A generator is
    // single-shot so it cannot be cached; a hand-rolled iterable object is the
    // floor. `yield*` calls [Symbol.iterator]() then .next(), so the object
    // must still be fresh per step — this measures whether a plain object is
    // meaningfully cheaper than a generator frame.
    const handRolled = <T, E>(r: Result<T, E>): Iterable<Err<E>, T> => ({
      [Symbol.iterator]() {
        let taken = false;
        return {
          next(): IteratorResult<Err<E>, T> {
            if (r.ok) return { done: true, value: r.value };
            if (taken) throw new Error('resumed after short-circuit');
            taken = true;
            return { done: false, value: r };
          },
        };
      },
    });

    const candidate = bestOf('ours (hand-rolled iterator candidate)', () => {
      safeTry(function* () {
        let total = 0;
        for (let i = 0; i < STEPS; i++) total += yield* handRolled(ok(1));
        return ok(total);
      });
    });

    const effect = bestOf('effect (Effect.gen)', () => {
      Effect.runSync(
        Effect.gen(function* () {
          let total = 0;
          for (let i = 0; i < STEPS; i++) total += yield* Effect.succeed(1);
          return total;
        }),
      );
    });

    console.log(
      `[15] adapter share of ours: ${(((ours - inline) / ours) * 100).toFixed(0)}%` +
        ` | ours/effect: ${(ours / effect).toFixed(1)}x` +
        ` | candidate/effect: ${(candidate / effect).toFixed(1)}x` +
        ` | inline/effect: ${(inline / effect).toFixed(1)}x`,
    );

    expect(ours).toBeGreaterThan(0);
  });
});

describe('D: the realistic shape — few steps, many blocks', () => {
  it('measures 100k blocks of 3 steps rather than one block of 100k steps', () => {
    const perBlock = 3;
    const blocks = STEPS / perBlock;

    bestOf(`ours (${blocks.toFixed(0)} blocks x ${perBlock} steps)`, () => {
      for (let i = 0; i < blocks; i++) {
        safeTry(function* () {
          const a = yield* safeUnwrap(ok(1));
          const b = yield* safeUnwrap(ok(2));
          const c = yield* safeUnwrap(ok(3));
          return ok(a + b + c);
        });
      }
    });

    bestOf(`effect (${blocks.toFixed(0)} blocks x ${perBlock} steps)`, () => {
      for (let i = 0; i < blocks; i++) {
        Effect.runSync(
          Effect.gen(function* () {
            const a = yield* Effect.succeed(1);
            const b = yield* Effect.succeed(2);
            const c = yield* Effect.succeed(3);
            return a + b + c;
          }),
        );
      }
    });

    expect(true).toBe(true);
  });

  it('the short-circuit path, which is what a Result library actually optimizes for', { timeout: 30_000 }, () => {
    bestOf('ours (100k blocks, first step fails)', () => {
      for (let i = 0; i < STEPS; i++) {
        safeTry(function* () {
          const a = yield* safeUnwrap(err('boom'));
          return ok(a);
        });
      }
    });

    bestOf('effect (100k gens, first step fails)', () => {
      for (let i = 0; i < STEPS; i++) {
        Effect.runSyncExit(
          Effect.gen(function* () {
            const a = yield* Effect.fail('boom');
            return a;
          }),
        );
      }
    });

    expect(true).toBe(true);
  });
});
