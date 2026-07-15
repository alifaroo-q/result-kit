import { describe, expect, expectTypeOf, it } from 'vitest';

import { err, isErr, isOk, ok } from '../../src/index';
import type { Err, Ok, Result } from '../../src/index';

/**
 * Launders a Result through a function boundary so TypeScript cannot apply
 * assignment narrowing from the initializer.
 *
 * WHY THIS EXISTS — do not inline it away. Writing
 * `const r: Result<number, string> = ok(1)` lets TS narrow `r` to `Ok<number>`
 * at every use, which makes the `else` branch `never`. The narrowing tests
 * would then pass while asserting nothing, and the `expectTypeOf` in the
 * negative branch would error against `never`. Passing through a function
 * parameter keeps the union genuinely wide, which is the only way these tests
 * prove the guard did the narrowing.
 */
const asResult = <T, E>(r: Result<T, E>): Result<T, E> => r;

describe('Result union', () => {
  // §2 invariant: no brand, symbol, or nominal tag.
  // This is what makes the §2.1 round-trip provable and lets a cross-boundary
  // object flow straight in. If a brand ever appears, these two fail first.
  it('accepts a hand-built object literal as Ok', () => {
    const hand: Ok<number> = { ok: true, value: 1 };
    expect(hand).toEqual({ ok: true, value: 1 });
  });

  it('accepts a hand-built object literal as Err', () => {
    const hand: Err<string> = { ok: false, error: 'boom' };
    expect(hand).toEqual({ ok: false, error: 'boom' });
  });

  // §2 invariant: exactly two fields per half — no `error?: never` on Ok,
  // no `value?: never` on Err. `ok` is already a complete discriminant.
  it('has no opposite-field never on either half', () => {
    const okHalf: Ok<number> = { ok: true, value: 1 };
    // @ts-expect-error — `error` is not a member of Ok<T>
    okHalf.error;

    const errHalf: Err<string> = { ok: false, error: 'boom' };
    // @ts-expect-error — `value` is not a member of Err<E>
    errHalf.value;
  });

  // §2: the `ok` boolean is a complete discriminant — narrowing works on the
  // raw union with no guard function at all.
  it('narrows on the ok discriminant alone', () => {
    const r = asResult<number, string>({ ok: true, value: 1 });
    if (r.ok) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      expect(r.value).toBe(1);
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      throw new Error('unreachable');
    }
  });

  // §2.1 the JSON round-trip guarantee — the public contract.
  it('round-trips an Ok through JSON', () => {
    const original: Result<{ id: string }, string> = { ok: true, value: { id: '123' } };
    const revived = JSON.parse(JSON.stringify(original)) as Result<{ id: string }, string>;

    expect(revived).toEqual({ ok: true, value: { id: '123' } });
    expect(revived.ok).toBe(true);
    if (!revived.ok) throw new Error('unreachable');
    expect(revived.value.id).toBe('123');
  });

  it('round-trips an Err through JSON', () => {
    const original: Result<number, { type: string; message: string }> = {
      ok: false,
      error: { type: 'not_found', message: 'User not found' },
    };
    const revived = JSON.parse(JSON.stringify(original)) as typeof original;

    expect(revived).toEqual({ ok: false, error: { type: 'not_found', message: 'User not found' } });
    if (revived.ok) throw new Error('unreachable');
    expect(revived.error.type).toBe('not_found');
  });
});

