import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  combine,
  combineWithAllErrors,
  err,
  ok,
  partition,
} from '../../src/index';
import type { ErrTypeOf, OkTypeOf, Result } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * Tuple preservation is the §5.4 promise that only tsc can hold. A `combine`
 * that collapsed `[ok(1), ok('a')]` to `Result<(number | string)[], never>`
 * returns the identical array at runtime and passes every value assertion
 * below — the degradation is invisible until a consumer indexes the tuple.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
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
const timeout: Timeout = { type: 'timeout', ms: 500 };

const user: User = { credit: 10 };
const order: Order = { total: 99 };

/**
 * Real stubs, not `declare`s — the return annotation is what every type
 * assertion reads, but these also execute under vitest.
 */
const okUser = (): Result<User, NotFound> => ok(user);
const errUser = (): Result<User, NotFound> => err(notFound);
const okOrder = (): Result<Order, Timeout> => ok(order);
const errOrder = (): Result<Order, Timeout> => err(timeout);

describe('combine', () => {
  it('allOk_returnsOkOfEveryValueInInputOrder', () => {
    const result = combine([ok(1), ok(2), ok(3)]);

    expect(result).toEqual(ok([1, 2, 3]));
  });

  it('heterogeneousTuple_preservesPerPositionSuccessTypes', () => {
    const result = combine([okUser(), okOrder()]);

    expectTypeOf(result).toEqualTypeOf<
      Result<[User, Order], NotFound | Timeout>
    >();
  });

  it('homogeneousArray_mapsToArrayOfTheElementSuccessType', () => {
    const rows: Result<User, NotFound>[] = [okUser(), okUser()];

    const result = combine(rows);

    expectTypeOf(result).toEqualTypeOf<Result<User[], NotFound>>();
  });

  it('someErr_returnsTheFirstErrAndNotTheLater', () => {
    const result = combine([okUser(), errUser(), errOrder()]);

    expect(result).toEqual(err(notFound));
  });

  it('someErr_returnsTheFirstErrByIdentity', () => {
    const first = errUser();

    const result = combine([okUser(), first, errOrder()]);

    expect(result).toBe(first);
  });

  it('someErr_errorTypeIsTheUnionOfTheInputErrorTypes', () => {
    const result = combine([okUser(), errOrder()]);

    expectTypeOf(result).toEqualTypeOf<
      Result<[User, Order], NotFound | Timeout>
    >();
  });

  it('emptyInput_returnsOkOfEmptyTuple', () => {
    const result = combine([]);

    expect(result).toEqual(ok([]));
  });

  it('emptyInput_hasNoInhabitableErrorType', () => {
    const result = combine([]);

    expectTypeOf(result).toEqualTypeOf<Result<[], never>>();
  });
});

describe('combineWithAllErrors', () => {
  it('allOk_returnsOkOfEveryValueInInputOrder', () => {
    const result = combineWithAllErrors([ok(1), ok(2), ok(3)]);

    expect(result).toEqual(ok([1, 2, 3]));
  });

  it('heterogeneousTuple_preservesPerPositionSuccessTypes', () => {
    const result = combineWithAllErrors([okUser(), okOrder()]);

    expectTypeOf(result).toEqualTypeOf<
      Result<[User, Order], (NotFound | Timeout)[]>
    >();
  });

  it('homogeneousArray_mapsToArrayOfTheElementSuccessType', () => {
    const rows: Result<User, NotFound>[] = [okUser(), okUser()];

    const result = combineWithAllErrors(rows);

    expectTypeOf(result).toEqualTypeOf<Result<User[], NotFound[]>>();
  });

  it('someErr_accumulatesEveryErrorFlatInInputOrder', () => {
    const result = combineWithAllErrors([errOrder(), okUser(), errUser()]);

    expect(result).toEqual(err([timeout, notFound]));
  });

  it('singleErr_stillAccumulatesIntoAnArray', () => {
    const result = combineWithAllErrors([okUser(), errUser()]);

    expect(result).toEqual(err([notFound]));
  });

  it('emptyInput_returnsOkOfEmptyTupleRatherThanErrOfNoErrors', () => {
    const result = combineWithAllErrors([]);

    expect(result).toEqual(ok([]));
  });
});

describe('partition', () => {
  it('mixedInput_returnsSuccessesAndFailuresPreservingOrderWithinEachHalf', () => {
    const results: Result<number, string>[] = [
      ok(1),
      err('a'),
      ok(2),
      err('b'),
    ];

    const partitioned = partition(results);

    expect(partitioned).toEqual([
      [1, 2],
      ['a', 'b'],
    ]);
  });

  it('allOk_returnsEveryValueAndNoFailures', () => {
    const partitioned = partition([ok(1), ok(2)]);

    expect(partitioned).toEqual([[1, 2], []]);
  });

  it('allErr_returnsNoValuesAndEveryFailure', () => {
    const results: Result<number, string>[] = [err('a'), err('b')];

    const partitioned = partition(results);

    expect(partitioned).toEqual([[], ['a', 'b']]);
  });

  it('emptyInput_returnsTwoEmptyHalves', () => {
    const partitioned = partition([]);

    expect(partitioned).toEqual([[], []]);
  });

  it('mixedInput_splitsTheUnionIntoItsTwoHalves', () => {
    const results: Result<User, NotFound>[] = [okUser(), errUser()];

    const partitioned = partition(results);

    expectTypeOf(partitioned).toEqualTypeOf<[User[], NotFound[]]>();
  });

  it('readonlyInput_isAccepted', () => {
    const results: readonly Result<User, NotFound>[] = [okUser(), errUser()];

    const partitioned = partition(results);

    expect(partitioned).toEqual([[user], [notFound]]);
  });
});

describe('the §5.4 no-promise-overloads scope line', () => {
  /**
   * Pinned per function: `await Promise.all([...])` first, then hand the
   * settled `Result[]` to the combinator. An accidental overload would make
   * these three directives unused, which `pnpm check` reports as an error.
   * Uninvoked — the assertion is the compile, not the call.
   */
  it('none_of_the_three_accepts_an_array_of_promises', () => {
    const pending = [Promise.resolve(okUser())];

    // @ts-expect-error — no promise overloads; await Promise.all first.
    expect(() => combine(pending)).toBeDefined();
    // @ts-expect-error — no promise overloads; await Promise.all first.
    expect(() => combineWithAllErrors(pending)).toBeDefined();
    // @ts-expect-error — no promise overloads; await Promise.all first.
    expect(() => partition(pending)).toBeDefined();
  });
});

describe('OkTypeOf / ErrTypeOf', () => {
  it('okTypeOf_result_extractsTheSuccessHalf', () => {
    expectTypeOf<OkTypeOf<Result<User, NotFound>>>().toEqualTypeOf<User>();
  });

  it('errTypeOf_result_extractsTheErrorHalf', () => {
    expectTypeOf<ErrTypeOf<Result<User, NotFound>>>().toEqualTypeOf<NotFound>();
  });

  it('errTypeOf_unionOfResults_unionsTheirErrorTypes', () => {
    expectTypeOf<
      ErrTypeOf<Result<User, NotFound> | Result<Order, Timeout>>
    >().toEqualTypeOf<NotFound | Timeout>();
  });
});
