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
