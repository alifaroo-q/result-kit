import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  err,
  fromNullable,
  fromPredicate,
  fromPromise,
  fromThrowable,
  fromThrowableAsync,
  ok,
} from '../../src/index';
import type { Result } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * Two contracts here are type-level only and fail silently at runtime:
 * `fromNullable`'s `NonNullable` (a `Result<User | null, E>` behaves
 * identically until a consumer dereferences), and `fromPredicate`'s overload
 * ORDER — a boolean-first arm captures every type guard and drops the narrowing
 * to `S`, which typechecks and runs correctly. Only tsc separates them.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}
interface Invalid {
  readonly type: 'invalid';
}

interface User {
  readonly credit: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };
const invalid: Invalid = { type: 'invalid' };

const user: User = { credit: 10 };

/** A branded refinement of `string`, to prove the guard's `S` survives. */
type Email = string & { readonly __brand: 'email' };
const isEmail = (value: string): value is Email => value.includes('@');

describe('fromNullable', () => {
  it('presentValue_returnsOkOfTheValue', () => {
    const result = fromNullable(user, notFound);

    expect(result).toEqual(ok(user));
  });

  it('null_returnsErrOfTheGivenError', () => {
    const result = fromNullable(null, notFound);

    expect(result).toEqual(err(notFound));
  });

  it('undefined_returnsErrOfTheGivenError', () => {
    const result = fromNullable(undefined, notFound);

    expect(result).toEqual(err(notFound));
  });

  it('nullableInput_stripsNullAndUndefinedFromTheSuccessType', () => {
    const maybeUser: User | null | undefined = user;

    const result = fromNullable(maybeUser, notFound);

    expectTypeOf(result).toEqualTypeOf<Result<User, NotFound>>();
  });

  it('explicitNullableTypeArgument_stillStripsNullFromTheSuccessType', () => {
    // The assertion above cannot see `NonNullable` doing its job: inference
    // already strips `null | undefined` into `T` when matching `T | null |
    // undefined`, so `Result<T, E>` and `Result<NonNullable<T>, E>` coincide
    // and a signature that dropped `NonNullable` would pass it. Pinning `T`
    // explicitly is what separates them.
    const maybeUser: User | null = user;

    const result = fromNullable<User | null, NotFound>(maybeUser, notFound);

    expectTypeOf(result).toEqualTypeOf<Result<User, NotFound>>();
  });

  it('zero_isAValueAndReachesTheOkChannel', () => {
    const result = fromNullable(0, notFound);

    expect(result).toEqual(ok(0));
  });

  it('emptyString_isAValueAndReachesTheOkChannel', () => {
    const result = fromNullable('', notFound);

    expect(result).toEqual(ok(''));
  });

  it('false_isAValueAndReachesTheOkChannel', () => {
    const result = fromNullable(false, notFound);

    expect(result).toEqual(ok(false));
  });

  it('nan_isAValueAndReachesTheOkChannel', () => {
    const result = fromNullable(Number.NaN, notFound);

    expect(result).toEqual(ok(Number.NaN));
  });
});

describe('fromPredicate', () => {
  it('predicateTrue_returnsOkOfTheValue', () => {
    const result = fromPredicate(5, (n: number) => n > 0, invalid);

    expect(result).toEqual(ok(5));
  });

  it('predicateFalse_returnsErrOfTheGivenError', () => {
    const result = fromPredicate(-5, (n: number) => n > 0, invalid);

    expect(result).toEqual(err(invalid));
  });

  it('booleanPredicate_keepsTheSuccessTypeUnnarrowed', () => {
    // Annotated, not a literal: `fromPredicate(5, …)` infers the *literal* `5`
    // for `T` — correct, and consistent with `ok(5)` being `Ok<5>` — which
    // would confound what this asserts.
    const positive: number = 5;

    const result = fromPredicate(positive, (n: number) => n > 0, invalid);

    expectTypeOf(result).toEqualTypeOf<Result<number, Invalid>>();
  });

  it('literalValue_infersTheLiteralType', () => {
    const result = fromPredicate(5, (n: number) => n > 0, invalid);

    expectTypeOf(result).toEqualTypeOf<Result<5, Invalid>>();
  });

  it('typeGuard_narrowsTheSuccessTypeToTheGuardedType', () => {
    const result = fromPredicate('a@b.com', isEmail, invalid);

    expectTypeOf(result).toEqualTypeOf<Result<Email, Invalid>>();
  });

  it('typeGuardFailing_returnsErrOfTheGivenError', () => {
    const result = fromPredicate('nope', isEmail, invalid);

    expect(result).toEqual(err(invalid));
  });

  it('predicate_receivesTheValueUnderTest', () => {
    const predicate = vi.fn((n: number) => n > 0);

    fromPredicate(5, predicate, invalid);

    expect(predicate).toHaveBeenCalledWith(5);
  });
});

