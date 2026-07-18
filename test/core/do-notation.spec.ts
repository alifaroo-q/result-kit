import { runInNewContext } from 'node:vm';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { err, ok, safeTry, safeUnwrap } from '../../src/index';
import type { Ok, Result } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`. That matters more here than
 * anywhere else in the suite: the inference traps these pin produce **no runtime
 * error at all**. A collapsed error union is invisible until a consumer handles
 * an error that the types said could not occur. tsc is the only thing watching.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}
interface Forbidden {
  readonly type: 'forbidden';
}
interface Timeout {
  readonly type: 'timeout';
  readonly ms: number;
}

interface User {
  readonly credit: number;
}
interface Order {
  readonly total: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };

/**
 * Real stubs, not `declare`s. The return annotation is what every type
 * assertion below reads, but these also execute — an ambient declaration would
 * typecheck and then throw ReferenceError the moment vitest ran the body.
 */
const findUser = (_id: string): Result<User, NotFound> => ok({ credit: 10 });
const loadOrder = (_user: User): Result<Order, Forbidden> => ok({ total: 5 });
const findUserAsync = async (_id: string): Promise<Result<User, NotFound>> =>
  ok({ credit: 10 });
const loadOrderAsync = async (_user: User): Promise<Result<Order, Timeout>> =>
  ok({ total: 5 });

class Lookalike1 extends Error {}
class Lookalike2 extends Error {}
const lookalike1 = (): Result<number, Lookalike1> => ok(1);
const lookalike2 = (): Result<number, Lookalike2> => ok(2);

const wide1 = (): Result<number, { type: string; message: string }> => ok(1);
const wide2 = (): Result<number, { type: string; code: number }> => ok(2);

/** A plain error hierarchy — NOT mutually assignable, unlike the lookalikes. */
class HttpError extends Error {
  readonly status = 500;
}
class NotFoundError extends HttpError {
  readonly path = '/x';
}
const httpErr = (): Result<number, HttpError> => ok(1);
const notFoundErr = (): Result<number, NotFoundError> => ok(2);

/** The same relationship, expressed structurally rather than by `extends`. */
const withId = (): Result<number, { type: 'x'; message: string; id: string }> => ok(1);
const withoutId = (): Result<number, { type: 'x'; message: string }> => ok(2);

describe('safeTry — sync', () => {
  it('binds each unwrapped value and returns the explicit Ok', () => {
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(ok(2));
      const b = yield* safeUnwrap(ok(3));
      return ok(a * b);
    });

    expect(result).toEqual({ ok: true, value: 6 });
  });

  it('short-circuits on the first Err — later steps never run', () => {
    const laterStep = vi.fn(() => ok(99));

    const result = safeTry(function* () {
      const a = yield* safeUnwrap(err(notFound) as Result<number, NotFound>);
      const b = yield* safeUnwrap(laterStep());
      return ok(a + b);
    });

    expect(result).toEqual({ ok: false, error: notFound });
    expect(laterStep).not.toHaveBeenCalled();
  });

  it('returns an early explicit err directly', () => {
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(ok(1));
      if (a === 1) return err(notFound);
      return ok(a);
    });

    expect(result).toEqual({ ok: false, error: notFound });
  });
});

describe('safeTry — async', () => {
  it('unwraps a Promise<Result> with zero await inside the body', async () => {
    const result = await safeTry(async function* () {
      const a = yield* safeUnwrap(Promise.resolve(ok(2)));
      const b = yield* safeUnwrap(Promise.resolve(ok(3)));
      return ok(a * b);
    });

    expect(result).toEqual({ ok: true, value: 6 });
  });

  it('short-circuits on the first Err — later async steps never run', async () => {
    const laterStep = vi.fn(async () => ok(99));

    const result = await safeTry(async function* () {
      const a = yield* safeUnwrap(
        Promise.resolve(err(notFound) as Result<number, NotFound>),
      );
      const b = yield* safeUnwrap(laterStep());
      return ok(a + b);
    });

    expect(result).toEqual({ ok: false, error: notFound });
    expect(laterStep).not.toHaveBeenCalled();
  });
});

describe('safeTry — type contract (enforced by pnpm check)', () => {
  it('binds successive yield*s to distinct types', () => {
    safeTry(function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      const order = yield* safeUnwrap(loadOrder(user));

      // The point of yield* delegation: not one monomorphic User | Order.
      expectTypeOf(user).toEqualTypeOf<User>();
      expectTypeOf(order).toEqualTypeOf<Order>();

      return ok(user.credit + order.total);
    });
  });

  it('accumulates the error channel as a union', () => {
    const result = safeTry(function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      const order = yield* safeUnwrap(loadOrder(user));
      return ok(user.credit + order.total);
    });

    expectTypeOf(result).toEqualTypeOf<Result<number, NotFound | Forbidden>>();
  });

  it("joins an explicit return err's type into the same union", () => {
    const result = safeTry(function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      if (user.credit < 0) return err<Timeout>({ type: 'timeout', ms: 0 });
      return ok(user.credit);
    });

    expectTypeOf(result).toEqualTypeOf<Result<number, NotFound | Timeout>>();
  });

  it('returns Promise<Result> for an async generator, via the same name', () => {
    const result = safeTry(async function* () {
      const user = yield* safeUnwrap(findUserAsync('u1'));
      const order = yield* safeUnwrap(loadOrderAsync(user));

      expectTypeOf(user).toEqualTypeOf<User>();
      expectTypeOf(order).toEqualTypeOf<Order>();

      return ok(order.total);
    });

    expectTypeOf(result).toEqualTypeOf<Promise<Result<number, NotFound | Timeout>>>();
  });

  it('accumulates across a body mixing sync and async unwraps', () => {
    const result = safeTry(async function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      const order = yield* safeUnwrap(loadOrderAsync(user));
      return ok(user.credit + order.total);
    });

    expectTypeOf(result).toEqualTypeOf<Promise<Result<number, NotFound | Timeout>>>();
  });

  it('accumulates through a nested safeTry', () => {
    const result = safeTry(function* () {
      const credit = yield* safeUnwrap(
        safeTry(function* () {
          const user = yield* safeUnwrap(findUser('u1'));
          return ok(user.credit);
        }),
      );
      const order = yield* safeUnwrap(loadOrder({ credit }));
      return ok(credit + order.total);
    });

    expectTypeOf(result).toEqualTypeOf<Result<number, NotFound | Forbidden>>();
  });

  it('does not auto-wrap a bare returned value', () => {
    // @ts-expect-error — a bare number is not a Result; safeTry will not wrap it.
    safeTry(function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      return user.credit;
    });
  });

  it('does not coerce errors — a narrower annotation is rejected', () => {
    // @ts-expect-error — Forbidden alone cannot hold the NotFound | Forbidden
    // channel. Errors union; they never convert. There is no From trait.
    const _narrowed: Result<number, Forbidden> = safeTry(function* () {
      const user = yield* safeUnwrap(findUser('u1'));
      const order = yield* safeUnwrap(loadOrder(user));
      return ok(user.credit + order.total);
    });
  });
});

describe('safeUnwrap — driven by hand, outside safeTry', () => {
  // safeTry never resumes a short-circuited generator, so this branch is
  // unreachable through the public flow. It is still the adapter's only
  // hand-written invariant, and the alternative to throwing is silently
  // returning `undefined` as T — so it is worth pinning.
  it('throws rather than resuming a short-circuited sync generator', () => {
    const gen = safeUnwrap(err(notFound) as Result<number, NotFound>);

    expect(gen.next()).toEqual({ done: false, value: { ok: false, error: notFound } });
    expect(() => gen.next()).toThrow(/resumed after short-circuit/);
  });

  it('throws rather than resuming a short-circuited async generator', async () => {
    const gen = safeUnwrap(
      Promise.resolve(err(notFound) as Result<number, NotFound>),
    );

    await expect(gen.next()).resolves.toEqual({
      done: false,
      value: { ok: false, error: notFound },
    });
    await expect(gen.next()).rejects.toThrow(/resumed after short-circuit/);
  });

  it('returns the unwrapped value without yielding, for an Ok', () => {
    const gen = safeUnwrap(ok(42) as Result<number, NotFound>);

    expect(gen.next()).toEqual({ done: true, value: 42 });
  });
});

describe('safeTry — the never defaults (each trap is invisible at runtime)', () => {
  // Without `T = never, E = never` on the overloads, E has no inference
  // candidate in an ok-only body and falls back to `unknown` — which then
  // absorbs the whole accumulated union. These two pin that.
  it('gives a body with no yields an uninhabited error channel', () => {
    const result = safeTry(function* () {
      return ok(1);
    });

    expectTypeOf(result).toEqualTypeOf<Result<number, never>>();
  });

  it('gives an err-only body an uninhabited success channel', () => {
    const result = safeTry(function* () {
      return err<Forbidden>({ type: 'forbidden' });
    });

    expectTypeOf(result).toEqualTypeOf<Result<never, Forbidden>>();
  });
});

describe('the no-brand invariant is untouched (§2 / §2.1)', () => {
  it('has no Symbol.iterator on the data', () => {
    expect(ok(1)[Symbol.iterator as unknown as keyof object]).toBeUndefined();
    expect(err(notFound)[Symbol.iterator as unknown as keyof object]).toBeUndefined();
    expect(Object.keys(ok(1))).toEqual(['ok', 'value']);
  });

  it('keeps Ok<T> to exactly two fields', () => {
    expectTypeOf<keyof Ok<number>>().toEqualTypeOf<'ok' | 'value'>();
  });

  it('puts iterability in the adapter instead', () => {
    expect(safeUnwrap(ok(1))[Symbol.iterator]).toBeTypeOf('function');
  });

  it('requires the adapter — the union itself is not iterable', () => {
    const withoutAdapter = () =>
      safeTry(function* () {
        // @ts-expect-error — a plain Result has no Symbol.iterator, by design.
        const user = yield* findUser('u1');
        return ok(user);
      });

    // Asserted twice over, because the two checks catch different audiences:
    // the @ts-expect-error above proves tsc rejects it, and this proves the
    // runtime agrees rather than silently limping on.
    expect(withoutAdapter).toThrow(/is not iterable/);
  });

  it('flows a JSON-revived result through safeTry unchanged', () => {
    const revived = JSON.parse(JSON.stringify(ok(21))) as Result<number, NotFound>;

    const result = safeTry(function* () {
      const n = yield* safeUnwrap(revived);
      return ok(n * 2);
    });

    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe('the known limitation, pinned', () => {
  /**
   * TypeScript **subtype-reduces** a generator's yield type across `yield*`
   * delegations: any constituent that is a subtype of another is dropped. So an
   * error type gets swallowed whenever another yielded error is a supertype of
   * it — mutual assignability is only the special case where each is a subtype
   * of the other.
   *
   * This happens in the generator expression itself, upstream of safeTry, so no
   * signature can recover it. See microsoft/TypeScript#57625 (open, unmilestoned
   * since March 2024).
   *
   * It is lossy but never unsound — the survivor is always a supertype of what
   * was dropped, so the channel widens and never lies. And no §3 TypedError can
   * hit it: distinct literal `type` discriminants make the variants mutually
   * non-assignable, so neither is a subtype of the other and the union survives.
   *
   * Pinned, not endorsed. If a future TypeScript fixes this, these fail and tell
   * us to drop the caveat from the docs.
   */
  it('collapses structurally identical error types (upstream TS limitation)', () => {
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(lookalike1());
      const b = yield* safeUnwrap(lookalike2());
      return ok(a + b);
    });

    expectTypeOf(result).toEqualTypeOf<Result<number, Lookalike1>>();

    // For this case specifically, nothing is lost: TypeScript already considers
    // the two one type, so the assignment below is legal with or without
    // safeTry. That is NOT true of the subtype case in the next test.
    const _structural: Lookalike1 = new Lookalike2();
  });

  it('widens to the supertype when one error extends another', () => {
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(notFoundErr());
      const b = yield* safeUnwrap(httpErr());
      return ok(a + b);
    });

    // NotFoundError is swallowed. Unlike the lookalike case above, these are
    // NOT mutually assignable — so the channel here really is less precise than
    // the language, and `error.path` is unreachable without a cast.
    expectTypeOf(result).toEqualTypeOf<Result<number, HttpError>>();
  });

  it('drops the wider shape when one error structurally extends another', () => {
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(withId());
      const b = yield* safeUnwrap(withoutId());
      return ok(a + b);
    });

    // Same rule, structurally: `id` vanishes from the channel.
    expectTypeOf(result).toEqualTypeOf<Result<number, { type: 'x'; message: string }>>();
  });

  it('accumulates whenever the errors are distinguishable at all', () => {
    // A widened `type: string` is not automatically fatal — wide1/wide2 differ
    // elsewhere in the shape, stay mutually non-assignable, and survive.
    const result = safeTry(function* () {
      const a = yield* safeUnwrap(wide1());
      const b = yield* safeUnwrap(wide2());
      return ok(a + b);
    });

    expectTypeOf(result).toEqualTypeOf<
      Result<number, { type: string; message: string } | { type: string; code: number }>
    >();
  });
});

/**
 * The §10.6 cross-realm hole, mirrored from `test/core/transforms.spec.ts`.
 *
 * These are regressions, not hypotheticals — both functions shipped with
 * `instanceof Promise` and both produced a wrong value with a confident type
 * and no throw. `safeUnwrap`'s was known debt, raised on #28. `safeTry`'s was
 * found while fixing it: §10.6's debt note named only `safeUnwrap`.
 */
describe('the cross-realm hole (§10.6)', () => {
  /**
   * The preconditions that make every test below meaningful: a real, awaitable
   * promise that `instanceof` nonetheless disowns. If this ever starts failing,
   * the check it guards was fine all along and these tests are moot.
   */
  it('foreignPromise_isAwaitableButFailsInstanceof', async () => {
    const foreign = runInNewContext(
      'Promise.resolve({ ok: true, value: 42 })',
    ) as Promise<Result<number, NotFound>>;

    expect(foreign).not.toBeInstanceOf(Promise);
    expect(typeof foreign.then).toBe('function');
    await expect(foreign).resolves.toEqual(ok(42));
  });

  it('safeUnwrap_foreignPromise_unwrapsTheValueRatherThanYieldingAMalformedErr', async () => {
    const foreign = runInNewContext(
      'Promise.resolve({ ok: true, value: 42 })',
    ) as Promise<Result<number, NotFound>>;

    const result = await safeTry(async function* () {
      const value = yield* safeUnwrap(foreign);
      return ok(value * 2);
    });

    // Under `instanceof`: the sync branch read `.ok` off a promise as
    // `undefined`, took the err arm, and yielded the raw promise as an `Err`.
    expect(result).toEqual(ok(84));
  });

  it('safeUnwrap_foreignPromiseOfErr_shortCircuitsTheBlock', async () => {
    const foreign = runInNewContext(
      "Promise.resolve({ ok: false, error: { type: 'not_found', id: 'u1' } })",
    ) as Promise<Result<number, NotFound>>;

    const result = await safeTry(async function* () {
      const value = yield* safeUnwrap(foreign);
      return ok(value * 2);
    });

    expect(result).toEqual(err({ type: 'not_found', id: 'u1' }));
  });

  it('safeUnwrap_acceptsAPromiseLikeThatIsNotAPromise', async () => {
    const thenable: PromiseLike<Result<number, NotFound>> = {
      then: (onFulfilled) => Promise.resolve(ok(42)).then(onFulfilled),
    };

    const result = await safeTry(async function* () {
      const value = yield* safeUnwrap(thenable);
      return ok(value * 2);
    });

    expect(result).toEqual(ok(84));
  });

  /**
   * `safeTry`'s own `.next()`. `body` is the *caller's* generator, so an
   * `async function*` born in another realm hands back a foreign promise —
   * which `instanceof` disowned, sending `safeTry` down the sync branch to read
   * `.value` off a promise and return `undefined` where its signature promises
   * `Promise<Result<T, E>>`.
   */
  it('safeTry_foreignAsyncGenerator_returnsThePromisedResultRatherThanUndefined', async () => {
    const foreignBody = runInNewContext(
      '(async function* () { return { ok: true, value: 42 }; })',
    ) as () => AsyncGenerator<never, Result<number, NotFound>>;

    const pending = safeTry(foreignBody);

    expect(pending).toBeDefined();
    await expect(pending).resolves.toEqual(ok(42));
  });

  it('safeTry_foreignAsyncGenerator_normalizesToANativePromise', async () => {
    const foreignBody = runInNewContext(
      '(async function* () { return { ok: true, value: 42 }; })',
    ) as () => AsyncGenerator<never, Result<number, NotFound>>;

    // `Promise.resolve` at the boundary: accept any thenable, hand back the
    // concrete thing consumers expect.
    expect(safeTry(foreignBody)).toBeInstanceOf(Promise);
  });

  it('safeTry_nativeSyncGenerator_isUnaffectedByTheThenableCheck', () => {
    const result = safeTry(function* () {
      return ok(42);
    });

    expect(result).toEqual(ok(42));
  });
});

/**
 * §10.9. The short-circuit suspends the body at its first `yield` and never
 * resumes it — so the generator was left parked and its `finally` blocks never
 * ran. Cleanup ran on the success path (the generator completes normally) and
 * was skipped on the error path, which is the path cleanup exists for.
 */
describe('safeTry releases the generator on short-circuit (#36 retro)', () => {
  it('runs a finally block when the body short-circuits', () => {
    const log: string[] = [];

    safeTry(function* () {
      try {
        const v = yield* safeUnwrap(err({ type: 'boom' } as const));
        return ok(v);
      } finally {
        log.push('cleaned');
      }
    });

    expect(log).toEqual(['cleaned']);
  });

  it('still runs a finally block when the body completes normally', () => {
    const log: string[] = [];

    safeTry(function* () {
      try {
        const v = yield* safeUnwrap(ok(1));
        return ok(v);
      } finally {
        log.push('cleaned');
      }
    });

    expect(log).toEqual(['cleaned']);
  });

  it('releases a held resource rather than leaking it', () => {
    let open = 0;

    safeTry(function* () {
      open += 1;
      try {
        yield* safeUnwrap(err({ type: 'boom' } as const));
        return ok(1);
      } finally {
        open -= 1;
      }
    });

    expect(open).toBe(0);
  });

  it('waits for an async finally before settling, not merely scheduling it', async () => {
    // Discriminating probe: a synchronous `finally` body runs before the
    // microtask boundary, so it passes even without awaiting `.return()`. Only
    // cleanup that itself awaits proves the caller's promise waits for it.
    const log: string[] = [];

    await safeTry(async function* () {
      try {
        const v = yield* safeUnwrap(
          Promise.resolve(err({ type: 'boom' } as const)),
        );
        return ok(v);
      } finally {
        await Promise.resolve();
        log.push('cleaned');
      }
    });

    expect(log).toEqual(['cleaned']);
  });

  it('runs a finally block when an async body short-circuits', async () => {
    const log: string[] = [];

    await safeTry(async function* () {
      try {
        const v = yield* safeUnwrap(
          Promise.resolve(err({ type: 'boom' } as const)),
        );
        return ok(v);
      } finally {
        log.push('cleaned');
      }
    });

    expect(log).toEqual(['cleaned']);
  });

  it('returns the short-circuited Err unchanged', () => {
    const out = safeTry(function* () {
      try {
        const v = yield* safeUnwrap(err({ type: 'boom' } as const));
        return ok(v);
      } finally {
        /* cleanup must not alter the result */
      }
    });

    expect(out).toEqual(err({ type: 'boom' }));
  });
});

/**
 * §10.9. The *yield* channel spells its slot as a naked `Y` precisely so a
 * union of `Err`s survives inference (implementation note 1). The *return*
 * channel was spelled `Result<T, E>` — not naked — so two distinct
 * `return err(...)` exits gave `E` two candidates and the call failed to
 * resolve at all. ADR 0007 §6 explicitly blesses a deliberate early
 * `return err(...)`, and multiple of them is the ordinary shape.
 */
describe('safeTry accumulates the return channel too (#36 retro)', () => {
  it('resolves a body with two distinct return err types', () => {
    const out = safeTry(function* () {
      if (Math.random() > 0.5) return err<NotFound>(notFound);
      if (Math.random() > 0.9) return err<Forbidden>({ type: 'forbidden' });
      return ok(1);
    });

    expectTypeOf(out).toEqualTypeOf<Result<number, NotFound | Forbidden>>();
  });

  it('accumulates the yield and return channels into one union', () => {
    const out = safeTry(function* () {
      const v = yield* safeUnwrap(findUser('u1'));
      if (Math.random() > 0.5) return err<Timeout>({ type: 'timeout', ms: 1 });
      return ok(v.credit);
    });

    expectTypeOf(out).toEqualTypeOf<Result<number, NotFound | Timeout>>();
  });

  it('leaves the error channel never for a body that cannot fail', () => {
    const out = safeTry(function* () {
      return ok(1);
    });

    expectTypeOf(out).toEqualTypeOf<Result<number, never>>();
  });

  it('short-circuits on the first of several return err exits', () => {
    const out = safeTry(function* () {
      return err<NotFound>(notFound);
    });

    expect(out).toEqual(err(notFound));
  });
});
