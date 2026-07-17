import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { err as coreErr, ok as coreOk } from '../../src/index';
import type { Result } from '../../src/index';
import {
  ResultAsync,
  from,
  fromPromise,
  fromThrowableAsync,
  ok,
} from '../../src/fluent/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * Two things here are type-level only and fail silently. The **arm order** on
 * `ResultChain`'s members (§5.2's trap, one rung up): a sync-first order
 * captures an async callback with `U = Promise<X>` and hands back
 * `ResultChain<Promise<X>, E>` — an un-awaited promise in a wrapper, typed
 * confidently. And **`ResultAsync`'s casts**: the class states
 * `Promise<Result<U, E>>` where the core's own overloads say
 * `Result<U | Promise<U>, E>`, so the runtime assertions below are what make
 * those casts honest rather than wishful.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}
interface Forbidden {
  readonly type: 'forbidden';
}

interface User {
  readonly credit: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };

const user: User = { credit: 10 };

/** Stubs, not annotated consts — see the note in `result-chain.spec.ts`. */
const okUser = (): Result<User, NotFound> => coreOk(user);
const errUser = (): Result<User, NotFound> => coreErr(notFound);

const asyncOk = (): ResultAsync<User, NotFound> =>
  ResultAsync.from(Promise.resolve(okUser()));
const asyncErr = (): ResultAsync<User, NotFound> =>
  ResultAsync.from(Promise.resolve(errUser()));

describe('ResultAsync.from', () => {
  it('liftsAPromiseOfResultIntoTheWrapper', async () => {
    const ra = ResultAsync.from(Promise.resolve(okUser()));

    await expect(ra.toResult()).resolves.toEqual(coreOk(user));
  });

  it('isExportedAsAValueSoTheStaticIsReachable', async () => {
    const surface = (await import('../../src/fluent/index')) as Record<
      string,
      unknown
    >;

    // Unlike `ResultChain`: ADR 0005 §4 specifies the static, which a
    // type-only export could not provide. The asymmetry is as-decided.
    expect(surface).toHaveProperty('ResultAsync');
    expect(typeof (surface.ResultAsync as { from?: unknown }).from).toBe(
      'function',
    );
  });
});

describe('ResultAsync implements PromiseLike', () => {
  it('isThenable', () => {
    expect(typeof asyncOk().then).toBe('function');
  });

  it('satisfiesPromiseLikeOfThePlainUnion', () => {
    // Safety property 3: this is what gets a floating un-`await`ed ResultAsync
    // flagged by stock `@typescript-eslint/no-floating-promises`, closing the
    // gap v1's custom thenable left open. `then` must stay a plain delegation —
    // anything cleverer defeats the rule.
    expectTypeOf(asyncOk()).toMatchTypeOf<PromiseLike<Result<User, NotFound>>>();
  });

  /**
   * **Safety property 1 — the `await`-collapse guarantee.** `await ra` yields the
   * plain union *by design*, exactly equivalent to `await ra.toResult()`.
   * Awaiting is the sanctioned exit. This is the mitigation for the footgun that
   * spawned ADR 0005, so it is pinned rather than left to hold by coincidence.
   */
  it('awaitCollapse_isLosslessAndEqualsAwaitToResult', async () => {
    const ra = asyncOk();

    expect(await ra).toEqual(await ra.toResult());
  });

  it('awaitCollapse_isLosslessOnTheErrBranchToo', async () => {
    const ra = asyncErr();

    expect(await ra).toEqual(await ra.toResult());
    expect(await ra).toEqual(coreErr(notFound));
  });

  it('awaitCollapse_yieldsPlainDataNotAWrapper', async () => {
    const settled = await asyncOk();

    expect(settled.constructor).toBe(Object);
    expectTypeOf(settled).toEqualTypeOf<Result<User, NotFound>>();
  });
});

