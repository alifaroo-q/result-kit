import { describe, expect, it } from 'vitest';

import { defineError, err, ok } from '../../src/index';
import { resultMatchers } from '../../src/testing/index';

expect.extend(resultMatchers);

const notFound = defineError(
  'not_found',
  (d: { id: string }) => `User ${d.id} not found`,
);

/**
 * Round-trips a value through JSON the way a `Result` crossing a boundary does
 * (spec §2.1), and hands back `unknown` — the type a matcher actually receives.
 */
const overTheWire = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));

/**
 * The four matchers are two symmetric pairs, so most rules below are stated
 * once as a table rather than four times as prose. Each row names the matcher,
 * the half it asserts, and a subject on each side of that half.
 */
const BRANCHES = [
  {
    matcher: 'toBeOk',
    payloadMatcher: 'toBeOkWith',
    half: 'Ok',
    match: () => ok(1),
    miss: () => err('boom'),
    // The message the *delegated* assertion throws for `miss`.
    missMessage: 'Expected Ok, got Err: "boom"',
    matchMessage: 'Expected Err, got Ok: 1',
  },
  {
    matcher: 'toBeErr',
    payloadMatcher: 'toBeErrWith',
    half: 'Err',
    match: () => err('boom'),
    miss: () => ok(1),
    missMessage: 'Expected Err, got Ok: 1',
    matchMessage: 'Expected Ok, got Err: "boom"',
  },
] as const;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('the branch matchers — happy path', () => {
  it('toBeOk_okResult_passes', () => {
    expect(ok(42)).toBeOk();
  });

  it('toBeErr_errResult_passes', () => {
    expect(err('boom')).toBeErr();
  });

  it('toBeOkWith_matchingValue_passes', () => {
    expect(ok({ id: 'u1', name: 'Ada' })).toBeOkWith({ id: 'u1', name: 'Ada' });
  });

  it('toBeErrWith_matchingError_passes', () => {
    expect(err(notFound({ id: 'u1' }))).toBeErrWith(notFound({ id: 'u1' }));
  });
});

describe.each(BRANCHES)(
  '$matcher / $payloadMatcher — the branch contract',
  ({ matcher, payloadMatcher, match, miss, missMessage, matchMessage }) => {
    // Indexing the extended `expect` by matcher name keeps the pair symmetric
    // without a second copy of every rule. The augmentation types the named
    // calls; this dynamic form is the one place a cast is warranted.
    const assert = (subject: unknown, negated = false): void => {
      const target = negated ? expect(subject).not : expect(subject);
      (target as unknown as Record<string, () => void>)[matcher]!();
    };
    const assertWith = (subject: unknown, expected: unknown): void => {
      (
        expect(subject) as unknown as Record<string, (e: unknown) => void>
      )[payloadMatcher]!(expected);
    };

    it(`${matcher}_onItsOwnHalf_passes`, () => {
      assert(match());
    });

    it(`${matcher}_onTheOtherHalf_failsWithTheDelegatedMessage`, () => {
      // The wording is thrown by expectOk/expectErr, never authored in the
      // matcher — that delegation is what makes #67 reach these for free.
      expect(() => assert(miss())).toThrow(missMessage);
    });

    it(`${matcher}_negatedOnTheOtherHalf_passes`, () => {
      assert(miss(), true);
    });

    it(`${matcher}_negatedOnItsOwnHalf_failsWithTheOppositeDelegatedMessage`, () => {
      // The bug this pins: picking the message by `pass` alone was correct for
      // toBeOk's polarity and produced an *empty* message for toBeErr.
      expect(() => assert(match(), true)).toThrow(matchMessage);
    });

    it(`${payloadMatcher}_onTheOtherHalf_failsWithTheDelegatedMessage`, () => {
      // Wrong-branch beats wrong-payload: diffing a value against an error is
      // noise, so the rich branch message wins.
      expect(() => assertWith(miss(), 'anything')).toThrow(missMessage);
    });
  },
);

// ---------------------------------------------------------------------------
// Edge & boundary
// ---------------------------------------------------------------------------

