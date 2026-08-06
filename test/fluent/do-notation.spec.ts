import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  err as coreErr,
  ok as coreOk,
  safeUnwrap,
} from '../../src/index';
import type { Err, Result } from '../../src/index';
import * as fluent from '../../src/fluent/index';
import { ResultAsync, from, ok, safeTry } from '../../src/fluent/index';
import type { ResultChain } from '../../src/fluent/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * Spec §6.3 / ADR 0007 §3: on `/fluent` the wrapper is **self-iterable**, so
 * `yield* chain` needs no `safeUnwrap`. These assertions are what make that
 * claim true rather than aspirational.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}
interface Forbidden {
  readonly type: 'forbidden';
}
interface Conflict {
  readonly type: 'conflict';
}

interface User {
  readonly credit: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };
const forbidden: Forbidden = { type: 'forbidden' };
const conflict: Conflict = { type: 'conflict' };

const user: User = { credit: 10 };

/**
 * Function stubs rather than annotated consts, for the reason
 * `result-chain.spec.ts` records: an annotated `const` is narrowed by
 * control-flow analysis to the constructed half *despite* the annotation, so `E`
 * draws no inference candidate and every downstream assertion reads the error
 * channel as `unknown`. A return annotation is not narrowed.
 */
const okUser = (): Result<User, NotFound> => coreOk(user);
const errUser = (): Result<User, NotFound> => coreErr(notFound);

const chainUser = (): ResultChain<User, NotFound> => from(okUser());
const chainErrUser = (): ResultChain<User, NotFound> => from(errUser());
const chainForbidden = (): ResultChain<number, Forbidden> =>
  from(coreErr(forbidden));

const asyncUser = (): ResultAsync<User, NotFound> =>
  ResultAsync.from(Promise.resolve(okUser()));
const asyncErrUser = (): ResultAsync<User, NotFound> =>
  ResultAsync.from(Promise.resolve(errUser()));
const asyncScore = (): ResultAsync<number, never> =>
  ResultAsync.from(Promise.resolve(coreOk(42)));

/**
 * The iterator protocol itself, asserted directly rather than through `safeTry`.
 *
 * These exist because the runner **launders** a wrapper yielded by mistake: its
 * `instanceof ResultChain` arm normalizes one back to a plain union on the way
 * out, so a wrapper-yielding iterator leaves the whole suite green while
 * violating §7.3 the moment root's `safeTry` drives a fluent chain. Asserting on
 * `safeTry`'s *output* cannot see that; asserting on `.next()` can.
 */
describe('the iterators yield plain data, not wrappers (§7.3)', () => {
  it('resultChainIterator_onErr_yieldsThePlainErr', () => {
    const yielded = chainErrUser()[Symbol.iterator]().next().value;

    expect(yielded).toEqual(coreErr(notFound));
  });

  it('resultChainIterator_onErr_yieldsAnObjectNotAWrapperInstance', () => {
    const yielded = chainErrUser()[Symbol.iterator]().next().value;

    expect((yielded as object).constructor).toBe(Object);
  });

  it('resultChainIterator_onOk_returnsTheUnwrappedValue', () => {
    const settled = chainUser()[Symbol.iterator]().next();

    expect(settled).toEqual({ done: true, value: user });
  });

  it('resultAsyncIterator_onErr_yieldsThePlainErr', async () => {
    const settled = await asyncErrUser()[Symbol.asyncIterator]().next();

    expect(settled.value).toEqual(coreErr(notFound));
  });

  it('resultAsyncIterator_onErr_yieldsAnObjectNotAWrapperInstance', async () => {
    const settled = await asyncErrUser()[Symbol.asyncIterator]().next();

    expect((settled.value as object).constructor).toBe(Object);
  });

  it('resultAsyncIterator_onOk_returnsTheUnwrappedValue', async () => {
    const settled = await asyncUser()[Symbol.asyncIterator]().next();

    expect(settled).toEqual({ done: true, value: user });
  });
});

