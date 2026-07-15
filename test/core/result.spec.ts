import { describe, expect, expectTypeOf, it } from 'vitest';

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
