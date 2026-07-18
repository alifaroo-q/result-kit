import { err, ok } from './result';
import type { Err, ErrTypeOf, OkTypeOf, Result } from './result';

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
 */

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
 * @remarks
 * `readonly [...T]` rather than `readonly T[]` is what makes `T` infer as a
 * tuple instead of collapsing to an array of the element union, which is where
 * the per-position types would be lost.
 */
export function combine<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>> {
  const values: unknown[] = [];

  for (const result of results) {
    if (!result.ok) {
      return result as Err<ErrTypeOf<T[number]>>;
    }
    values.push(result.value);
  }

  return ok(values as { [K in keyof T]: OkTypeOf<T[K]> });
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
 */
export function combineWithAllErrors<
  T extends readonly Result<unknown, unknown>[],
>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>[]> {
  const values: unknown[] = [];
  const errors: ErrTypeOf<T[number]>[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error as ErrTypeOf<T[number]>);
    }
  }

  return errors.length > 0
    ? err(errors)
    : ok(values as { [K in keyof T]: OkTypeOf<T[K]> });
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
