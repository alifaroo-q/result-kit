/**
 * Experiment 13 — does TS `using` / `Symbol.dispose` interoperate with
 * `safeTry` generator bodies? (issue #91, fourth probe.)
 *
 * The hypothesis worth testing: `using` is the language's own answer to
 * experiment 12's B and D — it binds release to acquisition at the point of
 * acquisition (so partial acquire is structurally safe) and it releases LIFO
 * without nesting. If it survives `safeTry`'s `.return()`-driven close, then a
 * large part of what `Scope` sells is already in the runtime and the recipe can
 * simply point at it.
 *
 * The mechanism it has to survive: `safeTry` short-circuits by suspending the
 * body at a `yield` and then driving `generator.return()` until done. `using`
 * is specified as a lowering to `try/finally` over the block, so it *should*
 * unwind the same way a hand-written `finally` does — but "should" is what an
 * experiment is for, and the async variant (`await using` in an
 * `async function*`, disposed in a microtask during close) is the half where a
 * plausible implementation could drop the disposal.
 *
 * Effect's counterpart is `Effect.acquireDisposable`, which explicitly consumes
 * `Symbol.dispose` / `Symbol.asyncDispose` and ties them to a `Scope` — so this
 * is a place where the two designs converge on the same language feature rather
 * than diverging.
 *
 * Toolchain note (load-bearing for any recipe): `using` needs TS 5.2+ and a
 * declaration of `Symbol.dispose`. This spike's `lib` is `ES2023`, which does
 * NOT declare it — it type-checks here only because `@types/node` backfills the
 * disposable symbols. The root tsconfig is in the same position (`ES2023` +
 * `types: ["node"]`). A consumer on `lib: ES2023` *without* `@types/node` needs
 * `esnext.disposable` added to `lib`, or the recipe does not compile for them.
 */
import { describe, expect, it } from 'vitest';
import { err, ok, safeTry, safeUnwrap, type Result } from '../../../src/index.ts';

type Handle = { readonly name: string };

/** A resource whose disposal is infallible — the shape `using` can express. */
const disposable = (log: string[], name: string): Handle & Disposable => ({
  name,
  [Symbol.dispose]() {
    log.push(`release-${name}`);
  },
});

const asyncDisposable = (
  log: string[],
  name: string,
): Handle & AsyncDisposable => ({
  name,
  async [Symbol.asyncDispose]() {
    await Promise.resolve();
    log.push(`release-${name}`);
  },
});

// ---------------------------------------------------------------------------
// Does it survive the close at all?
// ---------------------------------------------------------------------------

