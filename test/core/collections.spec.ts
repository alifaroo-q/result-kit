import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  combine,
  combineWithAllErrors,
  err,
  ok,
  partition,
} from '../../src/index';
import type { ErrTypeOf, KeyedError, OkTypeOf, Result } from '../../src/index';

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

/**
 * The record ("object form") overload — [#95](https://github.com/alifaroo-q/result-kit/issues/95),
 * [ADR 0017](../../docs/adr/0017-object-form-combine.md).
 *
 * The array assertions above are the baseline this must not move: the overload
 * pair is safe precisely because an array of `Result`s is not assignable to
 * `Record<string, Result<unknown, unknown>>`, so the record overload is
 * unreachable for an array input. That assignability is pinned directly below
 * rather than inferred from overload-resolution behaviour, so it survives a
 * compiler upgrade.
 */
describe('combine — the record overload', () => {
  it('allOk_returnsOkOfARecordKeyedIdentically', () => {
    const result = combine({ user: okUser(), order: okOrder() });

    expect(result).toEqual(ok({ user, order }));
  });

  it('allOk_preservesPerKeySuccessTypesAndUnionsTheErrors', () => {
    const result = combine({ user: okUser(), order: okOrder() });

    expectTypeOf(result).toEqualTypeOf<
      Result<{ user: User; order: Order }, NotFound | Timeout>
    >();
  });

  it('someErr_returnsTheFirstErrByIdentity', () => {
    const first = errUser();

    const result = combine({ a: okUser(), b: first, c: errOrder() });

    expect(result).toBe(first);
  });

  it('integerLikeKeys_firstErrMeansPropertyOrderNotOrderAsWritten', () => {
    // `Object.keys` yields integer-like keys in ascending numeric order BEFORE
    // insertion-ordered string keys, so the fail-fast rule §5.4 states
    // positionally becomes a rule about JS property order (F16).
    const late = err(timeout);
    const early = err(notFound);

    expect(combine({ 10: late, 2: early })).toBe(early);
  });

  it('symbolKeyedErr_isSilentlyInvisible', () => {
    // Documented, not closed: a symbol key does not join the string index
    // signature, so it type-checks and is dropped. It matches the §2.1
    // serialization boundary, and a per-call symbol scan would defend against a
    // shape the type system cannot express usefully.
    const key = Symbol('ignored');
    const bag = { a: ok(1), [key]: err(notFound) };

    expect(combine(bag)).toEqual(ok({ a: 1 }));
  });

  it('inheritedAndNonEnumerableProperties_doNotParticipate', () => {
    const bag = Object.create({ inherited: err(notFound) }) as Record<
      string,
      Result<number, NotFound>
    >;
    bag.own = ok(1);
    Object.defineProperty(bag, 'hidden', { value: err(notFound), enumerable: false });

    expect(combine(bag)).toEqual(ok({ own: 1 }));
  });

  it('emptyRecord_isOkOfAnEmptyRecord', () => {
    expect(combine({})).toEqual(ok({}));
  });

  it('protoKey_survivesAsAnOwnPropertyRatherThanSettingThePrototype', () => {
    // `__proto__` is an accessor on `Object.prototype`, so the obvious
    // `values[key] = …` sets the record's prototype instead of adding a key —
    // and the record form's one promise is that the output is keyed
    // identically to the input.
    const bag = { ['__proto__']: ok(1), b: ok(2) } as Record<string, Result<number, never>>;

    const result = combine(bag);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
  });

  it('nonArrayIterable_throwsRatherThanReadingAsAnEmptyRecord', () => {
    // Neither overload accepts one, but the dispatch would otherwise send it
    // down the record path where `Object.keys(new Set(…))` is `[]` — a silent
    // `ok({})` for input that plainly failed.
    const set = new Set([ok(1), err('x')]) as unknown as Result<number, string>[];

    expect(() => combine(set)).toThrow(
      'combine: expected an array or a record of Results, but received a non-array iterable',
    );
    expect(() => combineWithAllErrors(set)).toThrow(
      'combineWithAllErrors: expected an array or a record of Results, but received a non-array iterable',
    );
  });

  it('optionalKey_keepsOptionalityOnTheSuccessSide', () => {
    // `-?` is deliberately absent here: `posts?: Order | undefined` is what the
    // caller actually has. See the error-side assertion in the next block.
    const bag: { user: Result<User, NotFound>; posts?: Result<Order, Timeout> } = {
      user: okUser(),
    };

    const result = combine(bag);

    expectTypeOf(result).toEqualTypeOf<
      Result<{ user: User; posts?: Order | undefined }, NotFound | Timeout>
    >();
  });

  it('nonNullableIsRequired_notDefensive', () => {
    // With an optional key `T[K]` is `Result<…> | undefined`, which fails
    // `OkTypeOf`'s and `ErrTypeOf`'s `R extends Result<unknown, unknown>`
    // constraint — the signature does not compile without `NonNullable`.
    // @ts-expect-error - `Result | undefined` does not satisfy the constraint
    type _RejectedOk = OkTypeOf<Result<User, NotFound> | undefined>;
    // @ts-expect-error - the mirror, on the error side
    type _RejectedErr = ErrTypeOf<Result<User, NotFound> | undefined>;

    expectTypeOf<OkTypeOf<NonNullable<Result<User, NotFound> | undefined>>>()
      .toEqualTypeOf<User>();
  });

  it('anArrayIsNotAssignableToTheRecordConstraint', () => {
    // The whole safety argument for an overload pair rather than a new name:
    // `length` and `push` are not `Result`s, so the record overload is
    // unreachable for an array input regardless of declaration order (F14).
    const rows: Result<User, NotFound>[] = [okUser()];

    // @ts-expect-error - an array does not satisfy Record<string, Result<…>>
    const bag: Record<string, Result<unknown, unknown>> = rows;

    expect(bag).toBe(rows);
  });
});