describe('ResultAsync chaining members', () => {
  it('map_transformsTheValueWithASyncCallback', async () => {
    await expect(asyncOk().map((u) => u.credit).toResult()).resolves.toEqual(
      coreOk(10),
    );
  });

  /**
   * The cast in `ResultAsync.map` claims the core flattens an async callback's
   * promise. This is what makes that claim true rather than wishful: a value of
   * `10`, not a `Promise` sitting inside an `Ok`.
   */
  it('map_awaitsAnAsyncCallbackRatherThanWrappingThePromise', async () => {
    const result = await asyncOk()
      .map(async (u) => u.credit)
      .toResult();

    expect(result).toEqual(coreOk(10));
  });

  it('map_asyncCallback_doesNotLeakPromiseIntoTheSuccessType', () => {
    const ra = asyncOk().map(async (u) => u.credit);

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<number, NotFound>>();
  });

  it('mapErr_transformsTheErrorWithAnAsyncCallback', async () => {
    await expect(
      asyncErr()
        .mapErr(async (e) => e.id)
        .toResult(),
    ).resolves.toEqual(coreErr('u1'));
  });

  it('andThen_chainsAnAsyncFallibleStepAndAccumulatesTheErrorChannel', async () => {
    const ra = asyncOk().andThen(
      async (u): Promise<Result<number, Forbidden>> => coreOk(u.credit),
    );

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<number, NotFound | Forbidden>>();
    await expect(ra.toResult()).resolves.toEqual(coreOk(10));
  });

  it('orElse_recoversAsynchronously', async () => {
    const ra = asyncErr().orElse(
      async (): Promise<Result<User, Forbidden>> => coreOk(user),
    );

    await expect(ra.toResult()).resolves.toEqual(coreOk(user));
  });

  it('inspect_teesTheValueAndReturnsItUnchanged', async () => {
    const spy = vi.fn();

    const ra = asyncOk().inspect(spy);

    await expect(ra.toResult()).resolves.toEqual(coreOk(user));
    expect(spy).toHaveBeenCalledWith(user);
  });

  it('inspect_awaitsAnAsyncTeeBeforeSettling', async () => {
    const order: string[] = [];

    await asyncOk()
      .inspect(async () => {
        await Promise.resolve();
        order.push('tee');
      })
      .map(() => order.push('map'))
      .toResult();

    expect(order).toEqual(['tee', 'map']);
  });

  it('inspectErr_teesTheError', async () => {
    const spy = vi.fn();

    await asyncErr().inspectErr(spy).toResult();

    expect(spy).toHaveBeenCalledWith(notFound);
  });

  it('theHeroPath_isOneAwaitAtTheFrontAndATerminalAtTheEnd', async () => {
    const displayName = await ok(user)
      .andThen(async (u): Promise<Result<User, Forbidden>> => coreOk(u))
      .map((u) => u.credit)
      .match({ ok: (c) => `credit ${c}`, err: () => 'anon' });

    expect(displayName).toBe('credit 10');
  });
});

describe('the ResultChain → ResultAsync seam', () => {
  it('map_withAnAsyncCallback_crossesToResultAsync', () => {
    const ra = from(okUser()).map(async (u) => u.credit);

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<number, NotFound>>();
  });

  it('map_withASyncCallback_staysAResultChain', () => {
    const chain = from(okUser()).map((u) => u.credit);

    expectTypeOf(chain).not.toEqualTypeOf<ResultAsync<number, NotFound>>();
  });

  /**
   * The worst arm-order trap, and the reason the async arm is declared first:
   * `() => Promise<void>` satisfies `() => void` under the void-return rule, so
   * a sync-first order accepts an async tee **silently**, drops the `await`, and
   * returns a `ResultChain` that settled before the tee ran.
   */
  it('inspect_withAnAsyncCallback_crossesToResultAsyncRatherThanBeingSwallowed', () => {
    const ra = from(okUser()).inspect(async () => {});

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<User, NotFound>>();
  });

  it('inspect_withAnAsyncCallback_actuallyAwaitsTheTee', async () => {
    const order: string[] = [];

    await from(okUser())
      .inspect(async () => {
        await Promise.resolve();
        order.push('tee');
      })
      .map(() => order.push('after'))
      .toResult();

    expect(order).toEqual(['tee', 'after']);
  });

  it('andThen_withAnAsyncCallback_crossesToResultAsync', async () => {
    const ra = from(okUser()).andThen(
      async (u): Promise<Result<number, Forbidden>> => coreOk(u.credit),
    );

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<number, NotFound | Forbidden>>();
    await expect(ra.toResult()).resolves.toEqual(coreOk(10));
  });
});

