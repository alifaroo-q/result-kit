/**
 * Experiment 02 — generator finalization on the failure path.
 *
 * The load-bearing question: when a do-notation block short-circuits, do the
 * body's `try/finally` blocks run?
 *
 * Reading Effect v4's driver (packages/effect/src/internal/effect.ts,
 * `fromIteratorUnsafe`): when a yielded effect's exit is a Failure the driver
 * returns the failure and simply drops the iterator — there is no
 * `iterator.return()` anywhere in the file. Hypothesis: `try/finally` inside
 * Effect.gen does NOT run on failure; Effect's prescribed tool is
 * `Effect.ensuring` / Scope. Ours DOES close the generator (#36 retro).
 */
import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';

describe('try/finally in the body, failure path', () => {
  it('ours: finally runs on short-circuit', () => {
    let released = false;
    const r = safeTry(function* () {
      try {
        yield* safeUnwrap(err('boom' as const));
        return ok(1);
      } finally {
        released = true;
      }
    });
    expect(r).toEqual(err('boom'));
    expect(released).toBe(true);
  });

  it('effect: does finally run when a yielded effect fails?', () => {
    let released = false;
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        try {
          yield* Effect.fail('boom');
          return 1;
        } finally {
          released = true;
        }
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    // Observation, not assertion of a preferred value — record what Effect does:
    console.log('[02] Effect.gen finally on failure ran:', released);
  });

  it('effect: the prescribed alternative — Effect.ensuring — does run', () => {
    let released = false;
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        yield* Effect.fail('boom');
        return 1;
      }).pipe(Effect.ensuring(Effect.sync(() => (released = true)))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    console.log('[02] Effect.ensuring on failure ran:', released);
  });
});

describe('try/catch around a failing yield*', () => {
  it('ours: catch does NOT observe a short-circuit (return-style unwind), finally does', () => {
    let caught = false;
    let finallyRan = false;
    const r = safeTry(function* () {
      try {
        yield* safeUnwrap(err('boom' as const));
        return ok(1);
      } catch {
        caught = true;
        return ok(-1);
      } finally {
        finallyRan = true;
      }
    });
    expect(r).toEqual(err('boom'));
    expect(caught).toBe(false);
    expect(finallyRan).toBe(true);
  });

  it('effect: can a body catch a failing yield*?', () => {
    let caught = false;
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        try {
          yield* Effect.fail('boom');
          return 1;
        } catch {
          caught = true;
          return -1;
        }
      }),
    );
    console.log('[02] Effect.gen catch observed failure:', caught, 'exit tag:', exit._tag);
  });
});

describe('nested finallys unwind outside-in, async finally is awaited', () => {
  it('ours: every pending finally runs, innermost first', () => {
    const order: string[] = [];
    safeTry(function* () {
      try {
        try {
          yield* safeUnwrap(err('boom' as const));
          return ok(1);
        } finally {
          order.push('inner');
        }
      } finally {
        order.push('outer');
      }
    });
    expect(order).toEqual(['inner', 'outer']);
  });

  it('ours: async short-circuit still waits for the async finally', async () => {
    const order: string[] = [];
    const r = await safeTry(async function* () {
      try {
        yield* safeUnwrap(Promise.resolve(err('boom' as const)));
        return ok(1);
      } finally {
        await Promise.resolve();
        order.push('finally');
      }
    });
    order.push('settled');
    expect(r).toEqual(err('boom'));
    expect(order).toEqual(['finally', 'settled']);
  });
});
