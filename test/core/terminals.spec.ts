import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import * as barrel from '../../src/index';
import {
  err,
  match,
  ok,
  toNullable,
  unwrapOr,
  unwrapOrElse,
  unwrapOrThrow,
} from '../../src/index';
import type { Result, TypedError } from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * That matters most for `match`: its branch inference and its refusal of a
 * `Promise<Result>` are compile-time contracts with no runtime shadow. A
 * `match` that collapsed both branches to one `U` still *runs* correctly — it
 * just stops compiling at the call site, which no amount of `expect` can catch.
 */

interface NotFound {
  readonly type: 'not_found';
  readonly id: string;
}

interface User {
  readonly credit: number;
}

const notFound: NotFound = { type: 'not_found', id: 'u1' };

/**
 * Real stubs, not `declare`s — the return annotation is what every type
 * assertion reads, but these also execute under vitest.
 */
const okUser = (): Result<User, NotFound> => ok({ credit: 10 });
const errUser = (): Result<User, NotFound> => err(notFound);

/** A `Promise<Result>` source, for the §5.3 negative. */
const fetchUser = async (): Promise<Result<User, NotFound>> => ok({ credit: 10 });

describe('match', () => {
  it('collapses to a single type where both branches agree', () => {
    expectTypeOf(
      match(okUser(), { ok: (u) => String(u.credit), err: (e) => e.type }),
    ).toEqualTypeOf<string>();
  });

  it('infers a union where the branches genuinely differ', () => {
    expectTypeOf(
      match(okUser(), { ok: (u) => u.credit, err: () => 'fallback' }),
    ).toEqualTypeOf<number | string>();
  });

  it('takes the ok branch, handing it the value', () => {
    expect(match(okUser(), { ok: (u) => u.credit, err: () => -1 })).toBe(10);
  });

  it('takes the err branch, handing it the error', () => {
    expect(match(errUser(), { ok: () => 'ok', err: (e) => e.id })).toBe('u1');
  });

  it('requires both branches, so it is exhaustive by construction', () => {
    // Never invoked — a missing branch is a type error, but at runtime it would
    // reach `cases.ok is not a function`.
    void (() => {
      // @ts-expect-error — `err` is required; there is no one-sided match.
      match(okUser(), { ok: (u: User) => u.credit });

      // @ts-expect-error — `ok` is required.
      match(okUser(), { err: (e: NotFound) => e.id });
    });
  });

  it("rejects v1's onSuccess / onFailure keys", () => {
    void (() => {
      // @ts-expect-error — renamed to `ok` / `err`; neither v1 key survives.
      match(okUser(), { onSuccess: (u: User) => u.credit, onFailure: () => -1 });
    });
  });
});

describe('unwrapOr', () => {
  it('returns the value on an Ok', () => {
    expect(unwrapOr(okUser(), { credit: 0 })).toEqual({ credit: 10 });
  });

  it('returns the default on an Err', () => {
    expect(unwrapOr(errUser(), { credit: 0 })).toEqual({ credit: 0 });
  });

  it('returns a plain T, never widening to include the default', () => {
    expectTypeOf(unwrapOr(okUser(), { credit: 0 })).toEqualTypeOf<User>();
  });
});

describe('unwrapOrElse', () => {
  it('returns the value on an Ok', () => {
    expect(unwrapOrElse(okUser(), () => ({ credit: 0 }))).toEqual({ credit: 10 });
  });

  it('computes the fallback from the error on an Err', () => {
    expect(unwrapOrElse(errUser(), (e) => ({ credit: e.id.length }))).toEqual({
      credit: 2,
    });
  });

  it('does not fire the callback on an Ok', () => {
    const fallback = vi.fn(() => ({ credit: 0 }));

    unwrapOrElse(okUser(), fallback);

    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('unwrapOrThrow', () => {
  it('returns the value on an Ok', () => {
    expect(unwrapOrThrow(okUser())).toEqual({ credit: 10 });
  });

  it('throws on an Err', () => {
    expect(() => unwrapOrThrow(errUser())).toThrow();
  });

  it('throws with the explicit message when given one', () => {
    expect(() => unwrapOrThrow(errUser(), 'User lookup failed')).toThrow(
      'User lookup failed',
    );
  });

  it('falls back to the error own message when E is a TypedError', () => {
    const typed: TypedError<'not_found'> = {
      type: 'not_found',
      message: 'User u1 not found',
    };

    expect(() => unwrapOrThrow(err(typed))).toThrow('User u1 not found');
  });

  it('prefers the explicit message over a TypedError own message', () => {
    const typed: TypedError<'not_found'> = {
      type: 'not_found',
      message: 'User u1 not found',
    };

    expect(() => unwrapOrThrow(err(typed), 'Override')).toThrow('Override');
  });

  it('falls back to a generic message when E is not a TypedError', () => {
    expect(() => unwrapOrThrow(err('boom'))).toThrow(
      'unwrapOrThrow called on an Err',
    );
  });

  it('throws a real Error even when E is a bare string', () => {
    expect(() => unwrapOrThrow(err('boom'))).toThrow(Error);
  });

  it('preserves the original error in cause', () => {
    expect(() => unwrapOrThrow(errUser())).toThrow(
      expect.objectContaining({ cause: notFound }),
    );
  });

  it('unwraps to a plain T', () => {
    expectTypeOf(unwrapOrThrow(okUser())).toEqualTypeOf<User>();
  });
});

describe('toNullable', () => {
  it('returns the value on an Ok', () => {
    expect(toNullable(okUser())).toEqual({ credit: 10 });
  });

  it('returns null on an Err', () => {
    expect(toNullable(errUser())).toBeNull();
  });

  it('returns T | null — null, not undefined', () => {
    expectTypeOf(toNullable(okUser())).toEqualTypeOf<User | null>();
  });
});

describe('terminals do not overload over promises (§5.3)', () => {
  it('rejects a Promise<Result> on every terminal', () => {
    // Never invoked: the assertions here are tsc's, and `unwrapOrThrow` would
    // throw for real if this body ran.
    void (async () => {
      const pending = fetchUser();

      // @ts-expect-error — strictly synchronous; await before the terminal.
      match(pending, { ok: (u: User) => u.credit, err: () => -1 });

      // @ts-expect-error — strictly synchronous; await before the terminal.
      unwrapOr(pending, { credit: 0 });

      // @ts-expect-error — strictly synchronous; await before the terminal.
      unwrapOrElse(pending, () => ({ credit: 0 }));

      // @ts-expect-error — strictly synchronous; await before the terminal.
      unwrapOrThrow(pending);

      // @ts-expect-error — strictly synchronous; await before the terminal.
      toNullable(pending);
    });
  });

  it('accepts the same source once awaited', async () => {
    expect(toNullable(await fetchUser())).toEqual({ credit: 10 });
  });
});

describe('the deliberate absences (§5.3)', () => {
  it('ships no bare unwrap — the v1 silent-undefined footgun', () => {
    expect(barrel).not.toHaveProperty('unwrap');
  });

  it('ships no err-side unwrapErrOrThrow', () => {
    expect(barrel).not.toHaveProperty('unwrapErrOrThrow');
  });
});