describe('ok / err constructors', () => {
  // §5.1: narrow returns. `ok` returns Ok<T>, NOT Result<T, never>.
  // Narrow is strictly more precise — it still widens into any Result
  // annotation for free, while keeping .value reachable without narrowing.
  it('returns the narrow Ok half', () => {
    const r = ok(1);
    expectTypeOf(r).toEqualTypeOf<Ok<number>>();
    expectTypeOf(r.value).toEqualTypeOf<number>();
    expect(r).toEqual({ ok: true, value: 1 });

    const widened: Result<number, string> = r; // widening is free
    expect(widened.ok).toBe(true);
  });

  it('returns the narrow Err half', () => {
    const e = err('boom');
    expectTypeOf(e).toEqualTypeOf<Err<string>>();
    expectTypeOf(e.error).toEqualTypeOf<string>();
    expect(e).toEqual({ ok: false, error: 'boom' });

    const widened: Result<number, string> = e;
    expect(widened.ok).toBe(false);
  });

  // §5.1: the no-arg overload for the common Result<void, E> success.
  // `return ok()` beats `ok(undefined)`.
  it('constructs a void Ok with no argument', () => {
    const r = ok();
    expectTypeOf(r).toEqualTypeOf<Ok<void>>();
    expect(r).toEqual({ ok: true, value: undefined });
  });

  // §2 invariant: exactly two fields per half, at runtime too.
  it('builds exactly two fields per half', () => {
    expect(Object.keys(ok(1))).toEqual(['ok', 'value']);
    expect(Object.keys(err('boom'))).toEqual(['ok', 'error']);
    expect(Object.keys(ok())).toEqual(['ok', 'value']);
  });

  // §2 invariant: shallow readonly only — no DeepReadonly, no Object.freeze.
  // The contained value's mutability is its own business.
  it('is shallow readonly and never frozen', () => {
    const r = ok({ n: 1 });

    // @ts-expect-error — the `ok` discriminant is readonly
    r.ok = false;

    r.value.n = 2; // shallow: the contained value stays mutable
    expect(r.value.n).toBe(2);
    expect(Object.isFrozen(r)).toBe(false);
  });

  // Edge cases: the constructors are generic and must not special-case falsy
  // or nullish payloads.
  it('carries falsy and nullish payloads unchanged', () => {
    expect(ok(0)).toEqual({ ok: true, value: 0 });
    expect(ok('')).toEqual({ ok: true, value: '' });
    expect(ok(null)).toEqual({ ok: true, value: null });
    expect(err(null)).toEqual({ ok: false, error: null });
    expect(err(undefined)).toEqual({ ok: false, error: undefined });
  });

  it('carries an Error instance in the error channel', () => {
    const boom = new Error('kaboom');
    const e = err(boom);
    expectTypeOf(e).toEqualTypeOf<Err<Error>>();
    expect(e.error).toBe(boom);
  });
});

describe('isOk / isErr guards', () => {
  // §5.1: guards emit type predicates, not plain booleans.
  // `if (isOk(r)) { r.value }` must narrow — that is the acceptance criterion.
  it('narrows to Ok', () => {
    const r = asResult<number, string>(ok(1));
    if (isOk(r)) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      expect(r.value).toBe(1);
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      throw new Error('unreachable');
    }
  });

  it('narrows to Err', () => {
    const r = asResult<number, string>(err('boom'));
    if (isErr(r)) {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      expect(r.error).toBe('boom');
    } else {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      throw new Error('unreachable');
    }
  });

  it('returns the right boolean for both halves', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('boom'))).toBe(false);
    expect(isErr(err('boom'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  // Guards must key off the discriminant, not truthiness of the payload.
  it('reports ok for a falsy success value', () => {
    expect(isOk(ok(0))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
    expect(isOk(ok())).toBe(true);
    expect(isErr(err(undefined))).toBe(true);
  });

  // §2.1 + §2 together: the guards work on an object that was never built by
  // `ok()` — this is the no-brand invariant paying off end to end, and it is
  // the ticket's headline acceptance criterion.
  it('narrows a JSON-revived result with no re-wrapping', () => {
    const wire = JSON.stringify(ok({ id: '123' }));
    const revived = JSON.parse(wire) as Result<{ id: string }, string>;

    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) throw new Error('unreachable');
    expectTypeOf(revived).toEqualTypeOf<Ok<{ id: string }>>();
    expect(revived.value.id).toBe('123');
  });
});
