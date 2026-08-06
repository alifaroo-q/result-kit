/**
 * Experiment 12 — the resource-safety gap: `safeTry` + `try/finally` vs
 * Effect's `Scope` / `acquireRelease` (issue #91).
 *
 * F2 already settled the headline: our failure-path unwind is *stronger* than
 * `Effect.gen`'s, because we close the generator and they drop the iterator.
 * That is not the question here. The question is what `Scope` buys **on top of**
 * a `finally` that already runs — and the answer is not "cleanup runs", it is
 * four narrower properties:
 *
 *   A. release ordering across multiple resources (LIFO)
 *   B. release-on-partial-acquire — resource 1 held, resource 2 fails to acquire
 *   C. cleanup that is itself fallible (F1 territory — does the fix *compose*?)
 *   D. a resource that outlives the lexical block that acquired it
 *
 * A-C are things `try/finally` can express. D is the one it structurally cannot,
 * and B is the one it expresses only under a discipline that fails *silently*
 * when a caller gets it wrong. Both halves are demonstrated below rather than
 * argued, because the recipe-vs-helper decision (#92) turns on exactly which of
 * these a written recipe can be trusted to carry.
 *
 * Effect prior art read at `effect@4.0.0-beta.104`:
 * `packages/effect/src/Effect.ts` (`acquireRelease`, `acquireUseRelease`,
 * `scoped`, `addFinalizer`) and `packages/effect/src/Scope.ts` (`make`,
 * `addFinalizerExit`, `close`, finalizer strategy `sequential` | `parallel`).
 */
import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';
import { err, ok, safeTry, safeUnwrap, type Result } from '../../../src/index.ts';

/** A fake resource that records its own lifecycle into a shared log. */
type Handle = { readonly name: string };

const openOk = (log: string[], name: string) => (): Result<Handle, 'open-failed'> => {
  log.push(`acquire-${name}`);
  return ok({ name });
};

const openErr = (log: string[], name: string) => (): Result<Handle, 'open-failed'> => {
  log.push(`acquire-${name}-FAILED`);
  return err('open-failed');
};

const close = (log: string[]) => (h: Handle): void => {
  log.push(`release-${h.name}`);
};

// ---------------------------------------------------------------------------
// A. Multi-resource ordering — both release LIFO. No gap.
// ---------------------------------------------------------------------------

describe('A. multi-resource acquisition ordering', () => {
  it('ours: nested try/finally releases LIFO on the failure path', () => {
    const log: string[] = [];
    const acquireA = openOk(log, 'a');
    const acquireB = openOk(log, 'b');
    const release = close(log);

    const r = safeTry(function* () {
      const a = yield* safeUnwrap(acquireA());
      try {
        const b = yield* safeUnwrap(acquireB());
        try {
          yield* safeUnwrap(err('boom' as const));
          return ok(1);
        } finally {
          release(b);
        }
      } finally {
        release(a);
      }
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['acquire-a', 'acquire-b', 'release-b', 'release-a']);
  });

  it('effect: Scope finalizers also run LIFO, and see the Exit', () => {
    const log: string[] = [];
    const scoped = (name: string) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          log.push(`acquire-${name}`);
          return { name };
        }),
        (h, exit) =>
          Effect.sync(() => {
            // The one thing a `finally` cannot see without extra bookkeeping:
            // *why* we are unwinding.
            log.push(`release-${h.name}-${Exit.isSuccess(exit) ? 'ok' : 'fail'}`);
          }),
      );

    const exit = Effect.runSyncExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scoped('a');
          yield* scoped('b');
          return yield* Effect.fail('boom');
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(log).toEqual([
      'acquire-a',
      'acquire-b',
      'release-b-fail',
      'release-a-fail',
    ]);
  });

  it('ours: the exit reason is recoverable, but only by hand', () => {
    // A `finally` has no argument. Knowing whether you are unwinding a success
    // or a failure costs a mutable flag set on the last line of the `try` —
    // which is exactly the bookkeeping `acquireRelease` does for you, and
    // exactly the kind a caller forgets.
    const log: string[] = [];
    const r = safeTry(function* () {
      let ok_ = false;
      try {
        yield* safeUnwrap(err('boom' as const));
        ok_ = true;
        return ok(1);
      } finally {
        log.push(`release-${ok_ ? 'ok' : 'fail'}`);
      }
    });
    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-fail']);
  });
});

