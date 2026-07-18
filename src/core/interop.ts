import { err, ok } from './result';
import type { Result } from './result';

/**
 * The five ways **into** the `Result` world from code that does not speak
 * `Result` (spec §5.5, §5.6): a nullable value, a predicate, a throwing
 * function, a promise in hand, and an async throwing function.
 *
 * The two async constructors are the library's only rejection-catchers, and
 * that is why they exist rather than being absorbed by §5.2. The transforms
 * operate on `Promise<Result>` — a promise that has *already* entered the
 * result world — not on `Promise<T>`, so nothing there can catch a rejection.
 * Entering the async-result world from a raw promise is a **construction**
 * concern; no other function in the package can do this job.
 *
 * Both return a plain `Promise<Result<T, E>>` and import nothing from
 * `/fluent`, which is spec §4's self-sufficiency invariant in its sharpest
 * form: async works at the root, forever, without the wrapper.
 */

/**
 * Lifts a nullable value into a {@link Result}, mapping `null` / `undefined` to
 * `error`.
 *
 * The success type is `NonNullable<T>` — the nullish half is gone from the type,
 * not merely handled at runtime, so no downstream `?.` survives the call.
 *
 * ```ts
 * fromNullable(users.find(byId), notFound); // Result<User, NotFound>
 * ```
 *
 * @remarks
 * `== null` is the deliberate loose check: it is true for exactly `null` and
 * `undefined`, and for nothing else. `0`, `''`, `NaN` and `false` are values,
 * and all five reach the `Ok` channel.
 */
export function fromNullable<T, E>(
  value: T | null | undefined,
  error: E,
): Result<NonNullable<T>, E> {
  return value == null ? err(error) : ok(value as NonNullable<T>);
}

/**
 * Lifts a value into a {@link Result} if it satisfies `predicate`, and into
 * `error` if it does not.
 *
 * The **type-guard overload is net-new in 5.0.0**: hand it a
 * `(value: T) => value is S` and the success type narrows to `S`, so the
 * refinement the guard performs survives into the `Result` rather than being
 * discarded at the boundary.
 *
 * ```ts
 * fromPredicate(input, isEmail, invalid);        // Result<Email, Invalid>  — narrowed
 * fromPredicate(n, (x) => x > 0, notPositive);   // Result<number, NotPositive>
 * ```
 *
 * @remarks
 * The guard overload is declared **first** because TypeScript takes the first
 * arm that matches: a `value is S` function also satisfies `(value: T) =>
 * boolean`, so a boolean-first order would capture every guard in the plain arm
 * and silently drop the narrowing to `S`. That failure is invisible — it
 * typechecks and it runs — which is why the order is pinned by a type-level
 * assertion rather than left to reading.
 */
export function fromPredicate<T, S extends T, E>(
  value: T,
  predicate: (value: T) => value is S,
  error: E,
): Result<S, E>;
export function fromPredicate<T, E>(
  value: T,
  predicate: (value: T) => boolean,
  error: E,
): Result<T, E>;
export function fromPredicate<T, E>(
  value: T,
  predicate: (value: T) => boolean,
  error: E,
): Result<T, E> {
  return predicate(value) ? ok(value) : err(error);
}

/**
 * Wraps a throwing function into one that returns a {@link Result}, routing
 * whatever it threw through `errorFn` into the `E` channel.
 *
 * **Lazy and reusable** — it returns a *wrapped function*, not a result, so one
 * wrap serves every call site. (One-shot use is a thunk:
 * `fromThrowable(() => risky(x), toErr)()`.) Strictly more flexible than an
 * eager form, and it preserves the wrapped function's argument list — arity and
 * types both.
 *
 * ```ts
 * const parse = fromThrowable(JSON.parse, () => invalidJson);
 * parse(a); parse(b); // one wrap, many calls
 * ```
 *
 * @remarks
 * `errorFn` takes `unknown`, not `Error`, because JavaScript can throw
 * anything — a string, `undefined`, a plain object. Typing it `Error` would be
 * a lie the runtime disproves, and `unknown` forces the caller to decide what a
 * non-`Error` throw means in their `E`.
 */
export function fromThrowable<Args extends unknown[], T, E>(
  fn: (...args: Args) => T,
  errorFn: (error: unknown) => E,
): (...args: Args) => Result<T, E> {
  return (...args: Args): Result<T, E> => {
    try {
      return ok(fn(...args));
    } catch (error) {
      return err(errorFn(error));
    }
  };
}

/**
 * Lifts a promise already in hand into the async-result world, catching a
 * **rejection** into the `E` channel via `onReject`.
 *
 * This is the one-liner for the overwhelmingly common case, and one of the two
 * places a rejection can be caught at all — the §5.2 transforms take a
 * `Promise<Result>` and cannot.
 *
 * ```ts
 * const result = await fromPromise(fetch(url), toNetworkError);
 * ```
 *
 * Returns a plain `Promise<Result<T, E>>`: `await` it and you hold ordinary
 * data. No wrapper, no new async type — spec §4's self-sufficiency invariant.
 *
 * Accepts `PromiseLike<T>`, not `Promise<T>` (§10.9). The `await` inside has
 * always handled any thenable — the narrower parameter was rejecting values the
 * implementation ran correctly, and it disagreed with §5.2, which takes
 * `PromiseLike` throughout for §10.6's cross-realm reason. A pure widening:
 * every `Promise` is a `PromiseLike`, so no existing call site is lost.
 */
export async function fromPromise<T, E>(
  promise: PromiseLike<T>,
  onReject: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(onReject(error));
  }
}

/**
 * Wraps an async throwing function into one that returns a
 * `Promise<Result<T, E>>`, catching rejections through `onReject`.
 *
 * The reusable-wrapper symmetry with sync {@link fromThrowable}: same laziness,
 * same preserved argument list, same one-wrap-many-calls shape.
 *
 * **Not an `xAsync` double in the cut sense.** The nine v1 doubles died because
 * a value-or-promise overload absorbs them (spec §9); this one has no such
 * absorber, because no sync `fromThrowable` overload catches a *rejection*.
 * The name — `fromThrowableAsync`, not `fromAsyncThrowable` — reads as "the
 * async variant of `fromThrowable`" and is the one async name v1 users already
 * know.
 *
 * @remarks
 * A sync `throw` from `fn` — reachable when `fn` is a plain function returning
 * a promise rather than an `async` one, and the throw happens before the
 * promise is constructed — lands in the `E` channel too, not as a synchronous
 * exception out of the wrapper. The `try` covers the call itself, not merely
 * the `await`, so the wrapper's contract holds for every `(...args) =>
 * Promise<T>`, however it was written.
 */
export function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => Promise<Result<T, E>> {
  return async (...args: Args): Promise<Result<T, E>> => {
    try {
      return ok(await fn(...args));
    } catch (error) {
      return err(onReject(error));
    }
  };
}
