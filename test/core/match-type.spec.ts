import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defineError,
  defineErrors,
  err,
  match,
  matchType,
  ok,
} from '../../src/index';
import type { ErrorsOf, TypedError } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * the type assertions are runtime no-ops under `vitest run`.
 *
 * The type half of this file is the port of the #73 prototype's surviving
 * probes (designs B2 + D2). The prototype's dead candidates — a naked shared
 * `U`, and a `_` arm inside the handler bag — are not reproduced here; they
 * were rejected, and their record is the issue's resolution comment.
 */

const notFound = defineError(
  'not_found',
  (d: { id: string }) => `No user ${d.id}`,
);
const forbidden = defineError('forbidden', 'Not permitted');
const conflict = defineError.withData<{ slug: string }>()(
  'conflict',
  'Already exists',
);

const errors = defineErrors({ notFound, forbidden, conflict });
type AppError = ErrorsOf<typeof errors>;

/**
 * A function stub, not an annotated const, for the reason the sibling specs
 * record: an annotated `const` is narrowed by control-flow analysis to the
 * constructed variant despite the annotation, so the union it is meant to
 * represent never reaches the assertion.
 */
const appError = (which: 'not_found' | 'forbidden' | 'conflict'): AppError => {
  switch (which) {
    case 'not_found':
      return notFound({ id: 'u1' });
    case 'forbidden':
      return forbidden();
    case 'conflict':
      return conflict({ slug: 'dup' });
  }
};

describe('matchType — exhaustive dispatch', () => {
  it('matchType_everyArmSupplied_runsTheOneMatchingTheTag', () => {
    const status = matchType(appError('forbidden'), {
      not_found: () => 404,
      forbidden: () => 403,
      conflict: () => 409,
    });

    expect(status).toBe(403);
  });

  it('matchType_matchingArm_receivesTheErrorItself', () => {
    // The stub, not `notFound({ id: 'u7' })` — a concrete variant would infer
    // `E` as that variant alone, and the sibling arms would be stray.
    const error = appError('not_found');

    const seen = matchType(error, {
      not_found: (e) => e,
      forbidden: (e) => e,
      conflict: (e) => e,
    });

    expect(seen).toBe(error);
  });

  it('matchType_matchingArm_seesItsOwnTypedPayload', () => {
    const slug = matchType(appError('conflict'), {
      not_found: (e) => e.details?.id,
      forbidden: () => undefined,
      conflict: (e) => e.details?.slug,
    });

    expect(slug).toBe('dup');
  });

  it('matchType_onlyTheMatchingArm_isCalled', () => {
    const calls: string[] = [];

    matchType(appError('not_found'), {
      not_found: () => calls.push('not_found'),
      forbidden: () => calls.push('forbidden'),
      conflict: () => calls.push('conflict'),
    });

    expect(calls).toEqual(['not_found']);
  });

  it('matchType_anArmReturningUndefined_returnsUndefined', () => {
    // The runtime dispatches on key *presence*, not on the arm's return value.
    // A `?? fallback` implementation would have swallowed this one.
    const out = matchType(appError('forbidden'), {
      not_found: () => 'nf',
      forbidden: () => undefined,
      conflict: () => 'c',
    });

    expect(out).toBeUndefined();
  });

  it('matchType_composedUnderMatch_mapsAnErrResultToAStatus', () => {
    // The intended composition: §5.3's `match` leaves the `Result`, `matchType`
    // dispatches on the error inside it.
    const result = err(appError('conflict'));

    const status = match(result, {
      ok: () => 200,
      err: (e) =>
        matchType(e, {
          not_found: () => 404,
          forbidden: () => 403,
          conflict: () => 409,
        }),
    });

    expect(status).toBe(409);
  });

  it('matchType_composedUnderMatch_leavesAnOkResultAlone', () => {
    const status = match(ok('fine'), {
      ok: () => 200,
      err: (e: AppError) =>
        matchType(e, {
          not_found: () => 404,
          forbidden: () => 403,
          conflict: () => 409,
        }),
    });

    expect(status).toBe(200);
  });
});

