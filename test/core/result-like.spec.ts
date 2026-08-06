import { describe, expect, it } from 'vitest';

import { combine } from '../../src/index';
import { isResultLike, readOk } from '../../src/core/result-like';
import { resultMatchers } from '../../src/testing/index';
import type { Result } from '../../src/index';

/**
 * `isResultLike` is internal — not in §5.9's export list and never reachable
 * from the barrel — so this imports the module directly, the way
 * `thenable.spec.ts` and `render.spec.ts` do for theirs.
 *
 * Its whole reason for existing is that it is **one decision with two callers**:
 * §5.4's combinators and the `/testing` matchers' non-`Result` guard. The two
 * copies it replaced existed for a single commit and had already drifted, so the
 * suite is in two halves — the guard's own verdict per value class, and then
 * the *same table* pushed through both callers, which is the only thing that
 * can prove the drift cannot come back.
 */

/** The value classes the two copies disagreed on, plus the ones they might. */
const admitted: [name: string, value: unknown][] = [
  ['a plain Ok', { ok: true, value: 1 }],
  ['a plain Err', { ok: false, error: 'boom' }],
  ['an Ok with no value key (the §2.1 round trip of ok())', { ok: true }],
  ['an Ok carrying extra properties', { ok: true, value: 1, traceId: 'abc' }],
  ['a callable carrying ok', Object.assign(() => {}, { ok: true, value: 1 })],
  ['an object inheriting ok from its prototype', Object.create({ ok: true, value: 1 })],
  ['an Object.create(null) bag carrying ok', Object.assign(Object.create(null), { ok: true, value: 1 })],
  ['a frozen Ok', Object.freeze({ ok: true, value: 1 })],
  ['a class instance with a boolean ok', new (class { readonly ok = true; readonly value = 1 })()],
  ['an ok exposed as a getter rather than a data property', { get ok(): boolean { return true }, value: 1 }],
];

const rejected: [name: string, value: unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['a string', 'ok'],
  ['a symbol', Symbol('ok')],
  ['a bigint', 1n],
  ['a bare object', {}],
  ['an object whose ok is a truthy non-boolean', { ok: 1, value: 1 }],
  ['an object whose ok is the string "true"', { ok: 'true', value: 1 }],
  ['a boxed Boolean as ok', { ok: new Boolean(true), value: 1 }],
  ['an array', [{ ok: true, value: 1 }]],
  ['a function with no ok', () => {}],
];

describe('isResultLike', () => {
  it.each(admitted)('admits %s', (_name, value) => {
    expect(isResultLike(value)).toBe(true);
  });

  it.each(rejected)('rejects %s', (_name, value) => {
    expect(isResultLike(value)).toBe(false);
  });

  it('okGetterThatThrows_propagatesRatherThanQuietlyPassing', () => {
    // The one place this differs from `renderPayload` and `schema.ts`'s
    // classifier, which swallow. Those are *reporters*; this is a *classifier*,
    // and a subject that explodes on read cannot be classified. What matters is
    // that it does not silently answer `true`.
    const exploding = {
      get ok(): boolean {
        throw new RangeError('ok exploded');
      },
    };

    expect(() => isResultLike(exploding)).toThrow(RangeError);
  });

  it('revokedProxy_propagatesRatherThanQuietlyPassing', () => {
    const { proxy, revoke } = Proxy.revocable({ ok: true, value: 1 }, {});
    revoke();

    expect(() => isResultLike(proxy)).toThrow(TypeError);
  });

  it('proxyWhoseHasTrapLies_isJudgedByTheGetTrapOnly', () => {
    // The check reads `.ok`; it never asks `in`. A `has` trap claiming the key
    // is absent must not change the verdict, or the two callers' agreement
    // would rest on which probe each happened to use — the exact drift the
    // extraction removed.
    const proxy = new Proxy(
      { ok: true, value: 1 },
      { has: () => false },
    );

    expect(isResultLike(proxy)).toBe(true);
  });
});

/**
 * The agreement half.
 *
 * A divergence here is precisely the class of bug the extraction was meant to
 * prevent, so the two callers are asked the *same* question about the *same*
 * values rather than each being tested against its own hand-written table.
 */
