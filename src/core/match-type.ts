import type { TypedError } from './error';

/**
 * The handler bag for the exhaustive form: one arm per variant, each receiving
 * its **narrowed** variant.
 *
 * Every arm returns `unknown` rather than a shared `U`. That is the whole
 * mechanism — see {@link matchType}'s first note.
 */
type Arms<E extends TypedError> = {
  [K in E['type']]: (variant: Extract<E, { type: K }>) => unknown;
};

/** {@link Arms}, every key optional — the bag the fallback form accepts. */
type PartialArms<E extends TypedError> = {
  [K in E['type']]?: (variant: Extract<E, { type: K }>) => unknown;
};

/**
 * Rejects an arm keyed on a tag that is not in `E`.
 *
 * `H extends Arms<E>` alone is satisfied by a bag with *extra* keys, and
 * object-literal freshness does not fire against a type parameter — so a typo'd
 * tag compiles as a dead arm that never runs. Intersecting this clause into the
 * parameter types the stray key as `never`, and the error points at the
 * offending arm rather than at the call.
 */
type NoStrayArms<E extends TypedError, H> = Record<
  Exclude<keyof H, E['type']>,
  never
>;

/** {@link matchType}'s message when the tag has no arm and no fallback. */
const NO_ARM = 'matchType: no handler for error type';

/**
 * Collapses a `TypedError` union to a single value by dispatching on `type` —
 * **exhaustive by construction**, and an expression rather than a statement.
 *
 * ```ts
 * const status = matchType(error, {
 *   not_found: () => 404,
 *   forbidden: () => 403,
 *   conflict: (e) => (e.details!.slug ? 409 : 400),
 * });                                  // a missing arm is a compile error
 *
 * matchType(error, { not_found: () => 404 }, (e) => 500);
 * //                                            ^ e: forbidden | conflict
 * ```
 *
 * It lives in §3 rather than §5 for the same reason the formatters do (§3.4):
 * it operates on a `TypedError`, not on a `Result`. Reach it from a `Result`
 * through §5.3's `match` — `match(r, { ok: …, err: (e) => matchType(e, …) })`.
 *
 * Three things in the signature are load-bearing, each proved by the [#73
 * prototype](https://github.com/alifaroo-q/result-kit/issues/73) rather than
 * chosen for style:
 *
 * 1. **Never a single naked `U` across the arms.** Writing
 *    `(variant) => U` for every arm is *worse* than the trap §5.3's `match`
 *    documents: there, `U` locks to the first candidate and the second branch
 *    is a hard error. Here `U` does not infer at all — the call compiles and
 *    the result is silently `unknown`, even when every arm agrees. Inferring
 *    the bag `H` and returning `ReturnType<H[keyof H]>` unions the arms'
 *    returns instead, collapsing to one type where they agree.
 * 2. **{@link NoStrayArms} stays.** Without it a typo'd tag is a dead arm.
 * 3. **The fallback is a third parameter, not a `_` key in the bag.** A `_` arm
 *    sharing the bag cannot be narrowed to the *residual* variants under any
 *    formulation tried, currying included — `H` absorbs `_`, the `Exclude`
 *    resolves against a not-yet-inferred `H`, and the arm lands on `never`. As
 *    its own parameter the bag's key set is known before it is typed, so the
 *    fallback sees exactly the variants left over. Residual narrowing is the
 *    reason to prefer this over `switch`; the form that cannot deliver it does
 *    not ship, the same "typed honestly or not at all" line §10.9 draws.
 *
 * @remarks
 * Two facts about `TypedError` that this function makes prominent without
 * causing:
 *
 * - **`details` is optional**, so an arm reads `v.details!.id`. Narrowing the
 *   *tag* does not make the payload non-optional.
 * - **The bare `TypedError` cannot be exhausted.** Its open `string` tag maps
 *   to an index signature, so *any* bag satisfies it — `{}` included, which
 *   returns `never`. Exhaustiveness is a property of a closed tag union, not of
 *   this API.
 *
 * @throws {Error} when the tag has no arm and no fallback was supplied. Only
 * reachable by defeating the types (an `as any` cast, or a value crossing a
 * runtime boundary with a tag its type did not admit) — but silence there would
 * return `undefined` under a type promising otherwise, so it throws instead.
 */
export function matchType<E extends TypedError, H extends Arms<E>>(
  error: E,
  handlers: H & NoStrayArms<E, H>,
): ReturnType<H[keyof H]>;
export function matchType<E extends TypedError, H extends PartialArms<E>, R>(
  error: E,
  handlers: H & NoStrayArms<E, H>,
  fallback: (variant: Exclude<E, { type: keyof H }>) => R,
): ReturnType<NonNullable<H[keyof H]>> | R;
export function matchType(
  error: TypedError,
  handlers: Record<string, ((variant: TypedError) => unknown) | undefined>,
  fallback?: (variant: TypedError) => unknown,
): unknown {
  // `hasOwnProperty`, not a bare index read: a tag of `toString` or
  // `constructor` would otherwise find `Object.prototype`'s member and call it.
  const arm = Object.prototype.hasOwnProperty.call(handlers, error.type)
    ? handlers[error.type]
    : undefined;

  if (typeof arm === 'function') {
    return arm(error);
  }

  if (fallback !== undefined) {
    return fallback(error);
  }

  throw new Error(`${NO_ARM} "${error.type}"`);
}