describe('fromThrowable', () => {
  it('nonThrowingFn_returnsOkOfTheReturnValue', () => {
    const parse = fromThrowable(JSON.parse, () => invalid);

    expect(parse('{"a":1}')).toEqual(ok({ a: 1 }));
  });

  it('throwingFn_routesTheThrownValueThroughErrorFn', () => {
    const parse = fromThrowable(JSON.parse, (e) => ({
      type: 'invalid' as const,
      thrown: e,
    }));

    const result = parse('{ not json');

    expect(result).toMatchObject({ ok: false, error: { type: 'invalid' } });
  });

  it('nonErrorThrow_stillReachesTheErrChannel', () => {
    const wrapped = fromThrowable(
      () => {
        throw 'a bare string';
      },
      (e) => e,
    );

    expect(wrapped()).toEqual(err('a bare string'));
  });

  it('undefinedThrow_stillReachesTheErrChannel', () => {
    const wrapped = fromThrowable(
      () => {
        throw undefined;
      },
      (e) => ({ type: 'invalid' as const, thrown: e }),
    );

    expect(wrapped()).toEqual(err({ type: 'invalid', thrown: undefined }));
  });

  it('wrappedFn_isReusableAcrossCalls', () => {
    const parse = fromThrowable(JSON.parse, () => invalid);

    expect(parse('{"a":1}')).toEqual(ok({ a: 1 }));
    expect(parse('{"b":2}')).toEqual(ok({ b: 2 }));
  });

  it('wrappedFn_isLazyAndDoesNotCallFnUntilInvoked', () => {
    const fn = vi.fn(() => 1);

    fromThrowable(fn, () => invalid);

    expect(fn).not.toHaveBeenCalled();
  });

  it('wrappedFn_preservesTheArgumentListOfTheWrappedFn', () => {
    const wrapped = fromThrowable(
      (text: string, radix: number) => Number.parseInt(text, radix),
      () => invalid,
    );

    expectTypeOf(wrapped).toEqualTypeOf<
      (text: string, radix: number) => Result<number, Invalid>
    >();
  });

  it('wrappedFn_forwardsEveryArgumentToTheWrappedFn', () => {
    const wrapped = fromThrowable(
      (text: string, radix: number) => Number.parseInt(text, radix),
      () => invalid,
    );

    expect(wrapped('ff', 16)).toEqual(ok(255));
  });
});

describe('fromPromise', () => {
  it('resolvingPromise_returnsOkOfTheResolvedValue', async () => {
    const result = await fromPromise(Promise.resolve(user), () => notFound);

    expect(result).toEqual(ok(user));
  });

  it('rejectingPromise_catchesTheRejectionIntoTheErrChannel', async () => {
    const result = await fromPromise(
      Promise.reject(new Error('boom')),
      () => notFound,
    );

    expect(result).toEqual(err(notFound));
  });

  it('rejectingPromise_routesTheRejectedValueThroughOnReject', async () => {
    const onReject = vi.fn(() => notFound);
    const boom = new Error('boom');

    await fromPromise(Promise.reject(boom), onReject);

    expect(onReject).toHaveBeenCalledWith(boom);
  });

  it('nonErrorRejection_stillReachesTheErrChannel', async () => {
    const result = await fromPromise(Promise.reject('a bare string'), (e) => e);

    expect(result).toEqual(err('a bare string'));
  });

  it('returnsAPlainPromiseOfResult_neverAWrapper', async () => {
    const pending = fromPromise(Promise.resolve(user), () => notFound);

    expectTypeOf(pending).toEqualTypeOf<Promise<Result<User, NotFound>>>();
    await pending;
  });
});

describe('fromThrowableAsync', () => {
  it('resolvingFn_returnsOkOfTheResolvedValue', async () => {
    const load = fromThrowableAsync(async (id: string) => ({ id }), () => notFound);

    await expect(load('u1')).resolves.toEqual(ok({ id: 'u1' }));
  });

  it('rejectingFn_catchesTheRejectionIntoTheErrChannel', async () => {
    const load = fromThrowableAsync(async () => {
      throw new Error('boom');
    }, () => notFound);

    await expect(load()).resolves.toEqual(err(notFound));
  });

  it('syncThrowBeforeThePromiseIsBuilt_stillReachesTheErrChannel', async () => {
    const load = fromThrowableAsync((): Promise<User> => {
      throw new Error('boom');
    }, () => notFound);

    await expect(load()).resolves.toEqual(err(notFound));
  });

  it('wrappedFn_isReusableAcrossCalls', async () => {
    const load = fromThrowableAsync(async (id: string) => ({ id }), () => notFound);

    await expect(load('u1')).resolves.toEqual(ok({ id: 'u1' }));
    await expect(load('u2')).resolves.toEqual(ok({ id: 'u2' }));
  });

  it('wrappedFn_isLazyAndDoesNotCallFnUntilInvoked', () => {
    const fn = vi.fn(async () => user);

    fromThrowableAsync(fn, () => notFound);

    expect(fn).not.toHaveBeenCalled();
  });

  it('wrappedFn_preservesTheArgumentListOfTheWrappedFn', () => {
    const load = fromThrowableAsync(
      async (id: string, force: boolean) => ({ id, force }),
      () => notFound,
    );

    expectTypeOf(load).toEqualTypeOf<
      (
        id: string,
        force: boolean,
      ) => Promise<Result<{ id: string; force: boolean }, NotFound>>
    >();
  });

  it('returnsAPlainPromiseOfResult_neverAWrapper', async () => {
    const load = fromThrowableAsync(async () => user, () => notFound);

    expectTypeOf(load()).toEqualTypeOf<Promise<Result<User, NotFound>>>();
    await load();
  });
});