// ---------------------------------------------------------------------------
// B. Release-on-partial-acquire — the discipline gap.
// ---------------------------------------------------------------------------

describe('B. release on partial acquire', () => {
  it('ours, written correctly: the un-acquired resource is not released', () => {
    const log: string[] = [];
    const acquireA = openOk(log, 'a');
    const acquireB = openErr(log, 'b');
    const release = close(log);

    const r = safeTry(function* () {
      const a = yield* safeUnwrap(acquireA());
      try {
        const b = yield* safeUnwrap(acquireB()); // ← short-circuits here
        try {
          return ok(`${a.name}${b.name}`);
        } finally {
          release(b);
        }
      } finally {
        release(a);
      }
    });

    expect(r).toEqual(err('open-failed'));
    // `a` released, `b` never released because it was never acquired.
    expect(log).toEqual(['acquire-a', 'acquire-b-FAILED', 'release-a']);
  });

  it('ours, the plausible wrong shape: hoisting the handles releases a non-resource', () => {
    // The shape a caller reaches for to avoid the nesting in the correct
    // version: hoist both handles, one `try`, release both in one `finally`.
    // It type-checks, it reads fine, and it releases a resource that was never
    // acquired — silently, because `b` is `undefined` and `?.` swallows it.
    const log: string[] = [];
    const acquireA = openOk(log, 'a');
    const acquireB = openErr(log, 'b');

    const releases: string[] = [];
    const r = safeTry(function* () {
      let a: Handle | undefined;
      let b: Handle | undefined;
      try {
        a = yield* safeUnwrap(acquireA());
        b = yield* safeUnwrap(acquireB());
        return ok(`${a.name}${b.name}`);
      } finally {
        // Reads as "release what we took". Reality: `b` is undefined, and the
        // release of `a` is now conditional on a check the author added for
        // TypeScript's benefit, not for correctness.
        if (b) releases.push(`release-${b.name}`);
        if (a) releases.push(`release-${a.name}`);
      }
    });

    expect(r).toEqual(err('open-failed'));
    expect(releases).toEqual(['release-a']);
    // ...which is *correct here*. The failure mode is one line away: drop the
    // `if (b)` guard (or use a release that tolerates undefined) and a
    // non-resource gets closed. See the next test.
    void log;
  });

  it('ours: the same shape with a tolerant release closes a resource that was never opened', () => {
    const log: string[] = [];
    const acquireA = openOk(log, 'a');
    const acquireB = openErr(log, 'b');
    // A real-world release is often already nullish-tolerant — a pool `.release`,
    // a `conn?.end()`. Then nothing forces the author to think about it.
    const tolerantRelease = (h: Handle | undefined) => log.push(`release-${h?.name}`);

    safeTry(function* () {
      let a: Handle | undefined;
      let b: Handle | undefined;
      try {
        a = yield* safeUnwrap(acquireA());
        b = yield* safeUnwrap(acquireB());
        return ok(1);
      } finally {
        tolerantRelease(b);
        tolerantRelease(a);
      }
    });

    // `release-undefined` is a released resource that never existed. No type
    // error, no runtime error, no test failure unless someone asserts on it.
    expect(log).toEqual([
      'acquire-a',
      'acquire-b-FAILED',
      'release-undefined',
      'release-a',
    ]);
  });

  it('effect: partial acquire is structurally safe — release is registered with acquire', () => {
    const log: string[] = [];
    const scopedOk = (name: string) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          log.push(`acquire-${name}`);
          return { name };
        }),
        (h) => Effect.sync(() => log.push(`release-${h.name}`)),
      );
    const scopedFail = (name: string) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          log.push(`acquire-${name}-FAILED`);
          return Effect.fail('open-failed' as const);
        }),
        () => Effect.sync(() => log.push(`release-${name}`)),
      );

    const exit = Effect.runSyncExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* scopedOk('a');
          yield* scopedFail('b');
          return 1;
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    // No discipline required: a finalizer only exists once its acquire succeeded.
    expect(log).toEqual(['acquire-a', 'acquire-b-FAILED', 'release-a']);
  });
});

