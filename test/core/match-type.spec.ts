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
type NotFound = ReturnType<typeof notFound>;
type Conflict = ReturnType<typeof conflict>;

/**
 * A complete arm bag for `AppError`. The runtime-abuse tests below feed
 * deliberately malformed bags through `as unknown as FullArms`: the types are
 * what those cases are *defeating*, so the cast is the point, and a full shape
 * keeps the exhaustive overload selected rather than accidentally testing the
 * fallback form.
 */
type FullArms = {
  not_found: () => string;
  forbidden: () => string;
  conflict: () => string;
};

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

describe('matchType — falsy returns are values, not absences', () => {
  /**
   * The whole bucket is a regression guard against re-introducing a
   * `bag[tag]?.(error) ?? fallback(error)` body — the shape the #73 prototype
   * used. `undefined` is the obvious casualty; `null` is the one that gets
   * missed, because `??` fires on both and `||` fires on all six values here.
   */
  it.each([
    ['null', null],
    ['zero', 0],
    ['false', false],
    ['the empty string', ''],
    ['NaN', Number.NaN],
    ['negative zero', -0],
  ])('matchType_armReturning%s_returnsItRatherThanFallingThrough', (_, v) => {
    expect(matchType(appError('forbidden'), { forbidden: () => v }, () => 'FELL')).toBe(v);
  });

  it('matchType_armReturningNull_isNotTreatedAsAMissingArm', () => {
    // The single most likely `??` casualty, called out on its own because the
    // exhaustive form has no fallback to leak into — it would throw instead.
    const out = matchType(appError('conflict'), {
      not_found: () => 'nf',
      forbidden: () => 'f',
      conflict: () => null,
    });

    expect(out).toBeNull();
  });

  it('matchType_fallbackReturningNull_returnsNull', () => {
    expect(matchType(appError('conflict'), { not_found: () => 1 }, () => null)).toBeNull();
  });
});

describe('matchType — errors from user code pass through untouched', () => {
  it('matchType_armThatThrows_propagatesTheSameError', () => {
    const boom = new Error('from the arm');

    expect(() =>
      matchType(appError('forbidden'), {
        not_found: () => 1,
        forbidden: () => {
          throw boom;
        },
        conflict: () => 3,
      }),
    ).toThrow(boom);
  });

  it('matchType_fallbackThatThrows_propagatesTheSameError', () => {
    const boom = new Error('from the fallback');

    expect(() =>
      matchType(
        appError('conflict'),
        { not_found: () => 1 },
        () => {
          throw boom;
        },
      ),
    ).toThrow(boom);
  });

  it('matchType_armThatThrowsANonError_propagatesTheThrownValue', () => {
    expect(() =>
      matchType(appError('forbidden'), {
        not_found: () => 1,
        forbidden: () => {
          throw 'a bare string';
        },
        conflict: () => 3,
      }),
    ).toThrow('a bare string');
  });
});

describe('matchType — purity', () => {
  const arms = () => ({
    not_found: (e: NotFound) => e.details?.id,
    forbidden: () => 'denied',
    conflict: (e: Conflict) => e.details?.slug,
  });

  it('matchType_anyCall_doesNotMutateTheError', () => {
    const error = appError('not_found');
    const before = structuredClone(error);

    matchType(error, arms());

    expect(error).toEqual(before);
  });

  it('matchType_anyCall_doesNotMutateTheHandlerBag', () => {
    const bag = arms();
    const keysBefore = Object.keys(bag);

    matchType(appError('not_found'), bag);

    expect(Object.keys(bag)).toEqual(keysBefore);
  });

  it('matchType_calledTwiceWithTheSameInputs_returnsTheSameAnswer', () => {
    const error = appError('conflict');

    expect(matchType(error, arms())).toBe(matchType(error, arms()));
  });

  it('matchType_anArm_receivesExactlyOneArgument', () => {
    // Guards against a future body "helpfully" passing the tag or the bag as a
    // second argument, which would silently change what `(e, x) => …` means.
    let received = -1;

    matchType(appError('forbidden'), {
      not_found: () => 0,
      forbidden: (...args: unknown[]) => (received = args.length),
      conflict: () => 0,
    });

    expect(received).toBe(1);
  });

  it('matchType_theFallback_receivesExactlyOneArgument', () => {
    let received = -1;

    matchType(appError('conflict'), { not_found: () => 0 }, (...args: unknown[]) => (received = args.length));

    expect(received).toBe(1);
  });
});

