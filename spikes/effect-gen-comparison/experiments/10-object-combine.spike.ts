/**
 * Experiment 10 — object-form `combine`: candidate implementations + runtime
 * behaviour.
 *
 * Ticket: #89. The question is whether §5.4's two combinators can grow a record
 * form (`combine({ user, posts })` → `Ok<{ user, posts }>`) without degrading
 * the tuple preservation they already promise, and — for
 * `combineWithAllErrors` — what a record input should *do* about key
 * attribution, since today's flat `E[]` cannot say which input failed.
 *
 * Type-level assertions live in `11-object-combine-types.spike.ts`; this file
 * holds the candidates themselves plus the behaviour only a runtime test can
 * observe (key iteration order, own-vs-inherited, symbols).
 *
 * Prior art: `effect@4.0.0-beta.104` `packages/effect/src/Effect.ts` — `all`
 * takes tuple, iterable *and* record through **one** signature
 * (`const Arg extends Iterable<…> | Record<string, …>`) and dispatches inside
 * a conditional return type (`All.Return`), rather than through overloads.
 */
import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../../src/index.ts';
import type { ErrTypeOf, OkTypeOf } from '../../../src/index.ts';

/** The record counterpart of §5.4's `readonly Result<unknown, unknown>[]`. */
export type ResultRecord = Record<string, Result<unknown, unknown>>;

/* -------------------------------------------------------------------------- */
/* Candidate 1 — two overloads, tuple first                                    */
/* -------------------------------------------------------------------------- */

/**
 * The shape §5.4 would most likely be amended into: keep the shipped signature
 * verbatim as the first overload, add the record one beneath it.
 */