// ---------------------------------------------------------------------------
// C. Fallible cleanup — does the F1 fix compose across nesting?
// ---------------------------------------------------------------------------

describe('C. cleanup that is itself fallible (F1 territory)', () => {
  it('ours: two nested finallys, each yielding during close, both run innermost-first', () => {
    const log: string[] = [];
    const closeFallible = (name: string): Result<void, 'close-failed'> => {
      log.push(`release-${name}`);
      return ok(undefined);
    };

    const r = safeTry(function* () {
      try {
        try {
          yield* safeUnwrap(err('boom' as const));
          return ok(1);
        } finally {
          yield* safeUnwrap(closeFallible('inner'));
        }
      } finally {
        yield* safeUnwrap(closeFallible('outer'));
      }
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-inner', 'release-outer']);
  });

  it('ours: three levels deep still unwinds completely', () => {
    const log: string[] = [];
    const closeFallible = (name: string): Result<void, 'close-failed'> => {
      log.push(`release-${name}`);
      return ok(undefined);
    };

    const r = safeTry(function* () {
      try {
        try {
          try {
            yield* safeUnwrap(err('boom' as const));
            return ok(1);
          } finally {
            yield* safeUnwrap(closeFallible('c'));
          }
        } finally {
          yield* safeUnwrap(closeFallible('b'));
        }
      } finally {
        yield* safeUnwrap(closeFallible('a'));
      }
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-c', 'release-b', 'release-a']);
  });

  it('ours: a FAILING cleanup is silently discarded — and does not stop the unwind', () => {
    const log: string[] = [];
    const r = safeTry(function* () {
      try {
        try {
          yield* safeUnwrap(err('boom' as const));
          return ok(1);
        } finally {
          log.push('release-inner');
          // This Err is consumed by the close loop and thrown away (F1's
          // first-Err-wins discard rule). The caller is never told that
          // releasing the inner resource failed.
          yield* safeUnwrap(err('close-failed' as const));
        }
      } finally {
        log.push('release-outer');
      }
    });

    expect(r).toEqual(err('boom'));
    // The outer finally still runs — the unwind is not stopped by the failure.
    expect(log).toEqual(['release-inner', 'release-outer']);
  });

  it('ours: on the SUCCESS path a failing cleanup is NOT discarded — it becomes the answer', () => {
    // Predicted wrong, and the real behaviour is better than the prediction.
    // The discard rule is "the *first* Err wins", not "cleanup never reports".
    // On the success path there is no competing Err, so the cleanup's Err is
    // the first one — and it replaces the `ok(1)` the body was returning.
    //
    // Mechanism: `return ok(1)` enters the `finally`, which `yield`s. So the
    // very first `.next()` comes back `{ done: false, value: Err }` — the
    // ordinary short-circuit path. `safeTry` never has to special-case this.
    const log: string[] = [];
    const r = safeTry(function* () {
      try {
        return ok(1);
      } finally {
        log.push('release');
        yield* safeUnwrap(err('close-failed' as const));
      }
    });

    expect(log).toEqual(['release']);
    expect(r).toEqual(err('close-failed')); // ← reported, and `ok(1)` is dropped
  });

  it('ours: so cleanup failures are reported on success and swallowed on failure', () => {
    // The asymmetry stated on its own, because it is the one rule a recipe has
    // to teach. It is defensible — the original error is the more useful of the
    // two — but it is not "cleanup errors are always lost", and it is not
    // "cleanup errors are always reported" either.
    const outcomes: Result<number, string>[] = [];

    for (const bodyFails of [false, true]) {
      outcomes.push(
        safeTry(function* () {
          try {
            if (bodyFails) yield* safeUnwrap(err('boom' as string));
            return ok(1);
          } finally {
            yield* safeUnwrap(err('close-failed' as string));
          }
        }),
      );
    }

    expect(outcomes).toEqual([err('close-failed'), err('boom')]);
  });

  it('effect: a failing finalizer is NOT discarded — it surfaces in the Cause', () => {
    const log: string[] = [];
    const exit = Effect.runSyncExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => ({ name: 'a' })),
            () =>
              Effect.suspend(() => {
                log.push('release-a');
                return Effect.die('close-failed');
              }),
          );
          return 1;
        }),
      ),
    );

    expect(log).toEqual(['release-a']);
    // The success path does not stay a success: the finalizer's failure is
    // reported. Ours has no channel for this (F4: two channels by design).
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('ours: async — the caller waits for a fallible async cleanup to finish', async () => {
    const log: string[] = [];
    const r = await safeTry(async function* () {
      try {
        yield* safeUnwrap(Promise.resolve(err('boom' as const)));
        return ok(1);
      } finally {
        yield* safeUnwrap(
          Promise.resolve(ok(undefined) as Result<void, 'close-failed'>),
        );
        log.push('release');
      }
    });
    log.push('settled');

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release', 'settled']);
  });
});