describe('ResultChain[Symbol.iterator] — the sync wrapper is self-iterable', () => {
  it('safeTry_syncGeneratorYieldingAChain_unwrapsWithNoSafeUnwrap', () => {
    const chain = safeTry(function* () {
      const found = yield* chainUser();

      return ok(found.credit);
    });

    expect(chain.toResult()).toEqual(coreOk(10));
  });

  it('safeTry_syncGenerator_returnsAResultChain', () => {
    const chain = safeTry(function* () {
      const found = yield* chainUser();

      return ok(found.credit);
    });

    expectTypeOf(chain).toEqualTypeOf<ResultChain<number, NotFound>>();
  });

  it('safeTry_chainYieldsErr_shortCircuitsToThatError', () => {
    const chain = safeTry(function* () {
      const found = yield* chainErrUser();

      return ok(found.credit);
    });

    expect(chain.toResult()).toEqual(coreErr(notFound));
  });

  it('safeTry_chainYieldsErr_neverRunsTheStepsAfterIt', () => {
    const later = vi.fn(() => coreOk(1));

    safeTry(function* () {
      yield* chainErrUser();

      return ok(yield* safeUnwrap(later()));
    });

    expect(later).not.toHaveBeenCalled();
  });

  it('safeTry_chainYieldsErr_closesTheGeneratorSoFinallyRuns', () => {
    const release = vi.fn();

    safeTry(function* () {
      try {
        yield* chainErrUser();

        return ok(1);
      } finally {
        release();
      }
    });

    expect(release).toHaveBeenCalledOnce();
  });

  it('safeTry_twoChainErrorsAndAReturnedErr_accumulatesTheUnion', () => {
    const chain = safeTry(function* () {
      const found = yield* chainUser();
      const score = yield* chainForbidden();

      if (score < 0) return fluent.err(conflict);

      return ok(found.credit + score);
    });

    expectTypeOf(chain).toEqualTypeOf<
      ResultChain<number, NotFound | Forbidden | Conflict>
    >();
  });

  it('safeTry_returnedErrExit_shortCircuitsToThatError', () => {
    const chain = safeTry(function* () {
      yield* chainUser();

      return fluent.err(conflict);
    });

    expect(chain.toResult()).toEqual(coreErr(conflict));
  });
});

describe('ResultAsync[Symbol.asyncIterator] — the async wrapper is self-iterable', () => {
  it('safeTry_asyncGeneratorYieldingAResultAsync_unwrapsWithNoSafeUnwrap', async () => {
    const wrapped = safeTry(async function* () {
      const found = yield* asyncUser();

      return ok(found.credit);
    });

    expect(await wrapped.toResult()).toEqual(coreOk(10));
  });

  it('safeTry_asyncGenerator_returnsAResultAsync', () => {
    const wrapped = safeTry(async function* () {
      const found = yield* asyncUser();

      return ok(found.credit);
    });

    expectTypeOf(wrapped).toEqualTypeOf<ResultAsync<number, NotFound>>();
  });

  it('safeTry_resultAsyncYieldsErr_shortCircuitsToThatError', async () => {
    const wrapped = safeTry(async function* () {
      const found = yield* asyncErrUser();

      return ok(found.credit);
    });

    expect(await wrapped.toResult()).toEqual(coreErr(notFound));
  });

  it('safeTry_asyncGeneratorShortCircuits_closesTheGeneratorSoFinallyRuns', async () => {
    const release = vi.fn();

    await safeTry(async function* () {
      try {
        yield* asyncErrUser();

        return ok(1);
      } finally {
        await Promise.resolve();
        release();
      }
    }).toResult();

    expect(release).toHaveBeenCalledOnce();
  });

  it('safeTry_asyncGeneratorAccumulatesErrors_unionsTheChannel', () => {
    const wrapped = safeTry(async function* () {
      const found = yield* asyncUser();
      const score = yield* chainForbidden();

      return ok(found.credit + score);
    });

    expectTypeOf(wrapped).toEqualTypeOf<
      ResultAsync<number, NotFound | Forbidden>
    >();
  });

  /**
   * A `ResultAsync` exit needs **no arm in `BodyReturn`**, and the reason is
   * that tsc and the runtime agree rather than that we forbid it (§10.13).
   * `ResultAsync implements PromiseLike`, and an async generator's `TReturn` is
   * awaited on *both* sides — so this types as the plain `Result` that
   * `BodyReturn` already admits, and resolves to it too.
   *
   * An earlier draft of §10.13 claimed the opposite and excluded the shape on
   * that basis. These two assertions are what would have caught it.
   */
  it('safeTry_asyncBodyExitingWithAResultAsync_typesAsTheAwaitedResult', () => {
    const wrapped = safeTry(async function* () {
      yield* asyncUser();

      return asyncScore();
    });

    expectTypeOf(wrapped).toEqualTypeOf<ResultAsync<number, NotFound>>();
  });

  it('safeTry_asyncBodyExitingWithAResultAsync_resolvesToItsValue', async () => {
    const wrapped = safeTry(async function* () {
      yield* asyncUser();

      return asyncScore();
    });

    expect(await wrapped.toResult()).toEqual(coreOk(42));
  });

  it('safeTry_asyncGeneratorResult_isAwaitableDirectly', async () => {
    const settled = await safeTry(async function* () {
      const found = yield* asyncUser();

      return ok(found.credit);
    });

    expect(settled).toEqual(coreOk(10));
  });
});