describe('the structural Result check — edge cases', () => {
  it('toBeOk_okVoidRoundTrippedThroughJson_passes', () => {
    // §2.1: `ok()` serializes to `{"ok":true}` — the `value` key is dropped
    // entirely. Requiring the key would reject the exact value the round-trip
    // guarantee is about.
    expect(overTheWire(ok())).toBeOk();
  });

  it('toBeErr_errUndefinedRoundTrippedThroughJson_passes', () => {
    expect(overTheWire(err(undefined))).toBeErr();
  });

  it('toBeOk_callableCarryingOkTrue_passes', () => {
    // §10.9 parity: a function carrying `ok: true` is structurally an `Ok` and
    // tsc assigns it, so the guard must not be narrower than the type it gates.
    const callable = Object.assign(() => {}, { ok: true, value: 7 });

    expect(callable).toBeOk();
  });

  it('toBeOk_objectWithNullPrototypeCarryingOk_passes', () => {
    // §3.4's hazard in the other direction: a null-prototype bag is still a
    // structurally valid Result, and nothing here may reach for a prototype.
    const bare = Object.assign(Object.create(null) as object, {
      ok: true,
      value: 1,
    });

    expect(bare).toBeOk();
  });

  const falsyValues: [label: string, value: unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['an empty string', ''],
    ['false', false],
    ['NaN', Number.NaN],
  ];

  it.each(falsyValues)(
    'toBeOk_okCarrying_%s_passesOnTheDiscriminantNotTheValue',
    (_label, value) => {
      // `ok` is the discriminant and it alone decides the branch. A guard that
      // sniffed truthiness of `value` would call every one of these an Err.
      expect(ok(value)).toBeOk();
    },
  );

  it.each(falsyValues)(
    'toBeErr_errCarrying_%s_passesOnTheDiscriminantNotTheError',
    (_label, value) => {
      expect(err(value)).toBeErr();
    },
  );
});

describe('the payload matchers — equality semantics', () => {
  it('toBeOkWith_deeplyNestedValue_comparesByValueNotReference', () => {
    const value = { user: { id: 'u1', tags: ['a', 'b'] }, meta: { n: 1 } };

    expect(ok(structuredClone(value))).toBeOkWith(value);
  });

  it('toBeOkWith_nestedValueDifferingDeepInside_fails', () => {
    // The mirror of the test above — without it, a shallow comparison would
    // pass both.
    const value = { user: { id: 'u1', tags: ['a', 'b'] } };
    const changed = { user: { id: 'u1', tags: ['a', 'c'] } };

    expect(() => expect(ok(changed)).toBeOkWith(value)).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOkWith_setValue_comparesByContentNotIdentity', () => {
    // This is what `iterableEquality` is passed to `this.equals` for; without
    // it two distinct Sets with equal members compare unequal.
    expect(ok(new Set([1, 2]))).toBeOkWith(new Set([1, 2]));
  });

  it('toBeOkWith_mapValue_comparesByContentNotIdentity', () => {
    expect(ok(new Map([['a', 1]]))).toBeOkWith(new Map([['a', 1]]));
  });

  it('toBeOkWith_setValueWithDifferentMembers_fails', () => {
    // The positive control for `iterableEquality`: a tester that made every
    // Set equal would pass the two tests above just as happily.
    expect(() => expect(ok(new Set([1, 2]))).toBeOkWith(new Set([1, 3]))).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOkWith_expectedCarryingAnExplicitUndefinedKey_passes', () => {
    // `toEqual` semantics, not `toStrictEqual` — pinned because it is a
    // deliberate choice and the two differ exactly here.
    expect(ok({ a: 1 })).toBeOkWith({ a: 1, b: undefined });
  });

  it('toBeOkWith_undefinedAgainstOkVoid_passes', () => {
    expect(ok()).toBeOkWith(undefined);
  });

  it('toBeOkWith_nullAgainstOkUndefined_fails', () => {
    // null and undefined are distinct values, and a matcher that conflated
    // them would hide a real mix-up.
    expect(() => expect(ok(undefined)).toBeOkWith(null)).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOkWith_nanValue_passes', () => {
    // Deep equality treats NaN as equal to itself; `===` does not. A matcher
    // built on `===` would fail this.
    expect(ok(Number.NaN)).toBeOkWith(Number.NaN);
  });

  it('toBeOkWith_zeroAgainstNegativeZero_fails', () => {
    // Measured, not assumed — an earlier draft of this test asserted the
    // opposite. Vitest's `equals` separates `0` from `-0` (Object.is, not
    // `===`), and inheriting that is right: this matcher's job is to be
    // `toEqual` scoped to a branch, not to invent its own numeric semantics.
    expect(() => expect(ok(0)).toBeOkWith(-0)).toThrow(/Expected Ok to equal/);
  });

  it('toBeErrWith_typedErrorDifferingOnlyInDetails_fails', () => {
    // The realistic near-miss: same tag, same message shape, different payload.
    expect(() =>
      expect(err(notFound({ id: 'u1' }))).toBeErrWith(notFound({ id: 'u2' })),
    ).toThrow(/Expected Err to equal/);
  });

  it('toBeOkWith_comparesTheValueNotTheWholeResult', () => {
    // The subject is the Result; the compared thing is its `value`. Passing
    // the whole Result must therefore *fail*, which is the honest reading.
    expect(() => expect(ok(1)).toBeOkWith({ ok: true, value: 1 })).toThrow(
      /Expected Ok to equal/,
    );
  });
});

