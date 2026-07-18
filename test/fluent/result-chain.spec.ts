import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { err as coreErr, ok as coreOk } from '../../src/index';
import type { Result } from '../../src/index';
import { err, from, ok } from '../../src/fluent/index';
import type { ResultChain } from '../../src/fluent/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}
interface Forbidden {
  readonly type: 'forbidden';
}

interface User {
  readonly credit: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };

const user: User = { credit: 10 };

/**
 * Real stubs, not annotated consts — the same convention `test/core/*` uses, and
 * it is load-bearing rather than stylistic. `const plain: Result<User, NotFound>
 * = ok(user)` is narrowed by control-flow analysis to `Ok<User>` *despite the
 * annotation*, so `E` gets no inference candidate and every downstream assertion
 * reads `unknown` for the error channel. A function's return annotation is not
 * narrowed, so it is what the type assertions can actually trust.
 */
const okUser = (): Result<User, NotFound> => coreOk(user);
const errUser = (): Result<User, NotFound> => coreErr(notFound);

describe('the /fluent constructors', () => {
  it('ok_wrapsTheValue', () => {
    expect(ok(user).toResult()).toEqual(coreOk(user));
  });

  it('ok_noArg_mirrorsTheRootVoidOverload', () => {
    const chain = ok();

    expectTypeOf(chain).toEqualTypeOf<ResultChain<void, never>>();
    expect(chain.toResult()).toEqual(coreOk());
  });

  it('err_wrapsTheError', () => {
    expect(err(notFound).toResult()).toEqual(coreErr(notFound));
  });

  it('from_reEntersFluentLandFromAPlainResult', () => {
    const plain = okUser();

    const chain = from(plain);

    expect(chain.toResult()).toBe(plain);
  });

  it('from_infersBothChannelsOfThePlainResult', () => {
    const chain = from(okUser());

    expectTypeOf(chain).toEqualTypeOf<ResultChain<User, NotFound>>();
  });

  it('resultChain_isExportedAsATypeNotAValue', async () => {
    const surface = (await import('../../src/fluent/index')) as Record<
      string,
      unknown
    >;

    // Instances come only from ok / err / from / safeTry — never `new`.
    expect(surface).not.toHaveProperty('ResultChain');
  });
});

describe('ResultChain chaining members', () => {
  it('map_transformsTheValueOfAnOk', () => {
    expect(ok(user).map((u) => u.credit).toResult()).toEqual(coreOk(10));
  });

  it('map_passesAnErrThrough', () => {
    expect(
      err(notFound)
        .map((u: User) => u.credit)
        .toResult(),
    ).toEqual(coreErr(notFound));
  });

  it('map_returnsAResultChain', () => {
    const chain = from(okUser()).map((u) => u.credit);

    expectTypeOf(chain).toEqualTypeOf<ResultChain<number, NotFound>>();
  });

  it('mapErr_transformsTheErrorOfAnErr', () => {
    expect(err(notFound).mapErr((e) => e.id).toResult()).toEqual(coreErr('u1'));
  });

  it('andThen_chainsAFallibleStep', () => {
    const chain = from(okUser()).andThen(
      (u): Result<number, Forbidden> => coreOk(u.credit),
    );

    expect(chain.toResult()).toEqual(coreOk(10));
  });

  it('andThen_accumulatesTheErrorChannel', () => {
    const chain = from(okUser()).andThen(
      (u): Result<number, Forbidden> => coreOk(u.credit),
    );

    expectTypeOf(chain).toEqualTypeOf<ResultChain<number, NotFound | Forbidden>>();
  });

  it('orElse_recoversFromAnErr', () => {
    const chain = from(errUser()).orElse(
      (): Result<User, Forbidden> => coreOk(user),
    );

    expect(chain.toResult()).toEqual(coreOk(user));
  });

  it('orElse_accumulatesTheSuccessChannel', () => {
    const chain = from(errUser()).orElse(
      (): Result<number, Forbidden> => coreOk(0),
    );

    expectTypeOf(chain).toEqualTypeOf<ResultChain<User | number, Forbidden>>();
  });

  it('inspect_teesTheValueAndReturnsItUnchanged', () => {
    const spy = vi.fn();

    const chain = ok(user).inspect(spy);

    expect(spy).toHaveBeenCalledWith(user);
    expect(chain.toResult()).toEqual(coreOk(user));
  });

  it('inspect_doesNotFireOnAnErr', () => {
    const spy = vi.fn();

    err(notFound).inspect(spy);

    expect(spy).not.toHaveBeenCalled();
  });

  it('inspectErr_teesTheErrorAndReturnsItUnchanged', () => {
    const spy = vi.fn();

    const chain = err(notFound).inspectErr(spy);

    expect(spy).toHaveBeenCalledWith(notFound);
    expect(chain.toResult()).toEqual(coreErr(notFound));
  });

  it('chaining_isImmutableAndReturnsANewWrapper', () => {
    const original = from(okUser());

    const mapped = original.map((u) => u.credit);

    expect(mapped).not.toBe(original);
    expect(original.toResult()).toEqual(coreOk(user));
  });

  it('theHeroPath_readsAsOneExpression', () => {
    const receipt = from(okUser())
      .map((u) => u.credit * 2)
      .andThen((credit): Result<number, Forbidden> => coreOk(credit + 1))
      .match({ ok: (total) => `paid ${total}`, err: () => 'failed' });

    expect(receipt).toBe('paid 21');
  });
});