describe('the mixed case — root safeUnwrap inside a fluent safeTry', () => {
  it('safeTry_plainUnionViaSafeUnwrapAlongsideAChain_unwrapsBoth', () => {
    const chain = safeTry(function* () {
      const wrapped = yield* chainUser();
      const plain = yield* safeUnwrap(okUser());

      return ok(wrapped.credit + plain.credit);
    });

    expect(chain.toResult()).toEqual(coreOk(20));
  });

  it('safeTry_plainUnionViaSafeUnwrap_accumulatesIntoTheSameChannel', () => {
    const chain = safeTry(function* () {
      const wrapped = yield* chainForbidden();
      const plain = yield* safeUnwrap(okUser());

      return ok(plain.credit + wrapped);
    });

    expectTypeOf(chain).toEqualTypeOf<
      ResultChain<number, Forbidden | NotFound>
    >();
  });

  it('safeTry_bodyExitingWithAPlainResult_infersBothChannelsFromIt', () => {
    // Pins `ValueOf`/`ErrorOf`'s **plain** arms. §10.13 argues the plain half is
    // kept rather than tolerated; without this, deleting the `Ok<infer T>` arm
    // silently collapses the value channel to `never` and both commands stay
    // green — the §10.10 masking hazard, which is why this is exact-type.
    const chain = safeTry(function* () {
      yield* chainForbidden();

      return okUser();
    });

    expectTypeOf(chain).toEqualTypeOf<ResultChain<User, Forbidden | NotFound>>();
  });

  it('safeTry_plainUnionShortCircuits_returnsAWrapperNotPlainData', () => {
    const chain = safeTry(function* () {
      const plain = yield* safeUnwrap(errUser());

      return ok(plain.credit);
    });

    expect(chain).toBeInstanceOf(Object);
    expect(chain.constructor.name).toBe('ResultChain');
    expect(chain.toResult()).toEqual(coreErr(notFound));
  });
});

/**
 * §10.11's mechanism, pointed at the new runner. §2's union is brandless, so a
 * structurally valid `{ ok: true, value }` may also carry a `then` — and a body
 * that mixes in root's `safeUnwrap` can return exactly such a value. Asking "is
 * this thenable?" before "is this settled?" assimilates it, and a synchronous
 * block comes back as a `ResultAsync` where the signature promised a
 * `ResultChain`.
 */
describe('a thenable-carrying Result returned from a sync body (§10.11)', () => {
  const sneakyOk = (): Result<number, never> =>
    ({
      ok: true,
      value: 1,
      then() {
        /* never settles — assimilating this is the bug */
      },
    }) as unknown as Result<number, never>;

  it('safeTry_bodyReturnsAThenableCarryingResult_stillReturnsAResultChain', () => {
    const chain = safeTry(function* () {
      yield* chainUser();

      return sneakyOk();
    });

    expect(chain.constructor.name).toBe('ResultChain');
  });

  it('safeTry_bodyReturnsAThenableCarryingResult_readsAsTheSettledOkItIs', () => {
    const chain = safeTry(function* () {
      yield* chainUser();

      return sneakyOk();
    });

    expect(chain.toResult().ok).toBe(true);
  });
});