// ---------------------------------------------------------------------------
// D. The structural gap: a resource that outlives its lexical block.
// ---------------------------------------------------------------------------

describe('D. resource outliving the acquiring function', () => {
  it('ours: an acquiring helper cannot register its own release — the caller must', () => {
    const log: string[] = [];

    // The shape a caller wants: one reusable helper per resource, composed.
    // `try/finally` is lexical, so this helper CANNOT attach cleanup to the
    // handle it returns. The obligation escapes into the caller's discipline,
    // and nothing in the type says it exists.
    const openConnection = (): Result<Handle, 'open-failed'> => {
      log.push('acquire-conn');
      return ok({ name: 'conn' });
    };

    // A caller who forgets. Compiles, passes review, leaks.
    const leaky = safeTry(function* () {
      const conn = yield* safeUnwrap(openConnection());
      yield* safeUnwrap(err('boom' as const));
      return ok(conn.name);
    });

    expect(leaky).toEqual(err('boom'));
    expect(log).toEqual(['acquire-conn']); // ← no release. Nothing complained.
  });

  it('effect: the obligation is in the TYPE — a scoped resource cannot be run unscoped', () => {
    const log: string[] = [];
    const openConnection = Effect.acquireRelease(
      Effect.sync(() => {
        log.push('acquire-conn');
        return { name: 'conn' };
      }),
      (h) => Effect.sync(() => log.push(`release-${h.name}`)),
    );

    const program = Effect.gen(function* () {
      const conn = yield* openConnection;
      yield* Effect.fail('boom');
      return conn.name;
    });

    // `program` has `Scope` in its requirements channel. Forgetting
    // `Effect.scoped` is a COMPILE error, not a leak — see 13's type section.
    const exit = Effect.runSyncExit(Effect.scoped(program));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(log).toEqual(['acquire-conn', 'release-conn']);
  });

  it('ours: the closest expressible equivalent is a callback-scoped "with" helper', () => {
    // The pattern that DOES close the gap without a requirements channel: invert
    // control so the helper owns the lexical block. This is what a recipe or a
    // helper export would spell. Note the shape it forces on the caller: the
    // body becomes a nested generator, and `safeTry` must be re-entered.
    const log: string[] = [];

    const acquire = (): Result<Handle, 'open-failed'> => {
      log.push('acquire-conn');
      return ok({ name: 'conn' });
    };

    const withConnection = <T, E>(
      use: (h: Handle) => Result<T, E>,
    ): Result<T, E | 'open-failed'> =>
      safeTry(function* () {
        const conn = yield* safeUnwrap(acquire());
        try {
          const value = yield* safeUnwrap(use(conn));
          return ok(value);
        } finally {
          log.push('release-conn');
        }
      });

    const r = withConnection((conn) =>
      conn.name === 'conn' ? err('boom' as const) : ok(1),
    );

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['acquire-conn', 'release-conn']);
  });
});