describe('the payload matchers — asymmetric matchers', () => {
  it('toBeOkWith_objectContaining_passesOnASubsetOfTheValue', () => {
    // Subset matching is vitest's own tool, not a third semantic here.
    expect(ok({ id: 'u1', name: 'Ada' })).toBeOkWith(
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('toBeErrWith_objectContainingTheTag_passesIgnoringThePayload', () => {
    expect(err(notFound({ id: 'u1' }))).toBeErrWith(
      expect.objectContaining({ type: 'not_found' }),
    );
  });

  it('toBeErrWith_objectContainingAWrongTag_fails', () => {
    // The positive control: `objectContaining` must be genuinely evaluated,
    // not merely tolerated.
    expect(() =>
      expect(err(notFound({ id: 'u1' }))).toBeErrWith(
        expect.objectContaining({ type: 'forbidden' }),
      ),
    ).toThrow(/Expected Err to equal/);
  });

  it('toBeOkWith_expectAny_matchesByConstructor', () => {
    expect(ok('hello')).toBeOkWith(expect.any(String));
  });

  it('toBeOkWith_expectAnything_rejectsAnOkCarryingNull', () => {
    // `expect.anything()` excludes null/undefined — so this documents that an
    // `ok(null)` is still an Ok while failing the payload assertion.
    expect(ok(null)).toBeOk();
    expect(() => expect(ok(null)).toBeOkWith(expect.anything())).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOkWith_arrayContaining_passesOnAPartialArray', () => {
    expect(ok([1, 2, 3])).toBeOkWith(expect.arrayContaining([2]));
  });
});

// ---------------------------------------------------------------------------
// Validation — the subject is not a Result at all
// ---------------------------------------------------------------------------

describe('a subject that is not a Result', () => {
  // A usage error, not an assertion outcome. Returning `pass: false` would make
  // the negated form *succeed* on a subject the matcher never understood.
  const notResults: [label: string, subject: unknown][] = [
    ['a number', 42],
    ['a string', 'ok'],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { value: 1 }],
    ['a string ok', { ok: 'yes', value: 1 }],
    ['a truthy non-boolean ok', { ok: 1, value: 1 }],
    ['an array', [1, 2]],
    ['a bare function', () => {}],
    ['a Promise of a Result', Promise.resolve(ok(1))],
    ['a boxed Boolean ok', { ok: new Boolean(true) }],
  ];

  const matcherNames = [
    'toBeOk',
    'toBeErr',
    'toBeOkWith',
    'toBeErrWith',
  ] as const;

  it.each(notResults)('toBeOk_%s_throws', (_label, subject) => {
    expect(() => expect(subject).toBeOk()).toThrow(/expected a Result/);
  });

  it.each(notResults)('toBeErr_%s_throws', (_label, subject) => {
    expect(() => expect(subject).toBeErr()).toThrow(/expected a Result/);
  });

  it.each(matcherNames)('%s_namesItselfInTheThrownMessage', (name) => {
    // The caller needs to know which assertion rejected the subject.
    const call = () =>
      (expect(42) as unknown as Record<string, (e?: unknown) => void>)[name]!(
        'anything',
      );

    expect(call).toThrow(new RegExp(`^${name}:`));
  });

  it('toBeOk_negatedOnANonResult_stillThrows', () => {
    // The whole reason this is a throw and not `pass: false`: a `pass: false`
    // would make this line *succeed*.
    expect(() => expect(42).not.toBeOk()).toThrow(/expected a Result/);
  });

  it('toBeErrWith_negatedOnANonResult_stillThrows', () => {
    expect(() => expect(42).not.toBeErrWith('boom')).toThrow(
      /expected a Result/,
    );
  });

  it('nonResult_isRenderedInTheMessage', () => {
    expect(() => expect({ value: 1 }).toBeOk()).toThrow('{"value":1}');
  });

  it('undefinedSubject_isNamedRatherThanElided', () => {
    // `JSON.stringify(undefined)` is `undefined`, not a string — without the
    // `??` fallback the message would read "received undefined" only by luck.
    expect(() => expect(undefined).toBeOk()).toThrow('received undefined');
  });
});

// ---------------------------------------------------------------------------
// Broken state — subjects whose *rendering* is hostile
// ---------------------------------------------------------------------------

describe('a non-Result the guard cannot JSON-serialize', () => {
  // Regression: each of these made `JSON.stringify` (or `String`) throw from
  // inside the guard, replacing the guard's own diagnostic with a worse one at
  // exactly the moment the caller is already confused about what they passed.
  const hostile: [label: string, subject: () => unknown][] = [
    [
      'a circular object',
      () => {
        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;
        return circular;
      },
    ],
    ['a BigInt', () => 10n],
    ['a Symbol', () => Symbol('nope')],
    [
      'an object with a throwing toJSON',
      () => ({
        toJSON() {
          throw new Error('nope');
        },
      }),
    ],
  ];

  it.each(hostile)('toBeOk_%s_stillReportsTheGuardMessage', (_label, make) => {
    expect(() => expect(make()).toBeOk()).toThrow(/expected a Result/);
  });

  it.each(hostile)(
    'toBeErrWith_%s_stillReportsTheGuardMessage',
    (_label, make) => {
      expect(() => expect(make()).toBeErrWith('boom')).toThrow(
        /expected a Result/,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Failure messages
// ---------------------------------------------------------------------------

describe('failure messages', () => {
  it('toBeOkWith_payloadMismatch_namesBothSides', () => {
    const call = () => expect(ok({ id: 'u1' })).toBeOkWith({ id: 'u2' });

    expect(call).toThrow(/Expected Ok to equal/);
    expect(call).toThrow(/Received Ok/);
    expect(call).toThrow(/u1/);
    expect(call).toThrow(/u2/);
  });

  it('toBeOkWith_negatedOnAMatchingValue_saysNotToEqual', () => {
    // The `isNot` arm of the authored message — the one message in this module
    // that is not delegated, and its only uncovered direction.
    expect(() => expect(ok(1)).not.toBeOkWith(1)).toThrow(
      /Expected Ok not to equal/,
    );
  });

  it('toBeErrWith_negatedOnAMatchingError_saysNotToEqual', () => {
    expect(() => expect(err('boom')).not.toBeErrWith('boom')).toThrow(
      /Expected Err not to equal/,
    );
  });

  it('toBeOkWith_payloadMismatch_carriesTheMatcherHint', () => {
    expect(() => expect(ok(1)).toBeOkWith(2)).toThrow(/toBeOkWith/);
  });

  it('toBeOk_errCarryingATypedError_rendersTheWholeErrorNotJustItsTag', () => {
    // The wrong-branch message is the diagnostic that matters most, so it must
    // carry the payload. #67 will prettify it; this pins that it is not empty
    // in the meantime.
    expect(() => expect(err(notFound({ id: 'u1' }))).toBeOk()).toThrow(
      'Expected Ok, got Err: ' + JSON.stringify(notFound({ id: 'u1' })),
    );
  });

  it('everyMatcherFailure_producesANonEmptyMessage', () => {
    // The empty-message bug was invisible to `toThrow()` with no argument —
    // an empty message still throws. This is the guard against its whole class.
    const failures: (() => void)[] = [
      () => expect(err('boom')).toBeOk(),
      () => expect(ok(1)).not.toBeOk(),
      () => expect(ok(1)).toBeErr(),
      () => expect(err('boom')).not.toBeErr(),
      () => expect(err('boom')).toBeOkWith(1),
      () => expect(ok(1)).toBeOkWith(2),
      () => expect(ok(1)).not.toBeOkWith(1),
      () => expect(ok(1)).toBeErrWith('boom'),
      () => expect(err('boom')).toBeErrWith('bang'),
      () => expect(err('boom')).not.toBeErrWith('boom'),
    ];

    for (const failure of failures) {
      expect(failure).toThrow(/\S/);
    }
  });
});

// ---------------------------------------------------------------------------
// Weird but reachable
// ---------------------------------------------------------------------------

describe('surprising-but-reachable usage', () => {
  it('toBeOkWith_throughTheResolvesChain_passes', async () => {
    // The shape most application tests actually take.
    await expect(Promise.resolve(ok({ kind: 'noop' }))).resolves.toBeOkWith({
      kind: 'noop',
    });
  });

  it('toBeErr_throughTheResolvesChain_passes', async () => {
    await expect(Promise.resolve(err('boom'))).resolves.toBeErr();
  });

  it('toBeOk_doesNotMutateTheSubject', () => {
    const result = ok({ id: 'u1' });
    const before = structuredClone(result);

    expect(result).toBeOk();
    expect(result).toBeOkWith({ id: 'u1' });

    expect(result).toEqual(before);
  });

  it('toBeOk_isIdempotentAcrossRepeatedAssertions', () => {
    // The matchers hold no state between calls; a lazily-built message must
    // not be consumed by the first assertion.
    const result = ok(1);

    expect(result).toBeOk();
    expect(result).toBeOk();
    expect(() => expect(result).toBeErr()).toThrow('Expected Err, got Ok: 1');
    expect(() => expect(result).toBeErr()).toThrow('Expected Err, got Ok: 1');
  });

  it.each(BRANCHES)(
    '$matcher_and_its_opposite_areExactComplements',
    ({ match, miss }) => {
      // Whatever the subject, exactly one of toBeOk/toBeErr holds. A guard that
      // let both pass — or neither — would be a broken discriminant.
      for (const subject of [match(), miss()]) {
        const isOkHalf = (subject as { ok: boolean }).ok;

        if (isOkHalf) {
          expect(subject).toBeOk();
          expect(subject).not.toBeErr();
        } else {
          expect(subject).toBeErr();
          expect(subject).not.toBeOk();
        }
      }
    },
  );

  it('toBeOkWith_okCarryingAResult_comparesTheInnerResultStructurally', () => {
    // A nested Result is ordinary data — nothing here unwraps it.
    expect(ok(err('inner'))).toBeOkWith(err('inner'));
    expect(ok(err('inner'))).toBeOk();
    expect(ok(err('inner'))).not.toBeErr();
  });

  it('toBeOkWith_aVeryLongCollection_stillCompares', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => i);

    expect(ok(big)).toBeOkWith([...big]);
    expect(() => expect(ok(big)).toBeOkWith([...big, 1])).toThrow(
      /Expected Ok to equal/,
    );
  });
});

// ---------------------------------------------------------------------------
// The exported surface
// ---------------------------------------------------------------------------

describe('the matcher bag', () => {
  it('resultMatchers_exposesExactlyTheFourMatchers', () => {
    expect(Object.keys(resultMatchers).sort()).toEqual([
      'toBeErr',
      'toBeErrWith',
      'toBeOk',
      'toBeOkWith',
    ]);
  });

  it('resultMatchers_everyEntryIsAFunction', () => {
    for (const matcher of Object.values(resultMatchers)) {
      expect(typeof matcher).toBe('function');
    }
  });
});