describe('ResultAsync terminals', () => {
  it('match_collapsesThroughTheOkBranch', async () => {
    await expect(asyncOk().match({ ok: (u) => u.credit, err: () => 0 })).resolves.toBe(
      10,
    );
  });

  it('match_collapsesThroughTheErrBranch', async () => {
    await expect(asyncErr().match({ ok: (u) => u.credit, err: () => 0 })).resolves.toBe(
      0,
    );
  });

  /**
   * §6.2 is explicit that §5.3's amendment must be carried **here**, not merely
   * delegated: a single naked `U` across both callbacks takes its first
   * inference candidate, so this call would fail to compile.
   */
  it('match_infersTheUnionWhenTheBranchesDiffer', async () => {
    const out = asyncOk().match({ ok: (u) => u.credit, err: () => 'anon' });

    expectTypeOf(out).toEqualTypeOf<Promise<number | string>>();
    await expect(out).resolves.toBe(10);
  });

  it('unwrapOr_returnsThePromiseLiftedValue', async () => {
    await expect(asyncOk().unwrapOr(user)).resolves.toEqual(user);
  });

  it('unwrapOr_returnsTheFallbackOnAnErr', async () => {
    await expect(asyncErr().unwrapOr(user)).resolves.toEqual(user);
  });

  it('unwrapOrElse_computesTheFallbackFromTheError', async () => {
    await expect(
      asyncErr().unwrapOrElse((e) => ({ credit: e.id.length })),
    ).resolves.toEqual({ credit: 2 });
  });

  it('unwrapOrThrow_resolvesTheValueOfAnOk', async () => {
    await expect(asyncOk().unwrapOrThrow()).resolves.toEqual(user);
  });

  /**
   * Rejects rather than throwing synchronously — the only option that survives
   * `await`.
   *
   * Binding the promise *is* the synchronous-throw assertion: were it to throw
   * rather than reject, this line would throw and the test would fail. Written
   * this way rather than as `expect(() => …).not.toThrow()` because that form
   * leaves the rejection unhandled, which vitest reports as an unhandled error
   * and exits non-zero on — a red suite whose every assertion passed.
   */
  it('unwrapOrThrow_rejectsOnAnErrRatherThanThrowingSynchronously', async () => {
    const pending = asyncErr().unwrapOrThrow();

    await expect(pending).rejects.toThrow(Error);
  });

  it('unwrapOrThrow_rejectsWithTheOriginalErrorInCause', async () => {
    await expect(asyncErr().unwrapOrThrow()).rejects.toMatchObject({
      cause: notFound,
    });
  });

  it('toNullable_resolvesTheValueOfAnOk', async () => {
    await expect(asyncOk().toNullable()).resolves.toEqual(user);
  });

  it('toNullable_resolvesNullOnAnErr', async () => {
    await expect(asyncErr().toNullable()).resolves.toBeNull();
  });

  /**
   * **Terminal handlers stay synchronous** — only the *return* is lifted. A
   * deliberate departure from v1, whose `AsyncResultPipeline.match` took
   * `Awaitable<U>` handlers. Async work belongs upstream in `.andThen()`.
   */
  it('unwrapOrElse_takesASyncHandlerNotAnAwaitableOne', () => {
    expectTypeOf(asyncOk().unwrapOrElse)
      .parameter(0)
      .toEqualTypeOf<(error: NotFound) => User>();
  });

  it('unwrapOr_takesAPlainValueNotAPromisedOne', () => {
    expectTypeOf(asyncOk().unwrapOr).parameter(0).toEqualTypeOf<User>();
  });
});

