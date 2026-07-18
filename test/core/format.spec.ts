import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  combineWithAllErrors,
  defineError,
  err,
  groupByType,
  ok,
  prettifyErrors,
} from '../../src/index';
import type { TypedError } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` below is enforced by `pnpm check`, NOT by
 * `pnpm test` — vitest.config.ts sets no `typecheck`, so these are runtime
 * no-ops under `vitest run`.
 *
 * ADR 0010: these are the two formatters that survive having no `path`. The
 * narrowing assertions are the point of `groupByType` — a userland
 * `Object.groupBy` gets the same runtime shape and loses the discriminant.
 */

const notFound = defineError(
  'not_found',
  (d: { id: string }) => `No user ${d.id}`,
);
const forbidden = defineError('forbidden', 'Not permitted');
const conflict = defineError('conflict', 'Already exists');

type NotFound = ReturnType<typeof notFound>;
type Forbidden = ReturnType<typeof forbidden>;
type Conflict = ReturnType<typeof conflict>;
type AppError = NotFound | Forbidden | Conflict;

/**
 * A function stub, not an annotated const, for the reason the sibling specs
 * record: an annotated `const` is narrowed by control-flow analysis to the
 * constructed variant despite the annotation, so the union it is meant to
 * represent never reaches the assertion.
 */
const appErrors = (): AppError[] => [
  notFound({ id: 'u1' }),
  forbidden(),
  notFound({ id: 'u2' }),
];

describe('groupByType — keying on the discriminant', () => {
  it('groupByType_errorsOfSeveralTypes_keysEachByItsType', () => {
    const groups = groupByType(appErrors());

    expect(Object.keys(groups).sort()).toEqual(['forbidden', 'not_found']);
  });

  it('groupByType_severalErrorsOfOneType_collectsThemAll', () => {
    const groups = groupByType(appErrors());

    expect(groups.not_found).toHaveLength(2);
  });

  it('groupByType_severalErrorsOfOneType_preservesInputOrder', () => {
    const groups = groupByType(appErrors());

    expect(groups.not_found?.map((e) => e.details?.id)).toEqual(['u1', 'u2']);
  });

  it('groupByType_aVariantThatDidNotOccur_getsNoKey', () => {
    const groups = groupByType(appErrors());

    // `conflict` is in the union but not in the data — the honest answer is an
    // absent key, which is why the return type is partial (ADR 0010 §3).
    expect('conflict' in groups).toBe(false);
  });

  it('groupByType_emptyInput_returnsAnEmptyObject', () => {
    const groups = groupByType([]);

    expect(groups).toEqual({});
  });

  it('groupByType_groupedErrors_areTheSameObjectsNotCopies', () => {
    const errors = appErrors();
    const groups = groupByType(errors);

    expect(groups.forbidden?.[0]).toBe(errors[1]);
  });

  it('groupByType_result_isAPartialRecordNarrowedPerVariant', () => {
    const groups = groupByType(appErrors());

    expectTypeOf(groups).toEqualTypeOf<{
      not_found?: NotFound[];
      forbidden?: Forbidden[];
      conflict?: Conflict[];
    }>();
  });

  it('groupByType_aGroupsElement_keepsItsNarrowedVariantType', () => {
    const groups = groupByType(appErrors());
    const found = groups.not_found;

    // The whole value of grouping on the discriminant: `details` is the
    // variant's own payload, not the union's.
    expectTypeOf(found).toEqualTypeOf<NotFound[] | undefined>();
    expectTypeOf(found?.[0]?.details).toEqualTypeOf<
      { id: string } | undefined
    >();
  });

  it('groupByType_aSingleVariantInput_stillKeysByThatType', () => {
    const groups = groupByType([forbidden(), forbidden()]);

    expect(groups.forbidden).toHaveLength(2);
  });
});

describe('prettifyErrors — the human-readable line per error', () => {
  it('prettify_severalErrors_emitsOneLinePerError', () => {
    const text = prettifyErrors([notFound({ id: 'u1' }), forbidden()]);

    expect(text.split('\n')).toHaveLength(2);
  });

  it('prettify_anError_rendersMarkerTypeAndMessage', () => {
    const text = prettifyErrors([notFound({ id: 'u1' })]);

    expect(text).toBe('✖ not_found: No user u1');
  });

  it('prettify_severalErrors_preservesInputOrder', () => {
    const text = prettifyErrors([forbidden(), notFound({ id: 'u1' })]);

    expect(text).toBe('✖ forbidden: Not permitted\n✖ not_found: No user u1');
  });

  it('prettify_emptyInput_returnsAnEmptyString', () => {
    // Not a placeholder like "no errors" — a formatter that invents text for
    // the empty case cannot be composed into a larger message (ADR 0010 §4).
    expect(prettifyErrors([])).toBe('');
  });

  it('prettify_anErrorWithAStaticMessage_doesNotReadTheDetailsPayload', () => {
    const audit = defineError.withData<{ token: string }>()(
      'audit',
      'Audit failed',
    );

    const text = prettifyErrors([audit({ token: 'secret-token' })]);

    expect(text).toBe('✖ audit: Audit failed');
  });

  it('prettify_aMessageDerivedFromThePayload_stillShowsWhatTheMessageSays', () => {
    // The sharp edge, pinned rather than left to be discovered: `prettifyErrors`
    // never reads `details`, but `defineError` lets the *message* be computed
    // from the payload — so this is NOT a redaction guarantee. Anything the
    // message author interpolated is already in `message`.
    const text = prettifyErrors([notFound({ id: 'secret-tenant-id' })]);

    expect(text).toBe('✖ not_found: No user secret-tenant-id');
  });

  it('prettify_anyInput_returnsAString', () => {
    expectTypeOf(prettifyErrors(appErrors())).toEqualTypeOf<string>();
  });
});

describe('the accumulation story, end to end', () => {
  it('combineWithAllErrors_thenGroupByType_keysTheAccumulatedErrors', () => {
    const combined = combineWithAllErrors([
      ok(1),
      err(notFound({ id: 'u1' })),
      err(forbidden()),
    ]);
    const groups = combined.ok ? {} : groupByType(combined.error);

    expect(Object.keys(groups).sort()).toEqual(['forbidden', 'not_found']);
  });

  it('combineWithAllErrors_thenPrettify_rendersEveryAccumulatedError', () => {
    const combined = combineWithAllErrors([
      ok(1),
      err(notFound({ id: 'u1' })),
      err(forbidden()),
    ]);
    const text = combined.ok ? '' : prettifyErrors(combined.error);

    expect(text).toBe('✖ not_found: No user u1\n✖ forbidden: Not permitted');
  });
});

/**
 * §2 / §3 make `TypedError` **purely structural**: any `{ type, message }` is
 * one, whoever built it, and `type` is an ordinary `string` carrying domain
 * vocabulary. So a variant tagged `'constructor'` is entirely valid — and an
 * accumulator built on an object literal finds `Object.prototype`'s member
 * instead of its own, which is a data-dependent crash rather than a wrong value.
 *
 * `Object.groupBy` returns a null-prototype object for exactly this reason; so
 * does this. `.claude/rules/testing.md` requires malicious input to produce a
 * controlled result, never a crash.
 */
describe('a type colliding with Object.prototype', () => {
  const hostile = (type: string): TypedError<string> => ({
    type,
    message: 'Collides with a prototype member',
  });

  const COLLIDING = [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ] as const;

  it.each(COLLIDING)('groupByType_typeIs_%s_doesNotThrow', (type) => {
    expect(() => groupByType([hostile(type)])).not.toThrow();
  });

  it.each(COLLIDING)('groupByType_typeIs_%s_groupsItUnderThatKey', (type) => {
    expect(groupByType([hostile(type)])[type]).toHaveLength(1);
  });

  it.each(COLLIDING)('groupByType_typeIs_%s_isAnOwnEnumerableKey', (type) => {
    // `__proto__` on an object literal invokes the prototype *setter*, so the
    // key silently never appears in `Object.keys` — grouped, then lost.
    expect(Object.keys(groupByType([hostile(type)]))).toContain(type);
  });

  it('groupByType_result_hasANullPrototype', () => {
    expect(Object.getPrototypeOf(groupByType([hostile('normal')]))).toBeNull();
  });

  it('groupByType_hostileInput_doesNotPolluteObjectPrototype', () => {
    groupByType([hostile('__proto__')]);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('prettify_typeCollidingWithAPrototypeMember_rendersNormally', () => {
    expect(prettifyErrors([hostile('toString')])).toBe(
      '✖ toString: Collides with a prototype member',
    );
  });
});

describe('a hand-written TypedError, not built by defineError', () => {
  // §3's convention is structural — `defineError` is a convenience, not a gate.
  const handMade: TypedError<'manual'> = {
    type: 'manual',
    message: 'Written by hand',
  };

  it('groupByType_aHandWrittenTypedError_keysItTheSameWay', () => {
    expect(groupByType([handMade]).manual).toEqual([handMade]);
  });

  it('prettify_aTypedErrorWithNoDetails_rendersTypeAndMessage', () => {
    expect(prettifyErrors([handMade])).toBe('✖ manual: Written by hand');
  });
});
