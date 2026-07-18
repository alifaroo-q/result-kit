import { runInNewContext } from 'node:vm';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  andThen,
  err,
  inspect,
  inspectErr,
  map,
  mapErr,
  ok,
  orElse,
} from '../../src/index';
import type { Result } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * The three arms of each transform are an *overload resolution* contract, and a
 * mis-ordered overload set fails silently in exactly one direction: it picks a
 * more-eager arm and hands back `Result<Promise<U>, E>` where the caller wanted
 * `Promise<Result<U, E>>`. Both typecheck at the definition. Only an assertion
 * on the resolved return type can tell them apart, and only tsc runs it.
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
const forbidden: Forbidden = { type: 'forbidden' };

/**
 * Real stubs, not `declare`s — the return annotation is what every type
 * assertion reads, but these also execute under vitest.
 */
const okUser = (): Result<User, NotFound> => ok({ credit: 10 });
const errUser = (): Result<User, NotFound> => err(notFound);

/** The §5.2 acceptance case: a `Promise<Result>`-returning source. */
const fetchUser = async (_id: string): Promise<Result<User, NotFound>> =>
  ok({ credit: 10 });
const validate = (user: User): Result<User, Forbidden> => ok(user);
const validateAsync = async (user: User): Promise<Result<User, Forbidden>> =>
  ok(user);

const loadOrder = (_user: User): Result<Order, Timeout> => ok({ total: 5 });
const recover = (_error: NotFound): Result<Order, Forbidden> => ok({ total: 0 });
const recoverAsync = async (_error: NotFound): Promise<Result<Order, Forbidden>> =>
  ok({ total: 0 });

/**
 * The #36 defect shape: a callback whose return type is a *union* of a value and
 * a promise of it. `cache.get(id) ?? fetchName(id)` is the ordinary encoding.
 *
 * It matched the sync arm with `U` = the whole union, so tsc promised a settled
 * `Result` while the runtime — whose `isThenable` is strictly broader than
 * TypeScript's notion of awaitable — took the async path and returned a
 * `Promise`. `.ok` read `undefined`, so the err branch was silently taken with
 * `.error === undefined`. Data-dependent: correct on a cache hit, wrong on a
 * miss.
 *
 * `andThen` / `orElse` / `safeUnwrap` always rejected this union loudly, because
 * their sync arm demands a `Result`. These four now agree.
 */
const creditCache = new Map<string, number>();
const fetchCredit = async (_id: string): Promise<number> => 10;
/** Returns `number | Promise<number>` — neither purely sync nor purely async. */
const lookupCredit = (id: string) => creditCache.get(id) ?? fetchCredit(id);

describe('the mixed value-or-promise callback (#36)', () => {
  it('is rejected by map, rather than typed sync and run async', () => {
    // @ts-expect-error - a `U | Promise<U>` callback must not match the sync arm
    map(okUser(), (u) => lookupCredit(String(u.credit)));
  });

  it('is rejected by mapErr', () => {
    // @ts-expect-error - see above
    mapErr(okUser(), (e) => lookupCredit(e.id));
  });

  it('is rejected by inspect, which the void-return rule would otherwise hide', () => {
    // @ts-expect-error - see above
    inspect(okUser(), (u) => lookupCredit(String(u.credit)));
  });

  it('is rejected by inspectErr', () => {
    // @ts-expect-error - see above
    inspectErr(okUser(), (e) => lookupCredit(e.id));
  });

  it('rejects a purely-async callback too, since a settled input cannot go async', () => {
    // @ts-expect-error - §10.9: the (Result + async callback) arm is gone
    map(okUser(), async (u) => lookupCredit(String(u.credit)));
  });

  it('accepts the same async work once the input is a promise', () => {
    expectTypeOf(
      map(Promise.resolve(okUser()), async (u) => u.credit),
    ).toEqualTypeOf<Promise<Result<number, NotFound>>>();
  });

  it('leaves an ordinary value-returning sync callback untouched', () => {
    // The guard must cost nothing here: no extra argument, same resolved type.
    expectTypeOf(inspect(okUser(), (u) => u.credit)).toEqualTypeOf<
      Result<User, NotFound>
    >();
  });
});