describe('combineWithAllErrors — the record overload', () => {
  it('allOk_returnsOkOfARecordKeyedIdentically', () => {
    const result = combineWithAllErrors({ user: okUser(), order: okOrder() });

    expect(result).toEqual(ok({ user, order }));
  });

  it('someErr_accumulatesKeyedErrorEntriesInPropertyOrder', () => {
    const result = combineWithAllErrors({
      order: errOrder(),
      user: errUser(),
      fine: okUser(),
    });

    expect(result).toEqual(
      err([
        { key: 'order', error: timeout },
        { key: 'user', error: notFound },
      ]),
    );
  });

  it('someErr_entriesAreADiscriminatedUnionKeyedByTheInputKey', () => {
    const result = combineWithAllErrors({ user: errUser(), order: errOrder() });

    expectTypeOf(result).toEqualTypeOf<
      Result<
        { user: User; order: Order },
        (KeyedError<'user', NotFound> | KeyedError<'order', Timeout>)[]
      >
    >();
  });

  it('someErr_switchOnKeyNarrowsTheErrorToThatKeysVariant', () => {
    const result = combineWithAllErrors({ user: errUser(), order: errOrder() });

    if (result.ok) throw new Error('unreachable');

    for (const entry of result.error) {
      switch (entry.key) {
        case 'user':
          expectTypeOf(entry.error).toEqualTypeOf<NotFound>();
          break;
        case 'order':
          expectTypeOf(entry.error).toEqualTypeOf<Timeout>();
          break;
      }
    }
  });

  it('indexSignatureRecord_degradesHonestlyToAStringKey', () => {
    const rows: Record<string, Result<User, NotFound>> = { a: errUser() };

    const result = combineWithAllErrors(rows);

    expectTypeOf(result).toEqualTypeOf<
      Result<Record<string, User>, KeyedError<string, NotFound>[]>
    >();
  });

  it('optionalKey_stripsOptionalityOnTheErrorSideOnly', () => {
    // `-?` on the error mapped type and NOT on the success one. Without it the
    // entry union gains `undefined` and `entry.error` reads as `E | undefined`
    // — §10.6's failure mode, and the defect that sank the partial-record
    // alternative. The success side keeps `posts?`, which is correct.
    const bag: { user: Result<User, NotFound>; posts?: Result<Order, Timeout> } = {
      user: okUser(),
    };

    const result = combineWithAllErrors(bag);

    expectTypeOf(result).toEqualTypeOf<
      Result<
        { user: User; posts?: Order | undefined },
        (KeyedError<'user', NotFound> | KeyedError<'posts', Timeout>)[]
      >
    >();
  });

  it('keyedErrors_bridgeToTheFlatFormattersByMappingTheErrorOut', () => {
    // The one real cost of the asymmetry: `groupByType` / `prettifyErrors` take
    // a flat `TypedError[]`, so a `KeyedError[]` must be unwrapped first.
    const result = combineWithAllErrors({ user: errUser(), order: errOrder() });

    if (result.ok) throw new Error('unreachable');

    const flat = result.error.map((entry) => entry.error);

    expect(flat).toEqual([notFound, timeout]);
    expectTypeOf(flat).toEqualTypeOf<(NotFound | Timeout)[]>();
  });

  it('emptyRecord_isOkOfAnEmptyRecordRatherThanErrOfNoErrors', () => {
    expect(combineWithAllErrors({})).toEqual(ok({}));
  });

  it('protoKey_survivesOnBothTheSuccessAndTheAccumulatedHalves', () => {
    const bag = { ['__proto__']: err(notFound), b: ok(1) } as unknown as Record<
      string,
      Result<number, NotFound>
    >;

    const result = combineWithAllErrors(bag);

    expect(result).toEqual(err([{ key: '__proto__', error: notFound }]));
    expect(combineWithAllErrors({ ['__proto__']: ok(1) })).toEqual(
      ok(Object.defineProperty({}, '__proto__', {
        value: 1,
        writable: true,
        enumerable: true,
        configurable: true,
      })),
    );
  });
});