describe('ResultAsync departures from ResultChain', () => {
  /**
   * **No `isOk` / `isErr`** (§6.2). The "lifted" rule stops at the guards on a
   * principle: a *value-producing* terminal is useful lifted; a *non-narrowing
   * boolean guard* is not, because the only thing it would buy — narrowing —
   * needs the plain union anyway. `if (await ra.isOk())` awaits twice and still
   * cannot reach `.value`; `const r = await ra; if (isOk(r))` narrows properly
   * and is shorter. Omitting them also kills the always-truthy `if (ra.isOk())`
   * footgun.
   */
  it('exposes_noIsOkOrIsErr', () => {
    const ra = asyncOk();

    // @ts-expect-error — no isOk on ResultAsync (§6.2); await, then narrow.
    expect(() => ra.isOk()).toThrow();
    // @ts-expect-error — no isErr on ResultAsync (§6.2); await, then narrow.
    expect(() => ra.isErr()).toThrow();
  });

  it('exposes_noIsOkOrIsErrAtRuntimeEither', () => {
    const ra = asyncOk() as unknown as Record<string, unknown>;

    expect(ra.isOk).toBeUndefined();
    expect(ra.isErr).toBeUndefined();
  });

  it('toJSON_throwsATypeError', () => {
    expect(() => asyncOk().toJSON()).toThrow(TypeError);
  });

  /**
   * The net cannot be lossless here — `JSON.stringify` is synchronous and the
   * value isn't available yet, so the accident is lossy whether `toJSON` returns
   * a Promise (serializes `{}`) or is omitted (also `{}`). The only choice is
   * silent vs. loud; ADR 0008 §6 fixed this project's stance.
   */
  it('toJSON_messageTellsTheUserToAwaitFirst', () => {
    expect(() => asyncOk().toJSON()).toThrow(/await it first/i);
  });

  it('jsonStringify_onAnInFlightResultAsync_throwsRatherThanEmittingEmptyObject', () => {
    expect(() => JSON.stringify(asyncOk())).toThrow(TypeError);
  });

  it('jsonStringify_afterAwaiting_isTheDocumentedPath', async () => {
    expect(JSON.stringify(await asyncOk())).toBe(
      '{"ok":true,"value":{"credit":10}}',
    );
  });
});

describe('the /fluent async constructors (§6.3 as amended, §10.5)', () => {
  it('fromPromise_returnsAResultAsync', async () => {
    const ra = fromPromise(Promise.resolve(user), () => notFound);

    expectTypeOf(ra).toEqualTypeOf<ResultAsync<User, NotFound>>();
    await expect(ra.toResult()).resolves.toEqual(coreOk(user));
  });

  it('fromPromise_catchesARejectionIntoTheErrChannel', async () => {
    const ra = fromPromise(Promise.reject(new Error('boom')), () => notFound);

    await expect(ra.toResult()).resolves.toEqual(coreErr(notFound));
  });

  it('fromPromise_isChainableWithoutLeavingFluentLand', async () => {
    const credit = await fromPromise(Promise.resolve(user), () => notFound)
      .map((u) => u.credit)
      .unwrapOr(0);

    expect(credit).toBe(10);
  });

  it('fromThrowableAsync_returnsAReusableWrapperOfResultAsync', async () => {
    const load = fromThrowableAsync(async (id: string) => ({ id }), () => notFound);

    await expect(load('u1').toResult()).resolves.toEqual(coreOk({ id: 'u1' }));
    await expect(load('u2').toResult()).resolves.toEqual(coreOk({ id: 'u2' }));
  });

  it('fromThrowableAsync_catchesARejectionIntoTheErrChannel', async () => {
    const load = fromThrowableAsync(async () => {
      throw new Error('boom');
    }, () => notFound);

    await expect(load().toResult()).resolves.toEqual(coreErr(notFound));
  });

  /**
   * §10.5's argument in one test: `ResultAsync.from` lifts a promise that is
   * *already* a union, `fromPromise` catches a rejection off a raw
   * `Promise<T>`. Neither substitutes for the other, which is why omitting
   * `fromPromise` from `/fluent` left a user entering from a throwing promise no
   * choice but to import from root.
   */
  it('fromPromise_andResultAsyncFrom_takeDifferentInputsAndAreNotInterchangeable', () => {
    expectTypeOf(fromPromise<User, NotFound>)
      .parameter(0)
      .toEqualTypeOf<Promise<User>>();

    expectTypeOf(ResultAsync.from<User, NotFound>)
      .parameter(0)
      .toEqualTypeOf<Promise<Result<User, NotFound>>>();
  });
});