describe('map', () => {
  it('resolves each of the remaining arms to the right shape', () => {
    expectTypeOf(map(okUser(), (u) => u.credit)).toEqualTypeOf<
      Result<number, NotFound>
    >();

    // §10.9: a settled Result plus an async callback is now a compile error —
    // the arm could not keep its promise on the short-circuit branch.
    // @ts-expect-error - use map(Promise.resolve(r), fn) for async work
    map(okUser(), async (u) => u.credit);

    expectTypeOf(map(fetchUser('u1'), (u) => u.credit)).toEqualTypeOf<
      Promise<Result<number, NotFound>>
    >();
    expectTypeOf(
      map(fetchUser('u1'), async (u) => u.credit),
    ).toEqualTypeOf<Promise<Result<number, NotFound>>>();
  });

  it('maps the ok branch', () => {
    expect(map(okUser(), (u) => u.credit)).toEqual(ok(10));
  });

  it('passes the err branch through untouched, identity preserved', () => {
    const input = errUser();
    const fn = vi.fn((u: User) => u.credit);

    expect(map(input, fn)).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('awaits an async callback once the input is a promise', async () => {
    await expect(
      map(Promise.resolve(okUser()), async (u) => u.credit),
    ).resolves.toEqual(ok(10));
  });

  it('accepts a promise input', async () => {
    await expect(map(fetchUser('u1'), (u) => u.credit)).resolves.toEqual(ok(10));
  });
});

describe('mapErr', () => {
  it('resolves each of the remaining arms to the right shape', () => {
    expectTypeOf(mapErr(okUser(), (e) => e.id)).toEqualTypeOf<
      Result<User, string>
    >();
    // @ts-expect-error - §10.9: a settled input cannot produce an async output
    mapErr(okUser(), async (e) => e.id);
    expectTypeOf(
      mapErr(Promise.resolve(okUser()), async (e) => e.id),
    ).toEqualTypeOf<Promise<Result<User, string>>>();
    expectTypeOf(mapErr(fetchUser('u1'), (e) => e.id)).toEqualTypeOf<
      Promise<Result<User, string>>
    >();
  });

  it('maps the err branch', () => {
    expect(mapErr(errUser(), (e) => e.id)).toEqual(err('u1'));
  });

  it('passes the ok branch through untouched, identity preserved', () => {
    const input = okUser();
    const fn = vi.fn((e: NotFound) => e.id);

    expect(mapErr(input, fn)).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('awaits an async callback once the input is a promise', async () => {
    await expect(
      mapErr(Promise.resolve(errUser()), async (e) => e.id),
    ).resolves.toEqual(err('u1'));
  });
});

describe('andThen', () => {
  it('accumulates the error union E | F', () => {
    expectTypeOf(andThen(okUser(), validate)).toEqualTypeOf<
      Result<User, NotFound | Forbidden>
    >();
    expectTypeOf(andThen(okUser(), loadOrder)).toEqualTypeOf<
      Result<Order, NotFound | Timeout>
    >();
  });

  it('typechecks and infers against a Promise<Result> source (§5.2 acceptance)', () => {
    expectTypeOf(andThen(fetchUser('u1'), validate)).toEqualTypeOf<
      Promise<Result<User, NotFound | Forbidden>>
    >();
    // @ts-expect-error - §10.9: a settled input cannot produce an async output
    andThen(okUser(), validateAsync);
    expectTypeOf(
      andThen(Promise.resolve(okUser()), validateAsync),
    ).toEqualTypeOf<Promise<Result<User, NotFound | Forbidden>>>();
    expectTypeOf(andThen(fetchUser('u1'), validateAsync)).toEqualTypeOf<
      Promise<Result<User, NotFound | Forbidden>>
    >();
  });

  it('chains the ok branch', () => {
    expect(andThen(okUser(), loadOrder)).toEqual(ok({ total: 5 }));
  });

  it('short-circuits the err branch, identity preserved', () => {
    const input = errUser();
    const fn = vi.fn(loadOrder);

    expect(andThen(input, fn)).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('propagates the callback err', () => {
    expect(andThen(okUser(), (): Result<Order, Timeout> => err({ type: 'timeout', ms: 5 })))
      .toEqual(err({ type: 'timeout', ms: 5 }));
  });

  it('accepts a promise input with a sync callback', async () => {
    await expect(andThen(fetchUser('u1'), loadOrder)).resolves.toEqual(
      ok({ total: 5 }),
    );
  });
});

describe('orElse', () => {
  it('accumulates the success union T | U', () => {
    expectTypeOf(orElse(okUser(), recover)).toEqualTypeOf<
      Result<User | Order, Forbidden>
    >();
    // @ts-expect-error - §10.9: a settled input cannot produce an async output
    orElse(okUser(), recoverAsync);
    expectTypeOf(
      orElse(Promise.resolve(okUser()), recoverAsync),
    ).toEqualTypeOf<Promise<Result<User | Order, Forbidden>>>();
    expectTypeOf(orElse(fetchUser('u1'), recover)).toEqualTypeOf<
      Promise<Result<User | Order, Forbidden>>
    >();
  });

  it('recovers the err branch', () => {
    expect(orElse(errUser(), recover)).toEqual(ok({ total: 0 }));
  });

  it('passes the ok branch through untouched, identity preserved', () => {
    const input = okUser();
    const fn = vi.fn(recover);

    expect(orElse(input, fn)).toBe(input);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('inspect', () => {
  it('resolves each of the remaining arms to the right shape', () => {
    expectTypeOf(inspect(okUser(), () => {})).toEqualTypeOf<
      Result<User, NotFound>
    >();
    // @ts-expect-error - §10.9: a settled input cannot produce an async output
    inspect(okUser(), async () => {});
    expectTypeOf(
      inspect(Promise.resolve(okUser()), async () => {}),
    ).toEqualTypeOf<Promise<Result<User, NotFound>>>();
    expectTypeOf(inspect(fetchUser('u1'), () => {})).toEqualTypeOf<
      Promise<Result<User, NotFound>>
    >();
  });

  it('returns the result unchanged and fires only on the ok branch', () => {
    const okInput = okUser();
    const errInput = errUser();
    const probe = vi.fn();

    expect(inspect(okInput, probe)).toBe(okInput);
    expect(probe).toHaveBeenCalledExactlyOnceWith({ credit: 10 });

    probe.mockClear();
    expect(inspect(errInput, probe)).toBe(errInput);
    expect(probe).not.toHaveBeenCalled();
  });

  it('awaits an async tee and still returns the result unchanged', async () => {
    const input = okUser();
    const probe = vi.fn(async () => {});

    await expect(inspect(Promise.resolve(input), probe)).resolves.toBe(input);
    expect(probe).toHaveBeenCalledOnce();
  });
});

describe('inspectErr', () => {
  it('resolves each of the remaining arms to the right shape', () => {
    expectTypeOf(inspectErr(okUser(), () => {})).toEqualTypeOf<
      Result<User, NotFound>
    >();
    // @ts-expect-error - §10.9: a settled input cannot produce an async output
    inspectErr(okUser(), async () => {});
    expectTypeOf(
      inspectErr(Promise.resolve(okUser()), async () => {}),
    ).toEqualTypeOf<Promise<Result<User, NotFound>>>();
    expectTypeOf(inspectErr(fetchUser('u1'), () => {})).toEqualTypeOf<
      Promise<Result<User, NotFound>>
    >();
  });

  it('returns the result unchanged and fires only on the err branch', () => {
    const okInput = okUser();
    const errInput = errUser();
    const probe = vi.fn();

    expect(inspectErr(errInput, probe)).toBe(errInput);
    expect(probe).toHaveBeenCalledExactlyOnceWith(notFound);

    probe.mockClear();
    expect(inspectErr(okInput, probe)).toBe(okInput);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('PromiseLike inputs (§10.6)', () => {
  /** A thenable that is NOT a Promise — the shape `ResultAsync` will have (#28). */
  const thenable: PromiseLike<Result<User, NotFound>> = {
    then: (onfulfilled) =>
      Promise.resolve(ok({ credit: 10 }) as Result<User, NotFound>).then(
        onfulfilled,
      ),
  };

  it('accepts a non-Promise thenable and normalizes to a real Promise', async () => {
    const mapped = map(thenable, (u) => u.credit);

    expectTypeOf(mapped).toEqualTypeOf<Promise<Result<number, NotFound>>>();
    expect(mapped).toBeInstanceOf(Promise);
    await expect(mapped).resolves.toEqual(ok(10));
  });

  it('threads a thenable through andThen with union accumulation intact', async () => {
    expectTypeOf(andThen(thenable, validate)).toEqualTypeOf<
      Promise<Result<User, NotFound | Forbidden>>
    >();
    await expect(andThen(thenable, validate)).resolves.toEqual(
      ok({ credit: 10 }),
    );
  });

  /**
   * The reason the detection is `typeof x?.then`, not `instanceof Promise`
   * (§10.6). This promise is native and fully typed as `Promise<Result>` — it
   * is only *foreign*, born in another realm, which `instanceof` cannot see
   * past. An `instanceof`-based transform accepts it, takes the sync path,
   * reads `.ok` as undefined, and returns the raw promise typed as a `Result`:
   * a wrong value with a confident type and no throw.
   */
  it('handles a native promise from another realm (cross-realm regression)', async () => {
    const foreign = runInNewContext(
      'Promise.resolve({ ok: true, value: { credit: 10 } })',
    ) as Promise<Result<User, NotFound>>;

    // The preconditions that make this test meaningful: a real, awaitable
    // promise that `instanceof` nonetheless disowns. If the `instanceof`
    // assertion ever starts failing, the check it guards was fine all along and
    // this test is moot. (`instanceof Object` is *also* false here — the
    // constructor is realm-bound too, which is the whole phenomenon.)
    expect(foreign).not.toBeInstanceOf(Promise);
    expect(typeof foreign.then).toBe('function');
    await expect(foreign).resolves.toEqual(ok({ credit: 10 }));

    const mapped = map(foreign, (u) => u.credit);

    expect(mapped).toBeInstanceOf(Promise);
    await expect(mapped).resolves.toEqual(ok(10));
  });

  it('accumulates unions through a foreign promise, err branch included', async () => {
    const foreignErr = runInNewContext(
      "Promise.resolve({ ok: false, error: { type: 'not_found', id: 'u1' } })",
    ) as Promise<Result<User, NotFound>>;

    await expect(andThen(foreignErr, validate)).resolves.toEqual(err(notFound));
    await expect(mapErr(foreignErr, (e) => e.id)).resolves.toEqual(err('u1'));
  });
});

describe('the renamed and absent surface', () => {
  it('exports no mapError and no xAsync doubles', async () => {
    const surface = await import('../../src/index');

    expect(surface).not.toHaveProperty('mapError');
    for (const name of [
      'mapAsync',
      'mapErrAsync',
      'andThenAsync',
      'orElseAsync',
      'inspectAsync',
      'inspectErrAsync',
    ]) {
      expect(surface).not.toHaveProperty(name);
    }
  });

  it('rejects a non-Result first argument', () => {
    // @ts-expect-error — data-first, and the first argument is the Result.
    map({ credit: 10 }, (u: User) => u.credit);

    // @ts-expect-error — no data-last / curried variant exists.
    map((u: User) => u.credit)(okUser());
  });
});

describe('the err-union propagates unchanged (no collapse)', () => {
  it('keeps a pre-existing union through map', () => {
    const input = ok({ credit: 10 }) as Result<User, NotFound | Forbidden>;

    expectTypeOf(map(input, (u) => u.credit)).toEqualTypeOf<
      Result<number, NotFound | Forbidden>
    >();
  });

  it('accumulates onto a pre-existing union through andThen', () => {
    const input = ok({ credit: 10 }) as Result<User, NotFound | Forbidden>;

    expectTypeOf(andThen(input, loadOrder)).toEqualTypeOf<
      Result<Order, NotFound | Forbidden | Timeout>
    >();
  });
});

it('leaves errors thrown by a callback uncaught', () => {
  const boom = new Error('boom');

  expect(() =>
    map(okUser(), () => {
      throw boom;
    }),
  ).toThrow(boom);
});