export function combineOverloaded<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>>;
export function combineOverloaded<T extends ResultRecord>(
  results: T,
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[keyof T]>>;
export function combineOverloaded(
  results: readonly Result<unknown, unknown>[] | ResultRecord,
): Result<unknown, unknown> {
  if (Array.isArray(results)) {
    const values: unknown[] = [];
    for (const result of results as readonly Result<unknown, unknown>[]) {
      if (!result.ok) return result;
      values.push(result.value);
    }
    return ok(values);
  }

  const values: Record<string, unknown> = {};
  for (const key of Object.keys(results)) {
    const result = (results as ResultRecord)[key]!;
    if (!result.ok) return result;
    values[key] = result.value;
  }
  return ok(values);
}

/* -------------------------------------------------------------------------- */
/* Candidate 2 — one signature, Effect's conditional dispatch                  */
/* -------------------------------------------------------------------------- */

/**
 * Note the `infer`-in-place spelling rather than `OkTypeOf<T[K]>`.
 *
 * **This is not a style choice.** Inside the true branch of a conditional, `T`
 * is *not* narrowed to the checked type for the purpose of a mapped type's
 * index, so `OkTypeOf<T[K]>` fails its own constraint
 * (`Type 'T[K]' does not satisfy the constraint 'Result<unknown, unknown>'`)
 * even though the branch is only reachable when it does. Effect's `All.Return`
 * has exactly this spelling for exactly this reason.
 */
export type CombineReturn<T> = T extends readonly Result<unknown, unknown>[]
  ? Result<
      { [K in keyof T]: T[K] extends Result<infer A, unknown> ? A : never },
      T[number] extends Result<unknown, infer E> ? E : never
    >
  : T extends ResultRecord
    ? Result<
        { -readonly [K in keyof T]: T[K] extends Result<infer A, unknown> ? A : never },
        T[keyof T] extends Result<unknown, infer E> ? E : never
      >
    : never;

/**
 * The Effect spelling. `const T` is what recovers the tuple: without the
 * signature's `readonly [...T]` trick there is nothing else forcing an array
 * literal to infer positionally.
 */
export function combineUnified<
  const T extends readonly Result<unknown, unknown>[] | ResultRecord,
>(results: T): CombineReturn<T> {
  return combineOverloaded(results as ResultRecord) as CombineReturn<T>;
}

/* -------------------------------------------------------------------------- */
/* Candidate 3 — key attribution for `combineWithAllErrors`                    */
/* -------------------------------------------------------------------------- */

/** A: the shipped shape, unchanged — a flat array, key discarded. */
export function cwaeFlat<T extends ResultRecord>(
  results: T,
): Result<{ -readonly [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[keyof T]>[]> {
  const values: Record<string, unknown> = {};
  const errors: unknown[] = [];
  for (const key of Object.keys(results)) {
    const result = results[key]!;
    if (result.ok) values[key] = result.value;
    else errors.push(result.error);
  }
  return (
    errors.length > 0 ? err(errors) : ok(values)
  ) as Result<{ -readonly [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[keyof T]>[]>;
}

/** B: a partial record of errors, keyed by the input's own keys. */
export type ErrorRecord<T extends ResultRecord> = {
  -readonly [K in keyof T]?: ErrTypeOf<T[K]>;
};

export function cwaeRecord<T extends ResultRecord>(
  results: T,
): Result<{ -readonly [K in keyof T]: OkTypeOf<T[K]> }, ErrorRecord<T>> {
  const values: Record<string, unknown> = {};
  const errors: Record<string, unknown> = {};
  let failed = false;
  for (const key of Object.keys(results)) {
    const result = results[key]!;
    if (result.ok) values[key] = result.value;
    else {
      failed = true;
      errors[key] = result.error;
    }
  }
  return (failed ? err(errors) : ok(values)) as Result<
    { -readonly [K in keyof T]: OkTypeOf<T[K]> },
    ErrorRecord<T>
  >;
}

/** C: tagged entries — an array (so order and duplicates survive) of `{ key, error }`. */
export type ErrorEntries<T extends ResultRecord> = {
  [K in keyof T]: { readonly key: K; readonly error: ErrTypeOf<T[K]> };
}[keyof T][];

export function cwaeEntries<T extends ResultRecord>(
  results: T,
): Result<{ -readonly [K in keyof T]: OkTypeOf<T[K]> }, ErrorEntries<T>> {
  const values: Record<string, unknown> = {};
  const errors: { key: string; error: unknown }[] = [];
  for (const key of Object.keys(results)) {
    const result = results[key]!;
    if (result.ok) values[key] = result.value;
    else errors.push({ key, error: result.error });
  }
  return (errors.length > 0 ? err(errors) : ok(values)) as Result<
    { -readonly [K in keyof T]: OkTypeOf<T[K]> },
    ErrorEntries<T>
  >;
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

interface Boom {
  readonly type: 'boom';
  readonly message: string;
}
const boom = (id: string): Boom => ({ type: 'boom', message: id });

describe('record form — the happy paths', () => {
  it('collects values under the same keys', () => {
    expect(combineOverloaded({ user: ok(1), posts: ok('a') })).toEqual({
      ok: true,
      value: { user: 1, posts: 'a' },
    });
  });

  it('the array form is untouched — same object, tuple order preserved', () => {
    expect(combineOverloaded([ok(1), ok('a')])).toEqual({ ok: true, value: [1, 'a'] });
  });

  it('empty object is ok({}) — the record analog of §5.4’s ok([]) identity', () => {
    expect(combineOverloaded({})).toEqual({ ok: true, value: {} });
  });

  it('returns the FIRST Err by identity, as the array form does', () => {
    const first = err(boom('first'));
    const second = err(boom('second'));
    expect(combineOverloaded({ a: first, b: second })).toBe(first);
  });
});

describe('what "first" means over object keys — the ordering trap', () => {
  it('follows JS property order, NOT source order: integer-like keys sort first', () => {
    const early = err(boom('written-second'));
    const late = err(boom('written-first'));
    // `10` is written first, `2` second — but `2` is an integer-like key, so it
    // is visited first. "First Err" over a record is not "first as written".
    const out = combineOverloaded({ 10: late, 2: early });
    expect(out).toBe(early);
  });

  it('non-integer string keys DO follow insertion order', () => {
    const first = err(boom('b'));
    expect(combineOverloaded({ b: first, a: err(boom('a')) })).toBe(first);
  });

  it('accumulation inherits the same order — cwae reports 2 before 10', () => {
    const out = cwaeEntries({ 10: err(boom('ten')), 2: err(boom('two')) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.map((e) => e.key)).toEqual(['2', '10']);
  });
});

describe('which properties count', () => {
  it('symbol-keyed entries are invisible — Object.keys does not see them', () => {
    const s = Symbol('hidden');
    const input = { a: ok(1), [s]: err(boom('unseen')) };
    // Compiles (a symbol key does not participate in the string index
    // signature) and silently succeeds, dropping the failure.
    expect(combineOverloaded(input as unknown as ResultRecord)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('inherited enumerable properties are ignored — own-only, like parseResult', () => {
    const proto = { inherited: err(boom('proto')) };
    const input = Object.create(proto) as ResultRecord;
    input['own'] = ok(1);
    expect(combineOverloaded(input)).toEqual({ ok: true, value: { own: 1 } });
  });

  it('a PRESENT key holding `undefined` crashes — the optional-key hole is a runtime one', () => {
    // `{ user: Result; posts?: Result }` type-checks against the record
    // constraint (see 11-object-combine-types.spike.ts), and a value of that
    // type may carry `posts: undefined` as an own enumerable key. The loop
    // reads `.ok` off it and throws — the handler-is-the-crash shape this
    // codebase has closed four times elsewhere.
    const input = { user: ok(1), posts: undefined } as unknown as ResultRecord;
    expect(() => combineOverloaded(input)).toThrow(TypeError);
  });

  it('a non-enumerable own property is ignored too', () => {
    const input: ResultRecord = { a: ok(1) };
    Object.defineProperty(input, 'hidden', {
      value: err(boom('hidden')),
      enumerable: false,
    });
    expect(combineOverloaded(input)).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('key attribution — the three candidate error shapes', () => {
  const input = { user: err(boom('u')), posts: ok(1), tags: err(boom('t')) };

  it('A (flat array) — order survives, attribution does not', () => {
    const out = cwaeFlat(input);
    expect(out).toEqual({ ok: false, error: [boom('u'), boom('t')] });
  });

  it('B (partial record) — attribution survives, order does not', () => {
    const out = cwaeRecord(input);
    expect(out).toEqual({ ok: false, error: { user: boom('u'), tags: boom('t') } });
  });

  it('C (tagged entries) — both survive', () => {
    const out = cwaeEntries(input);
    expect(out).toEqual({
      ok: false,
      error: [
        { key: 'user', error: boom('u') },
        { key: 'tags', error: boom('t') },
      ],
    });
  });

  it('B and C differ observably when a key is literally named like an Object member', () => {
    // The record shape is a plain object, so a key of `toString` lands as an
    // own property and reads back fine — but the shape is now something a
    // caller may iterate with `for...in` or spread into another object.
    const out = cwaeRecord({ toString: err(boom('ts')) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(Object.keys(out.error)).toEqual(['toString']);
  });
});

describe('the unified (Effect-shaped) candidate behaves identically at runtime', () => {
  it('array', () => {
    expect(combineUnified([ok(1), ok('a')])).toEqual({ ok: true, value: [1, 'a'] });
  });
  it('record', () => {
    expect(combineUnified({ a: ok(1) })).toEqual({ ok: true, value: { a: 1 } });
  });
});