describe('the not-a-Result diagnostic', () => {
  /**
   * An optional key may carry `undefined` as a *present* own key, and a hole in
   * a sparse array yields `undefined` identically. Reading `.ok` off it threw a
   * bare `TypeError` naming neither the combinator nor the offending key — a
   * handler that is itself the crash, the shape closed four times already in
   * this package. It stays a hard failure, because a non-`Result` in the bag is
   * a programming error, but it now reports through `render.ts`'s family.
   */
  it('recordEntryPresentButUndefined_throwsNamingTheKey', () => {
    const bag = { user: okUser(), posts: undefined } as unknown as Record<
      string,
      Result<unknown, unknown>
    >;

    expect(() => combine(bag)).toThrow(
      'combine: value at key "posts" is not a Result (received: undefined)',
    );
    expect(() => combineWithAllErrors(bag)).toThrow(
      'combineWithAllErrors: value at key "posts" is not a Result (received: undefined)',
    );
  });

  it('recordPath_validatesTheWholeBagBeforeReadingAnyOfIt', () => {
    // Deterministic rather than hiding behind whichever `Err` came first —
    // otherwise this returns cleanly today and crashes the first time `user`
    // succeeds, a programming error hiding behind a data error on a schedule.
    const bag = { user: errUser(), posts: undefined } as unknown as Record<
      string,
      Result<unknown, unknown>
    >;

    expect(() => combine(bag)).toThrow(/value at key "posts"/);
  });

  it('sparseArrayHole_throwsNamingTheIndex', () => {
    // Reachable only through a cast, which is why the array path guards as
    // visited rather than paying a second pass. This half is a fix to shipped
    // behaviour: it used to be a bare `TypeError`.
    const sparse = [okUser(), , okUser()] as unknown as Result<User, NotFound>[];

    expect(() => combine(sparse)).toThrow(
      'combine: value at index 1 is not a Result (received: undefined)',
    );
    expect(() => combineWithAllErrors(sparse)).toThrow(
      'combineWithAllErrors: value at index 1 is not a Result (received: undefined)',
    );
  });

  it('arrayPath_guardsAsVisitedSoAnEarlierErrStillShortCircuits', () => {
    const sparse = [errUser(), , okUser()] as unknown as Result<User, NotFound>[];

    expect(combine(sparse)).toEqual(err(notFound));
  });

  it('nonResultPayload_isRenderedThroughRenderPayloadAndNeverCrashes', () => {
    // `renderPayload` rather than a bare interpolation: the offending value is
    // arbitrary, and a circular object would make `JSON.stringify` throw a
    // serializer crash in place of the diagnostic.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const bag = { a: cyclic } as unknown as Record<string, Result<unknown, unknown>>;

    expect(() => combine(bag)).toThrow(/combine: value at key "a" is not a Result/);
  });

  it('callableCarryingOk_isAdmittedRatherThanRejected', () => {
    // The shared guard admits a callable for the reason §10.9 widened
    // `isTypedError`: a function carrying `ok: true` is structurally an `Ok`
    // and tsc assigns it, so a guard that rejected it would be narrower than
    // the type it gates. The `/testing` matchers' guard and this one are the
    // same function, so they cannot disagree about it.
    const callable = Object.assign(() => {}, { ok: true as const, value: 1 });

    expect(combine({ a: callable })).toEqual(ok({ a: 1 }));
  });

  it('revokedProxyEntry_propagatesRatherThanReportingASilentSuccess', () => {
    // A pinned *limit*, not a feature, and inherited from the `/testing`
    // matchers' guard, which is now literally the same function: a subject that
    // explodes on read cannot be classified, so the throw surfaces it. What
    // matters is that it does not quietly become an `Ok`. Unlike `renderPayload`
    // and `schema.ts`'s classifier — which swallow, because a *reporter* that
    // crashes replaces the answer — this one classifies.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const bag = { a: proxy } as unknown as Record<string, Result<unknown, unknown>>;

    expect(() => combine(bag)).toThrow(TypeError);
  });
});
