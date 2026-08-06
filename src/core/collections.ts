import { renderPayload } from './render';
import { isResultLike } from './result-like';
import { err, ok } from './result';
import type { ErrTypeOf, OkTypeOf, Result } from './result';

/**
 * The three collection combinators (spec §5.4) — several `Result`s in, one
 * `Result` out.
 *
 * **Sync-only, and there are no promise overloads.** `await Promise.all([...])`
 * first, then hand the settled `Result[]` here. Overloading over *arrays of
 * unions* vs. *arrays of promises-of-unions* is a combinatorial inference mess
 * for a thin gain — a decided scope line (spec §5.4), not an oversight, pinned
 * by a `@ts-expect-error` per function in `test/core/collections.spec.ts`.
 *
 * These stay **free-function-only**: the `/fluent` wrapper mirrors only
 * functions operating on a single `Result` instance, so array-shaped functions
 * never gain a method form — re-enter fluent-land with `from(...)` (spec §6).
 *
 * The tuple preservation `combine` and `combineWithAllErrors` promise is a
 * type-level contract, so it is enforced by `pnpm check`, never `pnpm test`.
 *
 * **Both combinators also take a record** ("object form",
 * [ADR 0017](../../docs/adr/0017-object-form-combine.md),
 * [#95](https://github.com/alifaroo-q/result-kit/issues/95)) — the shipped
 * array signature stays verbatim and is declared first, with the record
 * overload beneath it. `partition` does **not** gain one: record support is a
 * property of the combinators, not of the section.
 *
 * The two overloads cannot collide. An array of `Result`s is *not* assignable
 * to `Record<string, Result<unknown, unknown>>` — `length` and `push` are not
 * `Result`s — so the record overload is unreachable for an array input
 * regardless of declaration order, and tuple preservation cannot degrade. That
 * is pinned as a `@ts-expect-error` on the assignability itself in
 * `test/core/collections.spec.ts`, so it survives a compiler upgrade rather
 * than resting on observed overload-resolution behaviour.
 */

/**
 * One accumulated error, still attached to the key it came from.
 *
 * The record form of {@link combineWithAllErrors} accumulates these; the array
 * form stays flat. The pair is **knowingly asymmetric** — a record knows the
 * name of each part, and throwing that away is the only reason not to pass one.
 * Over an array the key is the index, recoverable in principle from position;
 * over a record it is simply gone.
 *
 * `key` and `error` stay correlated per entry, so the union of entries is a
 * discriminated one and `switch (entry.key)` narrows `error` to that key's
 * variant. Over an index-signature record it degenerates honestly to
 * `KeyedError<string, E>` rather than pretending to a precision it does not
 * have.
 *
 * **No default type parameters.** A bare `KeyedError` would mean
 * `{ key: string; error: unknown }`, handing back exactly the `unknown` error
 * spec §3 exists to avoid.
 *
 * @remarks
 * The name is `KeyedError` rather than `TaggedError`: the latter is one letter
 * from the shipped `TypedError` and collides with Effect's `Data.TaggedError`.
 */
export type KeyedError<K extends PropertyKey, E> = {
  readonly key: K;
  readonly error: E;
};

/**
 * The diagnostic both combinators throw for an entry that is not a `Result`.
 *
 * A non-`Result` in the bag is a **programming error**, so this stays a hard
 * failure — skipping the entry silently would hide a real mistake. What
 * changed is only the report: reading `.ok` off `undefined` threw a bare
 * `TypeError: Cannot read properties of undefined`, naming neither the
 * combinator nor the offending key. It now reports through `render.ts`'s
 * diagnostic family, like every other throw in this package.
 *
 * `renderPayload` rather than a bare interpolation, for its own reasons: the
 * offending value is arbitrary, and a circular object or a `BigInt` would make
 * `JSON.stringify` throw a serializer crash in place of the diagnostic.
 */
function notAResult(fn: string, key: PropertyKey, value: unknown): TypeError {
  const where = typeof key === 'number' ? `index ${key}` : `key ${JSON.stringify(key)}`;

  return new TypeError(
    `${fn}: value at ${where} is not a Result (received: ${renderPayload(value)})`,
  );
}

