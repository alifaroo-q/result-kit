/**
 * Experiment 01 — baseline parity.
 *
 * Establishes that our safeTry/safeUnwrap and Effect v4's Effect.gen agree on
 * the do-notation basics: bind, short-circuit, laziness of later steps, and
 * what the block evaluates to on each branch.
 */
import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';

describe('happy path', () => {
  it('ours: binds each value, returns the explicit Ok', () => {
    const r = safeTry(function* () {
      const a = yield* safeUnwrap(ok(1));
      const b = yield* safeUnwrap(ok(2));
      return ok(a + b);
    });
    expect(r).toEqual(ok(3));
  });

  it('effect: binds each value, auto-succeeds the returned value', () => {
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        const a = yield* Effect.succeed(1);
        const b = yield* Effect.succeed(2);
        return a + b; // NOTE: bare value — Effect.gen auto-wraps; ours requires `return ok(v)`
      }),
    );
    expect(exit).toEqual(Exit.succeed(3));
  });
});

describe('short-circuit', () => {
  it('ours: first Err wins, later steps never run', () => {
    const ran: string[] = [];
    const r = safeTry(function* () {
      ran.push('a');
      yield* safeUnwrap(err({ type: 'boom', message: 'x' }));
      ran.push('unreachable');
      return ok('never');
    });
    expect(r).toEqual(err({ type: 'boom', message: 'x' }));
    expect(ran).toEqual(['a']);
  });

  it('effect: first failure wins, later steps never run', () => {
    const ran: string[] = [];
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        ran.push('a');
        yield* Effect.fail('boom');
        ran.push('unreachable');
        return 'never';
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(ran).toEqual(['a']);
  });
});

describe('async parity', () => {
  it('ours: async body unwraps Promise<Result> and short-circuits', async () => {
    const r = await safeTry(async function* () {
      const a = yield* safeUnwrap(Promise.resolve(ok(1)));
      const b = yield* safeUnwrap(Promise.resolve(err('late' as const)));
      return ok(a + (b as never));
    });
    expect(r).toEqual(err('late'));
  });

  it('effect: promise-backed effects short-circuit the same way', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const a = yield* Effect.promise(() => Promise.resolve(1));
        yield* Effect.tryPromise(() => Promise.reject('late'));
        return a;
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