describe('/fluent exports no safeUnwrap (§6.3)', () => {
  it('fluentSurface_atRuntime_hasNoSafeUnwrap', () => {
    expect(fluent).not.toHaveProperty('safeUnwrap');
  });

  it('fluentSurface_atTheTypeLevel_hasNoSafeUnwrap', () => {
    expectTypeOf(fluent).not.toHaveProperty('safeUnwrap');
  });
});

describe('§2 is untouched — the core union stays plain data', () => {
  it('coreOk_atRuntime_hasNoSymbolIterator', () => {
    expect(
      (coreOk(1) as unknown as Record<symbol, unknown>)[Symbol.iterator],
    ).toBeUndefined();
  });

  it('coreErr_atRuntime_hasNoSymbolIterator', () => {
    expect(
      (coreErr('boom') as unknown as Record<symbol, unknown>)[Symbol.iterator],
    ).toBeUndefined();
  });

  it('coreOk_spreadAsAnIterable_throws', () => {
    expect(() => [
      ...(coreOk(1) as unknown as Iterable<unknown>),
    ]).toThrow(TypeError);
  });

  it('coreOk_yieldStarred_isATypeError', () => {
    // The type-level half of the same guarantee: the plain union is not
    // iterable, so the adapter is still required at root. Enforced by `tsc`.
    function* body() {
      // @ts-expect-error — the core union is not iterable (§2, ADR 0007 §2)
      yield* coreOk(1);

      return coreOk(1);
    }

    expect(typeof body).toBe('function');
  });
});

/**
 * The hostile-edge mirror (#85, item 1) — the same pathological bodies the
 * Effect.gen comparison spike ran against the core runner
 * (`spikes/effect-gen-comparison`, experiments 03 / 04 / 05; findings F1, F3,
 * F4, F5, F7, F20), re-aimed at `/fluent`.
 *
 * **Why these are not duplicates of `test/core/do-notation.spec.ts`.** The core
 * blocks drive a *core* `safeUnwrap` generator from the *core* runner. Here both
 * ends are different: the yielded step is the wrapper's own
 * `[Symbol.iterator]`, which `yield*`s the core adapter — so the unwind
 * `release` drives crosses **two** levels of generator delegation rather than
 * one — and the answer leaves through `/fluent`'s `safeTry`, which re-wraps it
 * (`ResultAsync.from(Promise.resolve(settled).then(toPlain))` on the async
 * side). The delegation is the thing under test; nothing above asserted it, and
 * the spike ran none of these through the wrapper.
 */

const chainOk = (value: number): ResultChain<number, never> => ok(value);
const chainFailing = (error: string): ResultChain<never, string> =>
  fluent.err(error);
const asyncFailing = (error: string): ResultAsync<never, string> =>
  ResultAsync.from(Promise.resolve(coreErr(error)));

