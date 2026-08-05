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
 * The message a failing assertion threw.
 *
 * Needed wherever a test compares two failure messages to each other rather
 * than to a literal — the regressions where two distinct payloads rendered
 * identically are only visible that way.
 */
const messageOf = (failing: () => void): string => {
  try {
    failing();
  } catch (thrown) {
    return (thrown as Error).message;
  }

  throw new Error('expected the assertion to fail, but it passed');
};

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
// Broken state — a *Result* whose payload is hostile to render
// ---------------------------------------------------------------------------

describe('a Result whose payload the delegated message cannot serialize', () => {
  // The block above covers the *guard* path — a non-Result subject. This is the
  // other one, and it was the gap: the guard had a hardened renderer while the
  // delegated wrong-branch message still went through a bare `JSON.stringify`.
  // Same class of bug, one path fixed and one not, and every test here was red
  // before `renderPayload` landed.
  const hostilePayloads: [label: string, make: () => unknown][] = [
    [
      'a circular object',
      () => {
        const node: Record<string, unknown> = { type: 'not_found' };
        node.self = node;
        return node;
      },
    ],
    ['a BigInt', () => 10n],
    ['an object carrying a BigInt id', () => ({ type: 'conflict', id: 10n })],
    [
      'an object with a throwing toJSON',
      () => ({
        toJSON() {
          throw new Error('nope');
        },
      }),
    ],
    ['a real Error', () => new Error('kaboom')],
    ['a Symbol', () => Symbol('session')],
    [
      // The delegated message reads the payload's *prototype* before any of its
      // own guards run, so a revoked Proxy replaced the branch message with the
      // proxy's own TypeError — the same class of crash as the circular one
      // above, arriving through a trap rather than through the serializer.
      'a revoked Proxy',
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
  ];

  it.each(hostilePayloads)(
    'toBeOk_errCarrying_%s_reportsTheWrongBranchNotASerializerCrash',
    (_label, make) => {
      // The regression in one line: this used to throw
      // `TypeError: Converting circular structure to JSON`, answering a
      // question the caller never asked.
      expect(() => expect(err(make())).toBeOk()).toThrow(/^Expected Ok, got Err/);
    },
  );

  it.each(hostilePayloads)(
    'toBeErr_okCarrying_%s_reportsTheWrongBranchNotASerializerCrash',
    (_label, make) => {
      expect(() => expect(ok(make())).toBeErr()).toThrow(/^Expected Err, got Ok/);
    },
  );

  it.each(hostilePayloads)(
    'toBeOkWith_errCarrying_%s_reportsTheWrongBranchNotASerializerCrash',
    (_label, make) => {
      expect(() => expect(err(make())).toBeOkWith(1)).toThrow(
        /^Expected Ok, got Err/,
      );
    },
  );

  it.each(hostilePayloads)(
    'toBeOk_negatedOnAnOkCarrying_%s_reportsTheOppositeMessage',
    (_label, make) => {
      // The `.not` direction reaches the same delegation through the other arm
      // of `branch`, so it needs its own pass.
      expect(() => expect(ok(make())).not.toBeOk()).toThrow(
        /^Expected Err, got Ok/,
      );
    },
  );

  it('toBeOk_errCarryingACircularObject_stillNamesTheErrorType', () => {
    // Not just "does not crash": the useful part of the payload must survive.
    // Bailing to `[object Object]` would satisfy every test above.
    const node: Record<string, unknown> = { type: 'not_found', id: 'u1' };
    node.self = node;

    const call = () => expect(err(node)).toBeOk();

    expect(call).toThrow(/not_found/);
    expect(call).toThrow(/u1/);
    expect(call).toThrow(/\[Circular\]/);
  });

  it('toBeOk_errCarryingARealError_reportsItsMessageRatherThanEmptyBraces', () => {
    // `JSON.stringify(new Error('kaboom'))` is `'{}'`, so the most common Err
    // payload of all — what any try/catch wrapper produces — used to render as
    // nothing at all while still technically "passing" a non-empty check.
    expect(() => expect(err(new Error('kaboom'))).toBeOk()).toThrow(
      'Expected Ok, got Err: Error: kaboom',
    );
  });

  it('toBeOk_errCarryingASymbol_isDistinguishableFromErrUndefined', () => {
    // Both used to render as the literal text `undefined`: `JSON.stringify`
    // returns undefined, not a string, for a symbol. Two distinct causes, one
    // identical message.
    const ofSymbol = messageOf(() => expect(err(Symbol('session'))).toBeOk());
    const ofUndefined = messageOf(() => expect(err(undefined)).toBeOk());

    expect(ofSymbol).not.toBe(ofUndefined);
    expect(ofSymbol).toContain('Symbol(session)');
  });

  it('toBeOk_errCarryingABigInt_isDistinguishableFromTheSameNumber', () => {
    const ofBigInt = messageOf(() => expect(err(10n)).toBeOk());
    const ofNumber = messageOf(() => expect(err(10)).toBeOk());

    expect(ofBigInt).not.toBe(ofNumber);
    expect(ofBigInt).toContain('10n');
  });

  it('everyHostilePayload_producesAMessageNamingTheBranch', () => {
    // The class guard, in the shape the empty-message bug taught: `toThrow()`
    // with no argument is satisfied by a message that says nothing useful, and
    // `/\S/` is satisfied by `TypeError: Converting circular structure`. Only
    // asserting on the *branch wording* rules out both.
    for (const [, make] of hostilePayloads) {
      expect(messageOf(() => expect(err(make())).toBeOk())).toMatch(
        /^Expected Ok, got Err: \S/,
      );
    }
  });
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
    // carry the payload. This asserted the interim `JSON.stringify` form and
    // said in its own comment that #67 would replace it; the exact wording now
    // lives in the "#67" group at the bottom of this file, so what is left here
    // is the durable claim — the tag alone is not enough.
    const message = messageOf(() => expect(err(notFound({ id: 'u1' }))).toBeOk());

    expect(message).toContain('not_found');
    expect(message).toContain('User u1 not found');
    expect(message).toContain('u1');
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

describe('the payload matchers under .not, on the wrong branch', () => {
  // Measured, then pinned. The branch matchers *throw* on a subject they cannot
  // understand, so it is worth stating why these merely fail instead: an Err
  // genuinely is not "an Ok whose value is 1", so `pass: false` is the honest
  // answer and negating it is a real pass — unlike the non-Result case, where
  // `pass: false` would report green about a subject nobody understood.
  it('toBeOkWith_negatedOnAnErr_passes', () => {
    expect(err('boom')).not.toBeOkWith(1);
  });

  it('toBeErrWith_negatedOnAnOk_passes', () => {
    expect(ok(1)).not.toBeErrWith('boom');
  });

  it('toBeOkWith_negatedOnAnErr_passesWhateverTheExpectedValue', () => {
    // It is the *branch*, not the payload, that decides this — so no expected
    // value can make it fail.
    expect(err('boom')).not.toBeOkWith('boom');
  });
});

describe('vitest integration surfaces', () => {
  it('toBeOkWith_honoursACustomEqualityTester', () => {
    // `this.customTesters` is spread into `this.equals`; dropping it would make
    // the matchers quietly ignore testers every other matcher respects.
    class Money {
      constructor(readonly cents: number) {}
    }

    expect.addEqualityTesters([
      function moneyTester(a: unknown, b: unknown): boolean | undefined {
        if (a instanceof Money && b instanceof Money) return a.cents === b.cents;
        return undefined;
      },
    ]);

    expect(ok(new Money(100))).toBeOkWith(new Money(100));
    // The positive control: a tester that returned `true` for everything would
    // pass the line above just as happily.
    expect(() => expect(ok(new Money(100))).toBeOkWith(new Money(101))).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOk_throughExpectSoft_doesNotThrowOnAPassingAssertion', () => {
    expect.soft(ok(1)).toBeOk();
  });

  it('toBeOk_throughExpectPoll_resolves', async () => {
    await expect.poll(() => ok(1) as unknown, { timeout: 300 }).toBeOk();
  });

  it('toBeOk_throughTheRejectsChain_passes', async () => {
    // A rejected promise carrying a Result is odd but reachable, and the
    // matcher sees the rejection reason like any other subject.
    await expect(Promise.reject(ok(1))).rejects.toBeOk();
  });

  it('resultMatchers_survivesBeingRegisteredTwice', () => {
    // Two setup files, or a setup file plus a stray in-test `expect.extend`.
    expect.extend(resultMatchers);

    expect(ok(1)).toBeOk();
    expect(() => expect(ok(1)).toBeErr()).toThrow('Expected Err, got Ok: 1');
  });
});

describe('the structural check — subjects that are Results by any honest reading', () => {
  it('toBeOk_okDefinedAsAGetter_passes', () => {
    // §2 is structural, and a getter satisfies it. Nothing here may demand an
    // own data property.
    expect({
      get ok() {
        return true;
      },
      value: 1,
    }).toBeOk();
  });

  it('toBeOk_okInheritedFromThePrototype_passes', () => {
    // Same reasoning as the callable case above: tsc assigns this to `Result`,
    // so a guard that rejected it would be narrower than the type it gates.
    expect(Object.create({ ok: true, value: 5 }) as unknown).toBeOk();
  });

  it('toBeOk_frozenResult_passes', () => {
    // A frozen Result is the common shape once `Object.freeze` is in play, and
    // nothing in the matchers writes to the subject.
    expect(Object.freeze(ok(1))).toBeOk();
  });

  it('toBeOk_subjectWhoseOkGetterThrows_propagatesRatherThanReportingGreen', () => {
    // Pinned as a known limit, not as a feature: a subject that explodes on
    // read cannot be classified, and the throw surfaces it. What matters is
    // that it does not silently pass.
    const hostile = new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        if (key === 'ok') throw new Error('getter exploded');
        return undefined;
      },
    });

    expect(() => expect(hostile).toBeOk()).toThrow('getter exploded');
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

// ---------------------------------------------------------------------------
// #67 — the enrichment arrives by delegation
// ---------------------------------------------------------------------------

/**
 * The claim `src/testing/index.ts` has made since #63: because every
 * wrong-branch message is *delegated* to `expectOk` / `expectErr`, enriching
 * those reaches the matchers with no edit under `src/testing/`. #67 is the
 * first real test of that claim, and these are what make it a fact rather than
 * a comment — the whole group would still be needed if someone "helpfully"
 * inlined a message back into a matcher.
 */
describe('prettified typed errors reach the matchers unedited', () => {
  const block =
    'Expected Ok, got Err:\n' +
    '  ✖ not_found: User u1 not found\n' +
    '    details: {"id":"u1"}';

  it('toBeOk_errCarryingATypedError_showsThePrettifiedBlock', () => {
    expect(() => expect(err(notFound({ id: 'u1' }))).toBeOk()).toThrow(block);
  });

  it('toBeOkWith_errCarryingATypedError_showsThePrettifiedBlock', () => {
    // Wrong-branch still beats wrong-payload, and now the wrong-branch message
    // is the rich one — which is what made that precedence worth keeping.
    expect(() =>
      expect(err(notFound({ id: 'u1' }))).toBeOkWith('anything'),
    ).toThrow(block);
  });

  it('toBeErr_negatedOnAnErr_showsThePrettifiedBlock', () => {
    // The `.not` direction reaches the same delegated message through the
    // opposite arm, so the enrichment must not be polarity-dependent.
    expect(() => expect(err(notFound({ id: 'u1' }))).not.toBeErr()).toThrow(
      block,
    );
  });

  it('toBeErr_okCarryingANonTypedValue_isUnchanged', () => {
    // The guardrail: only §3-shaped payloads moved. Every other matcher
    // message is byte-for-byte what #63 shipped.
    expect(messageOf(() => expect(ok(1)).toBeErr())).toBe(
      'Expected Err, got Ok: 1',
    );
  });

  it('toBeOk_errCarryingAWireRoundTrippedTypedError_prettifiesToo', () => {
    // §2.1's round-trip strips nothing a typed error needs, so the message a
    // consumer sees for an error that crossed a boundary is the same one.
    expect(() => expect(err(overTheWire(notFound({ id: 'u1' })))).toBeOk()).toThrow(
      block,
    );
  });

  it('asResult_guardMessage_staysASingleLineSentence', () => {
    // The one message that deliberately did *not* follow: the guard reports a
    // subject that is not a Result at all, inside a sentence. A block there
    // would read as a broken sentence and would be answering a different
    // question.
    const message = messageOf(() =>
      (expect(notFound({ id: 'u1' })) as { toBeOk: () => void }).toBeOk(),
    );

    expect(message).not.toContain('\n');
    expect(message).toContain('expected a Result');
  });

  it('asResult_nonResultErrorWhoseMessageSpansLines_staysASingleLineSentence', () => {
    // `expect(caught).toBeOk()` on a caught `Error` is the realistic way a
    // non-`Result` reaches the guard, and a multi-line `message` — a query, an
    // aggregated report — is ordinary. `renderPayload` interpolated it raw, so
    // the "sentence" above broke apart into three lines.
    const message = messageOf(() =>
      (expect(new Error('first\nsecond')) as { toBeOk: () => void }).toBeOk(),
    );

    expect(message).not.toContain('\n');
    expect(message).toContain('Error: first\\nsecond');
  });
});