describe('the shared guard is shared', () => {
  /** What §5.4's combinators make of a value: admitted, or the named throw. */
  const combinatorVerdict = (value: unknown): boolean => {
    const bag = { entry: value } as unknown as Record<string, Result<unknown, unknown>>;

    try {
      combine(bag);
      return true;
    } catch {
      return false;
    }
  };

  /** What the `/testing` matchers make of it, via their `asResult` guard. */
  const matcherVerdict = (value: unknown): boolean => {
    try {
      resultMatchers.toBeOk.call(
        undefined as never,
        value,
      );
      return true;
    } catch {
      return false;
    }
  };

  it.each([...admitted, ...rejected])(
    'combinators and matchers agree about %s',
    (_name, value) => {
      expect(combinatorVerdict(value)).toBe(matcherVerdict(value));
    },
  );

  it('bothCallersAdmitACallable_soNeitherIsNarrowerThanTheTypeItGates', () => {
    // The clause the two copies had already drifted on: a function carrying
    // `ok: true` is structurally an `Ok` and tsc assigns it, so a guard
    // rejecting it would be narrower than the type it gates (§10.9's reason for
    // widening `isTypedError`).
    const callable = Object.assign(() => {}, { ok: true as const, value: 1 });

    expect(combinatorVerdict(callable)).toBe(true);
    expect(matcherVerdict(callable)).toBe(true);
  });

  it('bothCallersLetAThrowingOkGetterEscape_soTheLimitIsOneLimit', () => {
    const exploding = {
      get ok(): boolean {
        throw new RangeError('ok exploded');
      },
    };

    expect(() => combine({ a: exploding } as never)).toThrow(RangeError);
    expect(() => resultMatchers.toBeOk.call(undefined as never, exploding)).toThrow(
      RangeError,
    );
  });
});

describe('readOk — the single read behind the guard', () => {
  /**
   * `isResultLike` is defined in terms of this, so the two can never disagree
   * about what a `Result` is. It exists because §5.4's combinators must both
   * *classify* an entry and *branch on* it: asking `ok` twice let a getter
   * answer differently between the validating pass and the fold, and the fold
   * took a branch validation had not approved.
   */
  it.each([
    ['a plain Ok', { ok: true, value: 1 }, true],
    ['a plain Err', { ok: false, error: 'boom' }, false],
    ['an Ok with no value key', { ok: true }, true],
    ['a callable carrying ok', Object.assign(() => {}, { ok: false, error: 'x' }), false],
    ['an object inheriting ok', Object.create({ ok: true }) as unknown, true],
  ] as [string, unknown, boolean][])('readOk_%s_returnsTheBranch', (_name, value, branch) => {
    expect(readOk(value)).toBe(branch);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['a string', 'ok'],
    ['a symbol', Symbol('ok')],
    ['a bigint', 10n],
    ['an object with no ok', { value: 1 }],
    ['an object whose ok is truthy but not boolean', { ok: 1, value: 1 }],
    ['an object whose ok is the string "true"', { ok: 'true' }],
    ['a boxed Boolean as ok', { ok: new Boolean(true) }],
  ])('readOk_%s_isUndefined', (_name, value) => {
    // `undefined` is unambiguous as the negative: `ok` is `boolean` by §2, so a
    // `Result` can never produce it.
    expect(readOk(value)).toBeUndefined();
  });

  it('readOk_agreesWithIsResultLikeOnEveryValueClassAbove', () => {
    for (const [, value] of [...admitted, ...rejected]) {
      expect(readOk(value) !== undefined).toBe(isResultLike(value));
    }
  });

  it('readOk_readsTheProperty_exactlyOnce', () => {
    // The property the combinators depend on: one access, so a getter cannot
    // answer the classifier and the fold differently.
    let reads = 0;
    const counted = {
      get ok() {
        reads += 1;
        return true;
      },
    };

    expect(readOk(counted)).toBe(true);
    expect(reads).toBe(1);
  });

  it('readOk_lettingAThrowingGetterEscape_isTheSameLimitIsResultLikeHas', () => {
    const exploding = {
      get ok(): boolean {
        throw new RangeError('ok exploded');
      },
    };

    expect(() => readOk(exploding)).toThrow(RangeError);
    expect(() => isResultLike(exploding)).toThrow(RangeError);
  });
});