describe('a yielded wrapper inside a finally that runs during close (F1)', () => {
  it('safeTry_innerFinallyYieldsAChainMidClose_stillRunsTheOuterFinally', () => {
    const log: string[] = [];

    safeTry(function* (): Generator<Err<string>, ResultChain<number, never>> {
      try {
        try {
          yield* chainFailing('first');

          return ok(1);
        } finally {
          log.push('inner');
          yield* chainFailing('cleanup-failed');
        }
      } finally {
        log.push('outer');
      }
    });

    expect(log).toEqual(['inner', 'outer']);
  });

  it('safeTry_innerFinallyYieldsAChainMidClose_keepsTheFirstErrAsTheAnswer', () => {
    const chain = safeTry(function* (): Generator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        yield* chainFailing('first');

        return ok(1);
      } finally {
        yield* chainFailing('cleanup-failed');
      }
    });

    expect(chain.toResult()).toEqual(coreErr('first'));
  });

  it('safeTry_innerFinallyYieldsAChainMidClose_stillReturnsAResultChain', () => {
    // The unwind must not disturb which half of the dual runner answers: a
    // `function*` body owes a `ResultChain`, not a `ResultAsync`.
    const chain = safeTry(function* (): Generator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        yield* chainFailing('first');

        return ok(1);
      } finally {
        yield* chainFailing('cleanup-failed');
      }
    });

    expect(chain.constructor.name).toBe('ResultChain');
  });

  it('safeTry_asyncFinallyYieldsAResultAsyncMidClose_settlesOnlyAfterTheFullUnwind', async () => {
    // Discriminating probe, as in the core suite: the outer cleanup awaits, so
    // only a release that follows the unwind across every re-suspension — and
    // survives `/fluent`'s extra `.then(toPlain)` layer — sees it before the
    // returned `ResultAsync` settles.
    const log: string[] = [];

    const settled = await safeTry(async function* (): AsyncGenerator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        try {
          yield* asyncFailing('first');

          return ok(1);
        } finally {
          yield* asyncFailing('cleanup-failed');
        }
      } finally {
        await Promise.resolve();
        log.push('outer');
      }
    }).toResult();
    log.push('settled');

    expect(log).toEqual(['outer', 'settled']);
    expect(settled).toEqual(coreErr('first'));
  });
});

/**
 * F5 and F20, which are one rule — "first `Err` wins" — with two visible
 * outcomes. Worth pinning at `/fluent` because the discarded override here is a
 * **wrapper**: the dual constructor makes `return ok(999)` inside a `finally`
 * produce a `ResultChain`, a shape `BodyReturn` genuinely admits, so "ignored"
 * has to mean ignored rather than unwrapped-then-ignored.
 */
describe('cleanup cannot re-route the answer, but is reported on success (F5/F20)', () => {
  it('safeTry_finallyReturningAChainDuringClose_isIgnored', () => {
    const chain = safeTry(function* (): Generator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        yield* chainFailing('boom');

        return ok(1);
      } finally {
        // eslint-disable-next-line no-unsafe-finally
        return ok(999);
      }
    });

    expect(chain.toResult()).toEqual(coreErr('boom'));
  });

  it('safeTry_cleanupErrOnTheSuccessPath_becomesTheAnswer', () => {
    // The asymmetry F20 measured: a cleanup `Err` is swallowed on the failure
    // path and *reported* on the success path, because `return ok(1)` enters
    // the `finally` and its yield is the first `.next()`.
    const chain = safeTry(function* (): Generator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        return ok(1);
      } finally {
        yield* chainFailing('close-failed');
      }
    });

    expect(chain.toResult()).toEqual(coreErr('close-failed'));
  });
});

/**
 * F4 — there is no defect channel, and `/fluent` adds none. A throw must not
 * become an `Err`, and must not be smuggled into a wrapper the caller would
 * have to remember to inspect.
 */