/**
 * Which overload the caller took.
 *
 * A named guard rather than a bare `Array.isArray`, purely so the *false*
 * branch narrows: `Array.isArray`'s own `arg is any[]` does not subtract a
 * `readonly` array from the implementation signature's union, leaving the
 * record path indexing a type that may still be an array.
 */
function isArrayInput(value: object): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Rejects a non-array **iterable** rather than reading it as a record.
 *
 * Neither overload accepts one — a `Set<Result>` is not an array and has no own
 * enumerable keys — but the dispatch above sends everything that is not an
 * `Array` down the record path, where `Object.keys(new Set([…]))` is `[]` and
 * the answer would be a silent `ok({})`. The shipped `for...of` happened to
 * iterate it, so this is only reachable through a cast, but a silent wrong
 * answer is the one outcome this module's guard exists to rule out. §5.4
 * declined iterable support (that is Effect's `All.Return`, rejected in F15);
 * declining it *loudly* is the whole of the change.
 */
function isNonArrayIterable(value: object): boolean {
  return (
    typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

/**
 * Writes one key onto the success record.
 *
 * `Object.defineProperty` rather than `values[key] = …`, and it is not
 * fastidiousness: `__proto__` is an **accessor on `Object.prototype`**, so the
 * plain assignment sets the record's prototype instead of adding a key. A
 * `combine({ ['__proto__']: ok(1), b: ok(2) })` came back as `ok({ b: 2 })` with
 * the key gone — the record form's one promise, *keyed identically*, broken
 * silently — and with an object payload it mutated the returned value's
 * prototype instead. `parse.ts` reached past `in` for this same class of "the
 * obvious spelling disagrees with own-property semantics".
 */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Reads a record input into `[key, result]` pairs, **validating the whole bag
 * before either combinator reads any of it**.
 *
 * That ordering is deliberate. An optional key satisfies the record constraint
 * and may carry `undefined` as a *present* own key, so without this pass
 * `combine({ user: err(e), posts: undefined })` returns cleanly today and
 * crashes tomorrow from the same code — the first time `user` succeeds. A
 * programming error hiding behind a data error, on a schedule. Bags are a
 * handful of keys, so the pass is free; the array path guards as visited
 * instead, because a sparse array is reachable only through a cast and
 * `combine(rows)` over a large array should not pay a second traversal.
 *
 * `Object.keys` fixes the iteration order the combinators inherit: own
 * enumerable string keys, integer-like ones ascending before insertion-ordered
 * ones. Symbol keys never appear, which is the documented silent drop.
 */
function readEntries(
  fn: string,
  results: Readonly<Record<string, unknown>>,
): [string, Result<unknown, unknown>][] {
  if (isNonArrayIterable(results)) {
    throw new TypeError(
      `${fn}: expected an array or a record of Results, but received a non-array iterable`,
    );
  }

  const entries: [string, Result<unknown, unknown>][] = [];

  for (const key of Object.keys(results)) {
    const entry = results[key];

    if (!isResultLike(entry)) throw notAResult(fn, key, entry);

    entries.push([key, entry]);
  }

  return entries;
}

/**
 * Combines several {@link Result}s into one, **failing fast** on the first
 * `Err`.
 *
 * Preserves tuples: a heterogeneous input maps to a tuple of per-position
 * success types, with the homogeneous array as the special case. The error type
 * is the **union** of the inputs' error types, so a caller who combines a
 * `Result<A, NotFound>` with a `Result<B, Timeout>` handles `NotFound | Timeout`
 * and nothing wider.
 *
 * ```ts
 * combine([ok(1), ok('a')]); // Result<[number, string], never>
 * combine(rows);             // rows: Result<Row, ParseError>[] → Result<Row[], ParseError>
 * ```
 *
 * On success the values are unwrapped positionally; on failure the **first**
 * `Err` is returned by identity — the same object that was passed in — and no
 * later error reaches the caller. Empty input is `ok([])`, the identity that
 * makes `combine` fold-like.
 *
 * An entry that is not a `Result` throws {@link notAResult}. That is reachable
 * for an array only through a cast or a **sparse** array, over which `for...of`
 * yields `undefined` identically — the guard was never record-specific.
 *
 * @remarks
 * `readonly [...T]` rather than `readonly T[]` is what makes `T` infer as a
 * tuple instead of collapsing to an array of the element union, which is where
 * the per-position types would be lost.
 */
export function combine<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>>;

/**
 * Combines a **record** of {@link Result}s into one, **failing fast** on the
 * first `Err`, and returns a record keyed identically.
 *
 * The object form of the signature above. Positional destructuring is fine at
 * two elements and degrades from there — it is order-coupled, and the names
 * exist only at the call-site:
 *
 * ```ts
 * const combined = combine({ user: findUser(id), posts: listPosts(id) });
 * if (combined.ok) {
 *   const { user, posts } = combined.value; // names survive, order does not matter
 * }
 * ```
 *
 * **"First `Err`" means property order, not order as written.**
 * `combine({ 10: late, 2: early })` returns `early`, because `Object.keys`
 * yields integer-like keys in ascending numeric order *before* insertion-ordered
 * string keys. Only own enumerable properties participate, matching `parse.ts`.
 *
 * **Symbol keys are silently invisible.** A symbol-keyed `Err` does not join the
 * string index signature, so it type-checks and is dropped. Documented rather
 * than closed: it matches the §2.1 serialization boundary this package is built
 * around, and a per-call symbol scan would defend against a shape the type
 * system cannot express usefully.
 *
 * `combine({})` is `ok({})` — the empty-input identity in record form, not a
 * special case. An empty *array* still picks the array overload, so the two
 * never contend.
 *
 * The whole bag is validated **before** any of it is read, so an entry that is
 * not a `Result` throws {@link notAResult} deterministically rather than hiding
 * behind whichever `Err` happened to come first. The array path guards as
 * visited instead, because a sparse array is reachable only through a cast and
 * the hot path should not pay a second pass.
 *
 * @remarks
 * **`NonNullable<T[K]>` is required, not defensive.** With an optional key
 * `T[K]` is `Result<…> | undefined`, which fails {@link OkTypeOf}'s and
 * {@link ErrTypeOf}'s `R extends Result<unknown, unknown>` constraint — the
 * signature does not compile without it. Pinned by a type-level assertion in
 * `test/core/collections.spec.ts`.
 *
 * Optionality survives on the success side on purpose:
 * `{ posts?: Result<string, E> }` maps to `posts?: string | undefined`, which is
 * what the caller has. See {@link combineWithAllErrors} for why the error side
 * strips it.
 */
export function combine<T extends Record<string, Result<unknown, unknown>>>(
  results: T,
): Result<
  { [K in keyof T]: OkTypeOf<NonNullable<T[K]>> },
  ErrTypeOf<NonNullable<T[keyof T]>>
>;

export function combine(
  results: readonly Result<unknown, unknown>[] | Record<string, Result<unknown, unknown>>,
): Result<unknown, unknown> {
  if (isArrayInput(results)) {
    const values: unknown[] = [];

    for (let index = 0; index < results.length; index += 1) {
      const result: unknown = results[index];

      if (!isResultLike(result)) throw notAResult('combine', index, result);
      if (!result.ok) return result;

      values.push(result.value);
    }

    return ok(values);
  }

  const entries = readEntries('combine', results);
  const values: Record<string, unknown> = {};

  for (const [key, result] of entries) {
    if (!result.ok) return result;

    define(values, key, result.value);
  }

  return ok(values);
}

/**
 * Combines several {@link Result}s into one, **accumulating every error** into a
 * flat array in input order.
 *
 * The `ZodError.issues[]` analog, and the whole of the accumulation story for
 * this release — formatter helpers were declined and backlogged to
 * {@link https://github.com/alifaroo-q/result-kit/issues/18 | #18}. Use it
 * where a caller wants to report *all* that went wrong (form validation, a
 * parsed batch) rather than stopping at the first problem, which is
 * {@link combine}'s job.
 *
 * Tuple preservation on the success side is identical to `combine`'s; only the
 * error side differs, widening from `E` to `E[]`. Empty input is `ok([])` — no
 * errors accumulated means success, consistent with `combine`.
 *
 * The array form's errors stay **flat**, so they feed `groupByType` and
 * `prettifyErrors` directly. The record form does not — see below.
 */
export function combineWithAllErrors<
  T extends readonly Result<unknown, unknown>[],
>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>[]>;

/**
 * Combines a **record** of {@link Result}s, accumulating every error as a
 * {@link KeyedError} entry — the key it failed under, kept beside the error.
 *
 * ```ts
 * const checked = combineWithAllErrors({ name: checkName(i), age: checkAge(i) });
 * if (!checked.ok) {
 *   for (const entry of checked.error) {
 *     switch (entry.key) {
 *       case 'name': // entry.error narrows to checkName's error type
 *     }
 *   }
 * }
 * ```
 *
 * **A `KeyedError[]` is not accepted by `groupByType` or `prettifyErrors`**,
 * which take a flat `TypedError[]`. Bridge with `errors.map((e) => e.error)`.
 * That fork in the documented accumulation pipeline is the one real cost of the
 * asymmetry, so it is stated here where a reader meets it rather than only in
 * [ADR 0017](../../docs/adr/0017-object-form-combine.md).
 *
 * Ordering, symbol keys, the empty-input identity and the whole-bag-first
 * validation are all {@link combine}'s, inherited unchanged.
 *
 * @remarks
 * **`-?` appears on the error mapped type and deliberately not on the success
 * one, and the inconsistency is the point.** Optionality must survive on the
 * success side — `{ posts?: Result<string, E> }` gives `posts?: string |
 * undefined`, which is correct. On the error side an optional key without `-?`
 * puts `undefined` into the *entry union*, so `entry.error` reads as
 * `E | undefined`: spec §10.6's failure mode, and the defect that sank the
 * partial-record alternative this shape was chosen over. Both halves are pinned
 * by type-level assertions in `test/core/collections.spec.ts`.
 */
export function combineWithAllErrors<
  T extends Record<string, Result<unknown, unknown>>,
>(
  results: T,
): Result<
  { [K in keyof T]: OkTypeOf<NonNullable<T[K]>> },
  { [K in keyof T]-?: KeyedError<K, ErrTypeOf<NonNullable<T[K]>>> }[keyof T][]
>;

export function combineWithAllErrors(
  results: readonly Result<unknown, unknown>[] | Record<string, Result<unknown, unknown>>,
): Result<unknown, unknown> {
  if (isArrayInput(results)) {
    const values: unknown[] = [];
    const errors: unknown[] = [];

    for (let index = 0; index < results.length; index += 1) {
      const result: unknown = results[index];

      if (!isResultLike(result)) throw notAResult('combineWithAllErrors', index, result);

      if (result.ok) {
        values.push(result.value);
      } else {
        errors.push(result.error);
      }
    }

    return errors.length > 0 ? err(errors) : ok(values);
  }

  const entries = readEntries('combineWithAllErrors', results);
  const values: Record<string, unknown> = {};
  const errors: KeyedError<string, unknown>[] = [];

  for (const [key, result] of entries) {
    if (result.ok) {
      define(values, key, result.value);
    } else {
      errors.push({ key, error: result.error });
    }
  }

  return errors.length > 0 ? err(errors) : ok(values);
}

/**
 * Splits {@link Result}s into the successes that worked and the failures that
 * did not, preserving input order within each half.
 *
 * **Best-effort, and never fails** — it returns a plain tuple, not a `Result`.
 * This is the batch capability the all-or-nothing combinators cannot express:
 * process the rows that parsed *and* report the rows that did not, in one pass.
 * Empty input is `[[], []]`.
 *
 * ```ts
 * const [users, failures] = partition(rows.map(parseUser));
 * ```
 *
 * v1's `filterSuccesses` / `filterFailures` were each one half of this, and
 * neither survives (spec §9).
 *
 * @remarks
 * Takes a `readonly` array where spec §5.4 writes a mutable one. A strict
 * superset — every call the spec's signature accepted still resolves, inference
 * of `T` and `E` is untouched, and a `readonly Result<T, E>[]` that `combine`
 * already accepted no longer breaks at `partition`. Nothing here mutates the
 * input.
 */
export function partition<T = never, E = never>(results: readonly Result<T, E>[]): [T[], E[]] {
  const values: T[] = [];
  const errors: E[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  return [values, errors];
}