describe('matchType — the own-property rule', () => {
  /**
   * An arm counts only if the bag owns it. That rule is what makes an error
   * tagged `constructor` or `toString` report a gap instead of quietly calling
   * `Object.prototype`'s member — and the cases below are the two directions it
   * has to get right, plus the one input it deliberately refuses.
   */

  it('matchType_anErrorTaggedHasOwnProperty_stillRunsItsOwnArm', () => {
    // The positive control for reading the guard off `Object.prototype` rather
    // than calling `handlers.hasOwnProperty(...)` — the latter would invoke this
    // very arm as the guard and misread its return value as the answer.
    const rogue = {
      type: 'hasOwnProperty',
      message: 'awkward',
    } as unknown as AppError;

    const out = matchType(rogue, {
      hasOwnProperty: () => 'the arm ran',
    } as unknown as FullArms);

    expect(out).toBe('the arm ran');
  });

  it('matchType_aNullPrototypeBag_works', () => {
    // `Object.create(null)` has no `hasOwnProperty` at all, so a body calling
    // the method on the bag would crash outright on this input.
    const bag = Object.create(null) as Record<string, () => string>;
    bag['forbidden'] = () => 'ok';

    const out = matchType(
      appError('forbidden'),
      bag as unknown as FullArms,
    );

    expect(out).toBe('ok');
  });

  it('matchType_aFrozenBag_works', () => {
    const out = matchType(
      appError('forbidden'),
      Object.freeze({
        not_found: () => 'nf',
        forbidden: () => 'ok',
        conflict: () => 'c',
      }),
    );

    expect(out).toBe('ok');
  });

  it('matchType_anArmInheritedFromAPrototype_isRefused', () => {
    // Deliberate, and the cost of the rule: a class-instance bag is structurally
    // legal but its arms live on the prototype, so they are not offered. The
    // failure is loud, which is the trade — the alternative admits
    // `Object.prototype`'s members as handlers.
    class Bag {
      forbidden() {
        return 'proto arm';
      }
    }

    expect(() =>
      matchType(
        appError('forbidden'),
        new Bag() as unknown as FullArms,
      ),
    ).toThrow('matchType: no handler for error type "forbidden"');
  });

  it('matchType_aProtoShorthandArm_isRefusedBecauseItIsNotAnOwnProperty', () => {
    // `{ __proto__: fn }` sets the bag's *prototype*; it does not add a key.
    // Reading `bag['__proto__']` still yields the function, so an unguarded
    // body would call it. Refusing is right — the user's arm was never stored.
    const rogue = { type: '__proto__', message: 'sneaky' } as unknown as AppError;

    expect(() =>
      matchType(rogue, { __proto__: () => 'ran' } as unknown as FullArms),
    ).toThrow('matchType: no handler for error type "__proto__"');
  });

  it('matchType_aComputedProtoArm_runsBecauseItIsAnOwnProperty', () => {
    // The other half of the asymmetry: the computed key *does* store an arm.
    const rogue = { type: '__proto__', message: 'sneaky' } as unknown as AppError;

    const out = matchType(rogue, {
      ['__proto__']: () => 'ran',
    } as unknown as FullArms);

    expect(out).toBe('ran');
  });
});