describe('matchType — the fallback parameter', () => {
  it('matchType_tagWithAnArm_prefersTheArmOverTheFallback', () => {
    const status = matchType(
      appError('not_found'),
      { not_found: () => 404 },
      () => 500,
    );

    expect(status).toBe(404);
  });

  it('matchType_tagWithNoArm_callsTheFallback', () => {
    const status = matchType(
      appError('conflict'),
      { not_found: () => 404 },
      () => 500,
    );

    expect(status).toBe(500);
  });

  it('matchType_fallback_receivesTheErrorItself', () => {
    const error = appError('conflict');

    const seen = matchType(error, { not_found: () => null }, (e) => e);

    expect(seen).toBe(error);
  });

  it('matchType_emptyHandlerBag_sendsEveryVariantToTheFallback', () => {
    const status = matchType(appError('forbidden'), {}, (e) => e.type);

    expect(status).toBe('forbidden');
  });

  it('matchType_armExplicitlySetToUndefined_fallsThroughToTheFallback', () => {
    // `{ not_found: undefined }` satisfies the partial bag. Presence of the key
    // is not enough — the value has to be callable.
    const status = matchType(
      appError('not_found'),
      { not_found: undefined },
      () => 500,
    );

    expect(status).toBe(500);
  });

  it('matchType_fallbackReturningUndefined_returnsUndefined', () => {
    const out = matchType(appError('conflict'), { not_found: () => 404 }, () =>
      undefined,
    );

    expect(out).toBeUndefined();
  });
});

describe('matchType — defeating the types', () => {
  it('matchType_tagWithNoArmAndNoFallback_throws', () => {
    // Unreachable with honest types; reachable across a runtime boundary. The
    // alternative is returning `undefined` under a type that promises a value.
    const rogue = {
      type: 'teapot',
      message: 'short and stout',
    } as unknown as AppError;

    expect(() =>
      matchType(rogue, {
        not_found: () => 404,
        forbidden: () => 403,
        conflict: () => 409,
      }),
    ).toThrow('matchType: no handler for error type "teapot"');
  });

  it('matchType_tagNamingAnObjectPrototypeMember_doesNotCallIt', () => {
    // A bare `handlers[error.type]` would find `Object.prototype.constructor`
    // here and call it — returning a value instead of reporting the gap.
    const rogue = {
      type: 'constructor',
      message: 'inherited',
    } as unknown as AppError;

    expect(() =>
      matchType(rogue, {
        not_found: () => 404,
        forbidden: () => 403,
        conflict: () => 409,
      }),
    ).toThrow('matchType: no handler for error type "constructor"');
  });

  it('matchType_tagNamingAnObjectPrototypeMember_reachesTheFallback', () => {
    const rogue = {
      type: 'toString',
      message: 'inherited',
    } as unknown as AppError;

    const status = matchType(rogue, { not_found: () => 404 }, () => 500);

    expect(status).toBe(500);
  });
});