describe('ResultChain terminal members', () => {
  it('match_collapsesAnOkThroughTheOkBranch', () => {
    expect(ok(user).match({ ok: (u) => u.credit, err: () => 0 })).toBe(10);
  });

  it('match_collapsesAnErrThroughTheErrBranch', () => {
    expect(
      from(errUser()).match({
        ok: (u) => u.credit,
        err: () => 0,
      }),
    ).toBe(0);
  });

  it('match_infersTheUnionWhenTheBranchesDiffer', () => {
    // The §5.3 note applies identically to the method form (§10): one naked `U`
    // across both callbacks would lock to the `ok` branch and reject this.
    const out = from(okUser()).match({
      ok: (u) => u.credit,
      err: () => 'anon',
    });

    expectTypeOf(out).toEqualTypeOf<number | string>();
  });

  /**
   * The `UErr = UOk` default — see the twin in `result-async.spec.ts`. Inference
   * never consults a default, so every inferred `.match()` call above is blind
   * to it and deleting `= UOk` kept the whole suite green.
   */
  it('match_honoursTheExplicitSingleTypeArgumentArity', () => {
    const out = from(okUser()).match<string>({ ok: () => 'a', err: () => 'b' });

    expectTypeOf(out).toEqualTypeOf<string>();
    expect(out).toBe('a');
  });

  it('unwrapOr_returnsTheValueOfAnOk', () => {
    expect(ok(10).unwrapOr(0)).toBe(10);
  });

  it('unwrapOr_returnsTheFallbackOnAnErr', () => {
    expect(from<number, NotFound>(coreErr(notFound)).unwrapOr(0)).toBe(0);
  });

  it('unwrapOrElse_computesTheFallbackFromTheError', () => {
    expect(
      from<string, NotFound>(coreErr(notFound)).unwrapOrElse((e) => e.id),
    ).toBe('u1');
  });

  it('unwrapOrThrow_returnsTheValueOfAnOk', () => {
    expect(ok(10).unwrapOrThrow()).toBe(10);
  });

  it('unwrapOrThrow_throwsARealErrorOnAnErr', () => {
    expect(() => err(notFound).unwrapOrThrow()).toThrow(Error);
  });

  it('unwrapOrThrow_passesTheMessageThrough', () => {
    expect(() => err(notFound).unwrapOrThrow('custom')).toThrow('custom');
  });

  it('unwrapOrThrow_carriesTheOriginalErrorInCause', () => {
    // Delegated, not reimplemented: ADR 0002's cause handling holds here for
    // free, which is the point of rule 2.
    expect(() => err(notFound).unwrapOrThrow()).toThrow(
      expect.objectContaining({ cause: notFound }),
    );
  });

  it('toNullable_returnsTheValueOfAnOk', () => {
    expect(ok(10).toNullable()).toBe(10);
  });

  it('toNullable_returnsNullOnAnErr', () => {
    expect(err(notFound).toNullable()).toBeNull();
  });
});

describe('ResultChain.isOk / isErr', () => {
  it('isOk_isTrueForAnOk', () => {
    expect(ok(1).isOk()).toBe(true);
  });

  it('isErr_isTrueForAnErr', () => {
    expect(err(notFound).isErr()).toBe(true);
  });

  it('isOk_returnsAPlainBooleanNotATypePredicate', () => {
    const chain = from(okUser());

    expectTypeOf(chain.isOk).toEqualTypeOf<() => boolean>();
  });

  /**
   * **The documented limitation, pinned so it is discoverable rather than
   * folklore** (§6.1). A method cannot emit a predicate that narrows its own
   * class's generics the way a free function narrows a plain union — there is no
   * `this is ResultChain<T, never>` that refines `T` and `E` at the call site.
   *
   * So `.isOk()` tells you *which branch* and buys **no narrowing**: `chain` is
   * the same type inside the `if` as outside it. It exists only so a hero-path
   * user reaching for `if (result.isOk())` does not hit a DX cliff.
   *
   * **Type-safe narrowing on the fluent side goes through `.match()` / the
   * terminals**, which is why they take both branches.
   */
  it('isOk_buysNoNarrowingOfTheWrappersGenerics', () => {
    const chain = from(okUser());

    if (chain.isOk()) {
      expectTypeOf(chain).toEqualTypeOf<ResultChain<User, NotFound>>();
      // ...and so the terminal still demands a fallback, inside the `if`:
      expect(chain.unwrapOr(user)).toEqual(user);
    }
  });
});