describe('`using` inside a sync safeTry body', () => {
  it('disposes on the short-circuit path', () => {
    const log: string[] = [];

    const r = safeTry(function* () {
      using _a = disposable(log, 'a');
      log.push('acquire-a');
      yield* safeUnwrap(err('boom' as const));
      return ok(1);
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['acquire-a', 'release-a']);
  });

  it('disposes on the success path', () => {
    const log: string[] = [];

    const r = safeTry(function* () {
      using _a = disposable(log, 'a');
      log.push('acquire-a');
      return ok(1);
    });

    expect(r).toEqual(ok(1));
    expect(log).toEqual(['acquire-a', 'release-a']);
  });

  it('multiple resources dispose LIFO with NO nesting — the shape 12A needed three levels for', () => {
    const log: string[] = [];

    const r = safeTry(function* () {
      using _a = disposable(log, 'a');
      using _b = disposable(log, 'b');
      using _c = disposable(log, 'c');
      yield* safeUnwrap(err('boom' as const));
      return ok(1);
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-c', 'release-b', 'release-a']);
  });

  it('partial acquire is structurally safe — 12B\'s footgun cannot be written', () => {
    const log: string[] = [];
    const acquireB = (): Result<Handle & Disposable, 'open-failed'> => {
      log.push('acquire-b-FAILED');
      return err('open-failed');
    };

    const r = safeTry(function* () {
      using _a = disposable(log, 'a');
      log.push('acquire-a');
      // `b` is never bound, so there is no `_b` to dispose. The hoisted-handle
      // shape from 12B has no analogue here: `using` cannot bind a value that
      // was not produced.
      using _b = yield* safeUnwrap(acquireB());
      return ok(1);
    });

    expect(r).toEqual(err('open-failed'));
    expect(log).toEqual(['acquire-a', 'acquire-b-FAILED', 'release-a']);
  });
});

describe('`await using` inside an async safeTry body', () => {
  it('disposes on the short-circuit path, and the caller waits for it', async () => {
    const log: string[] = [];

    const r = await safeTry(async function* () {
      await using _a = asyncDisposable(log, 'a');
      log.push('acquire-a');
      yield* safeUnwrap(Promise.resolve(err('boom' as const)));
      return ok(1);
    });
    log.push('settled');

    expect(r).toEqual(err('boom'));
    // `release-a` before `settled` is the load-bearing part: the async unwind
    // completed before `safeTry`'s promise resolved.
    expect(log).toEqual(['acquire-a', 'release-a', 'settled']);
  });

  it('mixes with a hand-written finally, and the two interleave by scope', async () => {
    const log: string[] = [];

    const r = await safeTry(async function* () {
      try {
        await using _a = asyncDisposable(log, 'a');
        yield* safeUnwrap(Promise.resolve(err('boom' as const)));
        return ok(1);
      } finally {
        log.push('outer-finally');
      }
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-a', 'outer-finally']);
  });
});

// ---------------------------------------------------------------------------
// Where it stops. This is the part that decides recipe-vs-helper.
// ---------------------------------------------------------------------------

describe('the limits of `using` for this package', () => {
  it('a fallible release cannot be expressed — dispose has nowhere to put an Err', () => {
    const log: string[] = [];
    // `Symbol.dispose` returns void. A release that can fail has exactly two
    // exits: throw (which F4 says propagates loudly and would replace the
    // short-circuit Err), or swallow. It CANNOT `yield*`, because dispose is a
    // plain method, not part of the generator body — so the F1 pattern
    // (`yield* safeUnwrap(close())` in a finally) is unavailable here.
    const lossy: Handle & Disposable = {
      name: 'a',
      [Symbol.dispose]() {
        const closed: Result<void, 'close-failed'> = err('close-failed');
        // The Err is observed here and can go nowhere.
        log.push(`release-a-${closed.ok ? 'ok' : 'FAILED'}`);
      },
    };

    const r = safeTry(function* () {
      using _a = lossy;
      yield* safeUnwrap(err('boom' as const));
      return ok(1);
    });

    expect(r).toEqual(err('boom'));
    expect(log).toEqual(['release-a-FAILED']);
    // This IS strictly worse than the hand-written finally, and 12C is why: a
    // `yield*`-ed cleanup Err is discarded only when the body already failed —
    // on the success path it becomes the block's answer. `Symbol.dispose` has
    // no path to that outcome at all, because it cannot reach the generator.
    // So `using` trades away the one case where cleanup failure is reportable.
  });

  it('a throwing dispose replaces the short-circuit Err — same rule as F4', () => {
    const thrower: Handle & Disposable = {
      name: 'a',
      [Symbol.dispose]() {
        throw new Error('close-exploded');
      },
    };

    expect(() =>
      safeTry(function* () {
        using _a = thrower;
        yield* safeUnwrap(err('boom' as const));
        return ok(1);
      }),
    ).toThrow(/close-exploded/);
    // Consistent with F4's `finally { throw }` finding — `using` introduces no
    // new rule, which is the answer we want.
  });

  it('the acquiring helper still cannot own the release — 12D is NOT closed by `using`', () => {
    const log: string[] = [];
    // `using` moves the release to the *point of acquisition*, but the binding
    // is still lexical to the block that writes `using`. A helper returning a
    // `Disposable` has improved things — the obligation is now *visible in the
    // return type* — but nothing forces the caller to write `using` rather than
    // `const`, and getting it wrong is silent.
    const openConnection = (): Result<Handle & Disposable, 'open-failed'> => {
      log.push('acquire-conn');
      return ok(disposable(log, 'conn'));
    };

    const leaky = safeTry(function* () {
      const conn = yield* safeUnwrap(openConnection()); // ← `const`, not `using`
      yield* safeUnwrap(err('boom' as const));
      return ok(conn.name);
    });

    expect(leaky).toEqual(err('boom'));
    expect(log).toEqual(['acquire-conn']); // no release — same leak as 12D
    // The gap versus Effect is narrowed but not closed: Effect makes the
    // omission a compile error via the `Scope` requirement, `using` makes it a
    // lint rule at best. TypeScript has no "must be `using`" annotation.
  });
});