describe('matchType — types (enforced by pnpm check)', () => {
  it('matchType_armsThatAgree_collapsesToTheOneReturnType', () => {
    const out = matchType(appError('not_found'), {
      not_found: () => 404,
      forbidden: () => 403,
      conflict: () => 409,
    });

    expectTypeOf(out).toEqualTypeOf<number>();
  });

  it('matchType_armsThatDiffer_unionsTheirReturnTypes', () => {
    // The naked-`U` signature the #73 prototype rejected made this `unknown`
    // rather than erroring — a silent degradation, worse than §5.3's `match`
    // trap, which at least fails loudly.
    const out = matchType(appError('not_found'), {
      not_found: (e) => e.details!.id,
      forbidden: () => 403,
      conflict: () => 409,
    });

    expectTypeOf(out).toEqualTypeOf<string | number>();
    expectTypeOf(out).not.toBeUnknown();
    expectTypeOf(out).not.toBeAny();
  });

  it('matchType_eachArm_receivesItsNarrowedVariant', () => {
    matchType(appError('not_found'), {
      not_found: (e) => {
        expectTypeOf(e.type).toEqualTypeOf<'not_found'>();
        expectTypeOf(e.details).toEqualTypeOf<{ id: string } | undefined>();
        return 0;
      },
      forbidden: (e) => {
        expectTypeOf(e.type).toEqualTypeOf<'forbidden'>();
        // A no-payload variant is `TypedError<'forbidden', never>`, so
        // `details` is `never | undefined` — i.e. `undefined`.
        expectTypeOf(e.details).toEqualTypeOf<undefined>();
        return 0;
      },
      conflict: (e) => {
        expectTypeOf(e.details).toEqualTypeOf<{ slug: string } | undefined>();
        // @ts-expect-error — `id` is not on the conflict payload
        e.details!.id;
        return 0;
      },
    });
  });

  it('matchType_aMissingArm_isACompileError', () => {
    // @ts-expect-error — no `conflict` arm
    matchType(appError('not_found'), {
      not_found: () => 404,
      forbidden: () => 403,
    });
  });

  it('matchType_anArmForATagNotInTheUnion_isACompileError', () => {
    // The stray-arm clause. Without it this compiles as a dead arm, because a
    // bag with extra keys still satisfies `H extends Arms<E>` and freshness
    // does not fire against a type parameter.
    matchType(appError('not_found'), {
      not_found: () => 404,
      forbidden: () => 403,
      conflict: () => 409,
      // @ts-expect-error — `teapot` is not a variant of AppError
      teapot: () => 418,
    });
  });

  it('matchType_theFallback_seesOnlyTheResidualVariants', () => {
    // The reason the fallback is a third parameter and not a `_` key: only
    // this form knows the bag's key set before the fallback is typed.
    matchType(appError('not_found'), { not_found: () => 404 }, (e) => {
      expectTypeOf(e).toEqualTypeOf<
        | TypedError<'forbidden', never>
        | TypedError<'conflict', { slug: string }>
      >();
      return 500;
    });
  });

  it('matchType_theFallbackForm_unionsTheArmsAndTheFallback', () => {
    const out = matchType(
      appError('not_found'),
      { not_found: (e) => e.details!.id },
      () => 500,
    );

    expectTypeOf(out).toEqualTypeOf<string | number>();
  });

  it('matchType_theFallbackForm_alsoRejectsAStrayArm', () => {
    matchType(
      appError('not_found'),
      {
        not_found: () => 404,
        // @ts-expect-error — `teapot` is not a variant of AppError
        teapot: () => 418,
      },
      () => 500,
    );
  });

  it('matchType_aHandWrittenUnion_behavesLikeAnErrorsOfOne', () => {
    // Nothing here depends on `defineError` — the discriminant is the whole
    // mechanism.
    type Manual =
      | TypedError<'a', { n: number }>
      | TypedError<'b', { s: string }>;
    const manual = (): Manual => ({
      type: 'a',
      message: 'm',
      details: { n: 1 },
    });

    const out = matchType(manual(), {
      a: (e) => e.details!.n,
      b: (e) => e.details!.s,
    });

    expectTypeOf(out).toEqualTypeOf<number | string>();
  });

  it('matchType_anUnresolvedTypeParameter_refusesConcreteArms', () => {
    // The honest degradation: an unresolved `E` has no known tag set to
    // exhaust, and the mapped type says so rather than silently widening.
    function wrapper<E extends TypedError>(error: E) {
      return matchType(error, {
        // @ts-expect-error — no concrete arm can satisfy an unresolved `E`
        anything: () => 1,
      });
    }

    expect(typeof wrapper).toBe('function');
  });
});
