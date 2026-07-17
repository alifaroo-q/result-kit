/**
 * The successful half of a {@link Result}.
 *
 * Purely structural: any `{ ok: true, value }` **is** an `Ok<T>`, whoever built
 * it. There is no brand, so a value parsed from JSON or received across a
 * boundary flows straight in.
 */
export interface Ok<T> {
  /** Discriminant. Complete on its own — narrow with `if (result.ok)`. */
  readonly ok: true;

  /** The value produced by the successful operation. */
  readonly value: T;
}

/**
 * The failed half of a {@link Result}.
 *
 * Carries error *data*, not an exception. `E` is fully generic — the
 * `TypedError` convention is opt-in, never mandated by this channel.
 */
export interface Err<E> {
  /** Discriminant. Complete on its own — narrow with `if (result.ok)`. */
  readonly ok: false;

  /** The error payload carried by the failed operation. */
  readonly error: E;
}

/**
 * An operation that either succeeded with a `T` or failed with an `E`.
 *
 * The package's serializable source of truth. When `T` and `E` are
 * JSON-serializable, `JSON.parse(JSON.stringify(result))` is a valid,
 * structurally-identical `Result<T, E>` consumable with no re-wrapping — so a
 * `Result` may be an HTTP body, a queue message, or a `postMessage` payload.
 *
 * Two carve-outs: a populated `cause` on a `TypedError` may not be
 * JSON-safe (sanitize it before serializing), and a fluent wrapper must be
 * unwrapped with `.toResult()` before serializing.
 */
export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Extracts the success type of a {@link Result} — `OkTypeOf<Result<T, E>>` is `T`.
 *
 * Public because it already appears in `combine`'s signature (spec §5.4), so it
 * surfaces in hover and `.d.ts` output whether exported or not, and a symbol a
 * user can see but cannot import is strictly worse (spec §10.2). Type-only:
 * zero runtime, zero bundle.
 *
 * @remarks
 * Distribution over the union is what does the work: `Ok<T> | Err<E>` is tried
 * one member at a time, `Err<E>` fails the `Ok<infer T>` check, and the result
 * is `T | never` — i.e. `T`.
 */
export type OkTypeOf<R extends Result<unknown, unknown>> =
  R extends Ok<infer T> ? T : never;

/**
 * Extracts the error type of a {@link Result} — `ErrTypeOf<Result<T, E>>` is `E`.
 *
 * The mirror of {@link OkTypeOf}, and public for the same reason (spec §10.2).
 * Applied to a union of `Result`s it yields the union of their error types,
 * which is how `combine` accumulates `ErrTypeOf<T[number]>`.
 */
export type ErrTypeOf<R extends Result<unknown, unknown>> =
  R extends Err<infer E> ? E : never;

/**
 * Builds a successful {@link Result}.
 *
 * The no-arg overload covers the common `Result<void, E>` success: prefer
 * `return ok()` over `ok(undefined)`.
 *
 * Returns the **narrow** `Ok<T>` rather than `Result<T, never>` — strictly more
 * precise, and it still assigns into any `Result<T, E>` annotation.
 */
export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | void> {
  return { ok: true, value: value as T };
}

/**
 * Builds a failed {@link Result}.
 *
 * The single generic failure constructor — there is no separate typed `fail`.
 * The `TypedError` convention is expressed by *what you pass*, not by a second
 * constructor.
 *
 * Returns the **narrow** `Err<E>` rather than `Result<never, E>`.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Narrows a {@link Result} to its successful half.
 *
 * Emits a type predicate, so `if (isOk(r)) { r.value }` narrows. Works on any
 * structurally-valid `Result` — including one parsed from JSON — because the
 * union carries no brand.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Narrows a {@link Result} to its failed half.
 *
 * Emits a type predicate, so `if (isErr(r)) { r.error }` narrows.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