describe('ResultChain exits', () => {
  it('toResult_returnsThePlainUnion', () => {
    const result = ok(user).toResult();

    expectTypeOf(result).toEqualTypeOf<Result<User, never>>();
    expect(result).toEqual({ ok: true, value: user });
  });

  it('toResult_returnsPlainDataNotAWrapper', () => {
    expect(ok(user).toResult().constructor).toBe(Object);
  });

  it('toJSON_returnsThePlainUnion', () => {
    expect(ok(user).toJSON()).toEqual(coreOk(user));
  });

  /**
   * The pit-of-success net. Without `toJSON`, `JSON.stringify` on a
   * `#result`-carrying class yields `"{}"` — the private field is invisible to
   * the serializer — so what this prevents is **silent data loss**, not an error.
   */
  it('jsonStringify_onAChain_emitsTheCorrectPlainUnion', () => {
    expect(JSON.stringify(ok(user))).toBe('{"ok":true,"value":{"credit":10}}');
  });

  it('jsonStringify_onAnErrChain_emitsTheCorrectPlainUnion', () => {
    expect(JSON.stringify(err(notFound))).toBe(
      '{"ok":false,"error":{"type":"not_found","id":"u1"}}',
    );
  });

  it('jsonRoundTrip_throughAChain_yieldsAStructurallyIdenticalResult', () => {
    // §2.1's guarantee still governs the plain union the wrapper hands back.
    const parsed = JSON.parse(JSON.stringify(ok(user))) as Result<User, never>;

    expect(parsed).toEqual(ok(user).toResult());
  });
});

/**
 * The #36 defect, mirrored (spec §10.7). The wrapper delegates to the core, so
 * it inherited the core's hole: a `U | Promise<U>` callback matched the sync arm
 * and tsc promised a `ResultChain` while the runtime handed back a
 * `ResultAsync` — leaving `.toResult()` a `Promise` where a `Result` was
 * guaranteed.
 */
const seenSink: number[] = [];
const creditCache = new Map<string, number>();
const fetchCredit = async (_id: string): Promise<number> => 10;
/** Returns `number | Promise<number>` — neither purely sync nor purely async. */
const lookupCredit = (id: string) => creditCache.get(id) ?? fetchCredit(id);

describe('ResultChain and the mixed value-or-promise callback (#36)', () => {
  it('rejects it in map, rather than returning a ResultAsync typed as a ResultChain', () => {
    // @ts-expect-error - a `U | Promise<U>` callback must not match the sync arm
    ok(user).map((u) => lookupCredit(String(u.credit)));
  });

  it('rejects it in mapErr', () => {
    // @ts-expect-error - see above
    from(errUser()).mapErr((e) => lookupCredit(e.id));
  });

  it('rejects it in inspect', () => {
    // @ts-expect-error - see above
    ok(user).inspect((u) => lookupCredit(String(u.credit)));
  });

  it('rejects it in inspectErr', () => {
    // @ts-expect-error - see above
    from(errUser()).inspectErr((e) => lookupCredit(e.id));
  });

  it('still returns a ResultChain for an ordinary value-returning sync callback', () => {
    // The guard must cost nothing here: no extra argument, same resolved type.
    expectTypeOf(ok(user).map((u) => u.credit)).toEqualTypeOf<
      ResultChain<number, never>
    >();
  });

  it('accepts an async tee whose callback returns a value, once across the seam', async () => {
    // `async u => log(u)` is a Promise<X>, not a Promise<void>. Capturing the
    // return type is what lets the guard see it at all; crossing with toAsync()
    // is what makes awaiting it sound on both branches.
    const seen: number[] = [];
    const out = ok(user)
      .toAsync()
      .inspect(async (u) => seen.push(u.credit));

    await expect(out.toResult()).resolves.toEqual(coreOk(user));
    expect(seen).toEqual([10]);
  });

  it('rejects an async tee on the sync surface', () => {
    // @ts-expect-error - §10.9: cross with .toAsync() first
    ok(user).inspect(async (u) => seenSink.push(u.credit));
  });
});