describe('matchType — tag edge cases', () => {
  const run = (tag: string, key: string) =>
    matchType(
      { type: tag, message: 'm' } as unknown as AppError,
      { [key]: () => 'ok' } as unknown as FullArms,
    );

  it('matchType_anEmptyStringTag_dispatchesNormally', () => {
    // `defineError('', …)` is legal — `TType extends string` admits it.
    expect(run('', '')).toBe('ok');
  });

  it('matchType_aUnicodeTag_dispatchesNormally', () => {
    expect(run('não_encontrado_🙈', 'não_encontrado_🙈')).toBe('ok');
  });

  it('matchType_aVeryLongTag_dispatchesNormally', () => {
    const long = 'x'.repeat(10_000);

    expect(run(long, long)).toBe('ok');
  });

  it('matchType_tagsDifferingOnlyByCase_areNotConfused', () => {
    expect(() => run('Not_Found', 'not_found')).toThrow(
      'matchType: no handler for error type "Not_Found"',
    );
  });

  it('matchType_aTagWithWhitespace_isNotTrimmed', () => {
    expect(() => run(' not_found ', 'not_found')).toThrow(
      'matchType: no handler for error type " not_found "',
    );
  });
});

describe('matchType — re-entrancy and staleness', () => {
  it('matchType_calledFromInsideAnArm_works', () => {
    const out = matchType(appError('forbidden'), {
      not_found: () => 'nf',
      forbidden: () => matchType(appError('conflict'), {
        not_found: () => 'inner nf',
        forbidden: () => 'inner f',
        conflict: () => 'inner c',
      }),
      conflict: () => 'c',
    });

    expect(out).toBe('inner c');
  });

  it('matchType_anArmThatRemovesItselfFromTheBag_affectsOnlyLaterCalls', () => {
    // Nothing is cached between calls, and the arm is read before it is called.
    const bag: Record<string, (() => string) | undefined> = {
      forbidden: () => {
        delete bag['forbidden'];
        return 'first';
      },
    };
    const typed = bag as unknown as { not_found?: () => string };

    expect(matchType(appError('forbidden'), typed, () => 'fallback')).toBe('first');
    expect(matchType(appError('forbidden'), typed, () => 'fallback')).toBe('fallback');
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

  it('matchType_aCompleteBagPlusAFallback_narrowsTheFallbackToNever', () => {
    // Nothing is left over, so the fallback is unreachable and typed to say so.
    // It must still *compile* — refusing a redundant fallback would punish the
    // common edit of handling one more variant and forgetting to delete it.
    const out = matchType(
      appError('not_found'),
      { not_found: () => 404, forbidden: () => 403, conflict: () => 409 },
      (leftover) => {
        expectTypeOf(leftover).toBeNever();
        return 'unreachable';
      },
    );

    expectTypeOf(out).toEqualTypeOf<number | string>();
  });

  it('matchType_anEmptyBagPlusAFallback_sendsTheWholeUnionToIt', () => {
    matchType(appError('forbidden'), {}, (leftover) => {
      expectTypeOf(leftover).toEqualTypeOf<AppError>();
      return 0;
    });
  });

  it('matchType_anArmDeclaredForTheWrongVariant_isACompileError', () => {
    // No bivariance hole: the arms sit in property position, so
    // `strictFunctionTypes` gives them contravariant parameter checking.
    matchType(appError('not_found'), {
      // @ts-expect-error — a not_found arm cannot claim to take a forbidden
      not_found: (e: TypedError<'forbidden', never>) => e.type,
      forbidden: () => 'f',
      conflict: () => 'c',
    });
  });

  it('matchType_anArmTakingASecondParameter_isACompileError', () => {
    // It would be `undefined` at runtime — exactly one argument is passed.
    matchType(appError('not_found'), {
      // @ts-expect-error — the call site supplies one argument, not two
      not_found: (e: NotFound, extra: number) => extra,
      forbidden: () => 0,
      conflict: () => 0,
    });
  });

  it('matchType_aStrayArmInABagHeldByAVariable_isStillACompileError', () => {
    // The stray-arm clause does not lean on object-literal freshness, which is
    // the whole reason it exists — freshness would not fire here at all.
    const bag = {
      not_found: () => 404,
      forbidden: () => 403,
      conflict: () => 409,
      teapot: () => 418,
    };

    // @ts-expect-error — `teapot` is not a variant of AppError
    matchType(appError('not_found'), bag);
  });

  it('matchType_anOptionalArmInTheExhaustiveForm_isACompileError', () => {
    const bag: {
      not_found?: () => number;
      forbidden: () => number;
      conflict: () => number;
    } = { forbidden: () => 403, conflict: () => 409 };

    // Never invoked — the assertion is the directive. Calling it would throw,
    // which is itself the point: the type rejects exactly the bag whose missing
    // arm the runtime cannot cover.
    const rejected = () =>
      // @ts-expect-error — a possibly-absent arm is not exhaustive
      matchType(appError('not_found'), bag);

    expect(typeof rejected).toBe('function');
  });

  it('matchType_aBareFunctionArm_isACompileError', () => {
    matchType(appError('not_found'), {
      // @ts-expect-error — `Function` says nothing about the variant or return
      not_found: (() => 404) as Function,
      forbidden: () => 403,
      conflict: () => 409,
    });
  });

  it('matchType_aFallbackDeclaredForAHandledVariant_isACompileError', () => {
    matchType(
      appError('not_found'),
      { not_found: () => 404 },
      // @ts-expect-error — not_found is handled; the residual is forbidden | conflict
      (e: NotFound) => e.type,
    );
  });

  it('matchType_armsReturningVoid_returnVoid', () => {
    const out = matchType(appError('not_found'), {
      not_found: () => {},
      forbidden: () => {},
      conflict: () => {},
    });

    expectTypeOf(out).toEqualTypeOf<void>();
  });

  it('matchType_anArmThatAlwaysThrows_doesNotPoisonTheReturnUnion', () => {
    // Dispatched away from the throwing arm on purpose: the claim is about the
    // static return type, and `never` must vanish from the union rather than
    // absorb it.
    const out = matchType(appError('forbidden'), {
      not_found: (): never => {
        throw new Error('unhandled');
      },
      forbidden: () => 'f',
      conflict: () => 'c',
    });

    expectTypeOf(out).toEqualTypeOf<string>();
    expect(out).toBe('f');
  });

  it('matchType_twoVariantsSharingAPayloadShape_collapseToOneReturnType', () => {
    type Twins =
      | TypedError<'x', { n: number }>
      | TypedError<'y', { n: number }>;
    const twins = (): Twins => ({ type: 'x', message: 'm', details: { n: 1 } });

    const out = matchType(twins(), {
      x: (e) => e.details!.n,
      y: (e) => e.details!.n,
    });

    expectTypeOf(out).toEqualTypeOf<number>();
  });
});

/**
 * Four ways to end up with a `matchType` call that compiles and does less than
 * it looks like it does. None is a defect in the signature — each is the
 * documented consequence of a `TypedError` shape that is not a closed
 * discriminated union, or of `any` doing what `any` does. They are pinned here
 * so that if a future TypeScript changes any of them, this file says so.
 */
describe('matchType — the shapes that quietly opt out of exhaustiveness', () => {
  it('matchType_aBareTypedErrorMixedIntoTheUnion_cannotBeExhausted', () => {
    // The sharp edge of the documented "closed union" rule: one bare
    // `TypedError` anywhere in the union opens the tag to `string`, so the
    // mapped type becomes an index signature and `{}` satisfies it — even
    // though the other members are perfectly good literal variants.
    const mixed = (): AppError | TypedError => appError('not_found');

    const out = () => matchType(mixed(), {});

    // `never` and a throw are the same statement made twice — the call compiles
    // and cannot produce a value, which is the only honest reading of a bag
    // that was never asked to cover anything.
    expectTypeOf(out).returns.toBeNever();
    expect(out).toThrow('matchType: no handler for error type "not_found"');
  });

  it('matchType_aBareTypedErrorWithAnEmptyBag_typesAsNeverAndThrowsToMatch', () => {
    // Type and runtime agree, which is the only reason the above is tolerable:
    // the return type is `never`, and the call does in fact never return.
    const bare = (): TypedError => ({ type: 'whatever', message: 'm' });

    const out = () => matchType(bare(), {});

    expectTypeOf(out).returns.toBeNever();
    expect(out).toThrow('matchType: no handler for error type "whatever"');
  });

  it('matchType_aVariantWhoseTagIsItselfAUnion_handsItsArmsNever', () => {
    // `TypedError<'a' | 'b'>` is ONE variant with two possible tags, not two
    // variants — so `Extract<E, { type: 'a' }>` finds nothing and the arm is
    // typed `(v: never) => unknown`. Every arm satisfies that, so the call
    // compiles and the payload is unreachable. Write two variants instead.
    const multi = (): TypedError<'a' | 'b', { n: number }> => ({
      type: 'a',
      message: 'm',
      details: { n: 1 },
    });

    const out = matchType(multi(), {
      a: (v) => {
        expectTypeOf(v).toBeNever();
        return 1;
      },
      b: () => 2,
    });

    expect(out).toBe(1);
  });

  it('matchType_oneAnyArm_widensTheWholeResultToAny', () => {
    // `ReturnType<H[keyof H]>` unions the arms, and `any` absorbs a union. The
    // "no `any`" property the signature promises is about what `matchType`
    // introduces, not about what a caller can hand it.
    const out = matchType(appError('not_found'), {
      not_found: (e: any) => e.details.id,
      forbidden: () => 403,
      conflict: () => 409,
    });

    expectTypeOf(out).toBeAny();
    // `number` was never in it — the union collapsed the moment `any` joined.
    expect(out).toBe('u1');
  });

  it('matchType_aGenericWrapperConstrainedToTheUnion_stillCannotSupplyArms', () => {
    // Stronger than the unresolved-`E` case above: even constraining `E` to the
    // *whole* union does not help, because `Arms<E>` stays deferred. Widen at
    // the call instead of fighting it — `matchType(error as AppError, …)`.
    function tooClever<E extends AppError>(error: E) {
      // @ts-expect-error — `Arms<E>` is deferred; no concrete bag satisfies it
      return matchType(error, {
        not_found: () => 404,
        forbidden: () => 403,
        conflict: () => 409,
      });
    }

    function theWorkaround<E extends AppError>(error: E): number {
      return matchType(error as AppError, {
        not_found: () => 404,
        forbidden: () => 403,
        conflict: () => 409,
      });
    }

    expect(typeof tooClever).toBe('function');
    expect(theWorkaround(appError('forbidden'))).toBe(403);
  });
});

describe('matchType — arity and receiver', () => {
  it('matchType_anExplicitUndefinedThirdArgument_behavesAsTheTwoArgForm', () => {
    // Guards the `fallback !== undefined` check specifically: an explicit
    // `undefined` must not count as "a fallback was supplied and returned
    // nothing", which would turn a missing arm into a silent `undefined`.
    const rogue = { type: 'teapot', message: 'm' } as unknown as AppError;

    expect(() =>
      matchType(
        rogue,
        { not_found: () => 404 },
        undefined as unknown as (e: AppError) => number,
      ),
    ).toThrow('matchType: no handler for error type "teapot"');
  });

  it('matchType_anArm_isCalledUnboundSoThisIsUndefined', () => {
    // Pinned because it *differs* from §5.3's `match`, which calls
    // `cases.ok(...)` and so leaves `this` bound to the case bag. Arms here are
    // read out and called as plain functions: a handler bag is data, not an
    // object with methods, and a method-shorthand arm reaching for `this` gets
    // a loud TypeError rather than a quietly wrong receiver.
    let seen: unknown = 'unset';

    matchType(appError('forbidden'), {
      not_found: () => 0,
      forbidden(this: unknown) {
        seen = this;
        return 0;
      },
      conflict: () => 0,
    });

    expect(seen).toBeUndefined();
  });
});