describe('a throw is propagated, not converted into a wrapper (F4)', () => {
  it('safeTry_syncBodyThrows_throwsRatherThanReturningAWrapper', () => {
    expect(() =>
      safeTry(function* (): Generator<Err<never>, ResultChain<number, never>> {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });

  it('safeTry_finallyThrowsDuringClose_winsOverTheShortCircuitErr', () => {
    // Runner behaviour, not language behaviour: the throw escapes from the
    // `.return()` that `release` drives, so it replaces the `ResultChain` the
    // signature promised.
    expect(() =>
      safeTry(function* (): Generator<Err<string>, ResultChain<number, never>> {
        try {
          yield* chainFailing('first');

          return ok(1);
        } finally {
          throw new Error('cleanup-threw');
        }
      }),
    ).toThrow('cleanup-threw');
  });

  it('safeTry_asyncBodyThrows_rejectsTheReturnedResultAsync', async () => {
    const wrapped = safeTry(async function* (): AsyncGenerator<
      Err<never>,
      ResultChain<number, never>
    > {
      throw new Error('boom');
    });

    await expect(wrapped.toResult()).rejects.toThrow('boom');
  });

  it('safeTry_asyncFinallyThrowsDuringClose_rejectsRatherThanSettlingWithTheErr', async () => {
    const wrapped = safeTry(async function* (): AsyncGenerator<
      Err<string>,
      ResultChain<number, never>
    > {
      try {
        yield* asyncFailing('first');

        return ok(1);
      } finally {
        await Promise.resolve();
        throw new Error('cleanup-threw');
      }
    });

    await expect(wrapped.toResult()).rejects.toThrow('cleanup-threw');
  });
});

/**
 * F7 — reuse. An `Effect` is a re-runnable description and a generator is
 * single-shot, which is why Effect's eager gen has to detect re-execution. The
 * wrapper sits on the other side of that trade: it holds a **settled** `Result`
 * and hands out a fresh generator per `[Symbol.iterator]()` call, so it is
 * re-iterable *and* has no side effects to restart. Driving one past its
 * short-circuit by hand is still the diagnosable mistake it is at root — and
 * that diagnostic reaches the caller only because the wrapper delegates.
 */
describe('driving a wrapper iterator by hand (F7)', () => {
  it('resultChainIterator_resumedAfterShortCircuit_throwsTheSafeTryDiagnostic', () => {
    const iterator = chainFailing('boom')[Symbol.iterator]();
    iterator.next();

    expect(() => iterator.next()).toThrow('drive it with safeTry');
  });

  it('resultAsyncIterator_resumedAfterShortCircuit_rejectsWithTheSafeTryDiagnostic', async () => {
    const iterator = asyncFailing('boom')[Symbol.asyncIterator]();
    await iterator.next();

    await expect(iterator.next()).rejects.toThrow('drive it with safeTry');
  });

  it('resultChain_iteratedTwice_yieldsTheSameErrEachTime', () => {
    const chain = chainFailing('boom');

    const first = chain[Symbol.iterator]().next().value;
    const second = chain[Symbol.iterator]().next().value;

    expect(second).toEqual(first);
  });

  it('safeTry_drivingTheSameChainTwice_returnsTheSameAnswer', () => {
    const chain = chainOk(1);
    const body = function* (): Generator<Err<never>, ResultChain<number, never>> {
      return ok(yield* chain);
    };

    expect(safeTry(body).toResult()).toEqual(safeTry(body).toResult());
  });
});

/**
 * F3 / §10.11 at the *yield* slot. §2's union is brandless, so a structurally
 * valid `Err` may carry a callable `then` — and `from()` will happily wrap one.
 * The sync path is immune only because `isSettledResult` asks Result-first, and
 * the wrapper inherits that immunity rather than restating it. The existing
 * §10.11 block above covers the body's *return* slot; this covers the step.
 */
describe('a thenable-carrying Err yielded through the wrapper (F3, §10.11)', () => {
  const sneakyErr = (calls: { count: number }): Result<number, string> =>
    ({
      ok: false,
      error: 'real-error',
      then(resolve: (value: unknown) => void) {
        calls.count += 1;
        resolve({ hijacked: true });
      },
    }) as unknown as Result<number, string>;

  it('resultChainIterator_onAThenableCarryingErr_yieldsItByIdentity', () => {
    const calls = { count: 0 };
    const hostile = sneakyErr(calls);

    const yielded = from(hostile)[Symbol.iterator]().next().value;

    expect(yielded).toBe(hostile);
  });

  it('resultChainIterator_onAThenableCarryingErr_neverCallsItsThen', () => {
    const calls = { count: 0 };

    from(sneakyErr(calls))[Symbol.iterator]().next();

    expect(calls.count).toBe(0);
  });

  it('safeTry_shortCircuitingOnAThenableCarryingErr_returnsAResultChain', () => {
    // The failure this pins is a wrapper swap: asking "is this thenable?"
    // before "is this settled?" would hand a synchronous body's answer back as
    // a `ResultAsync`, and the `then` above never settles — so the call site
    // would hang rather than fail.
    const calls = { count: 0 };

    const chain = safeTry(function* (): Generator<
      Err<string>,
      ResultChain<number, never>
    > {
      yield* from(sneakyErr(calls));

      return ok(1);
    });

    expect(chain.constructor.name).toBe('ResultChain');
  });
});
