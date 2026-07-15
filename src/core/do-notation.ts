import type { Err, Result } from './result';

/**
 * The error types carried by a union of {@link Err}s.
 *
 * Distributive, so `Err<A> | Err<B>` unpacks to `A | B`. Internal — not part of
 * the §5.9 export list. Do not confuse it with the public `ErrTypeOf`, which
 * extracts from a `Result`, not from an `Err` union.
 */
type ErrorOf<Y> = Y extends Err<infer E> ? E : never;

/**
 * Guards the one invariant `safeUnwrap`'s generators cannot express in types:
 * they are suspended at a short-circuit and must never be resumed. `safeTry`
 * never resumes one, so this fires only for a caller driving the adapter by
 * hand — where silently returning `undefined` as `T` would be far worse.
 */
const RESUMED_AFTER_SHORT_CIRCUIT =
  'safeUnwrap: generator resumed after short-circuit — drive it with safeTry';

/**
 * Makes a {@link Result} `yield*`-able inside a {@link safeTry} block.
 *
 * Yields `Err<E>` — the short-circuit signal `safeTry` consumes — and *returns*
 * `T`, so `const v = yield* safeUnwrap(r)` binds the unwrapped value, and each
 * `yield*` in a block binds its own type.
 *
 * Iterability lives here rather than on the union itself. Putting
 * `[Symbol.iterator]` on what `ok()` / `err()` produce would reopen §2's
 * no-brand guarantee — and with it the §2.1 JSON round-trip — for the sake of
 * optional sugar. The data stays plain; only the adapter is iterable.
 *
 * The value-or-promise overload is the byethrow model the transforms already
 * use: inside an `async function*`, a `Promise<Result>` unwraps with zero
 * `await` ceremony.
 */
export function safeUnwrap<T, E>(result: Result<T, E>): Generator<Err<E>, T>;
export function safeUnwrap<T, E>(
  result: Promise<Result<T, E>>,
): AsyncGenerator<Err<E>, T>;
export function safeUnwrap<T, E>(
  result: Result<T, E> | Promise<Result<T, E>>,
): Generator<Err<E>, T> | AsyncGenerator<Err<E>, T> {
  if (result instanceof Promise) {
    return (async function* () {
      const awaited = await result;
      if (awaited.ok) return awaited.value;
      yield awaited;
      throw new Error(RESUMED_AFTER_SHORT_CIRCUIT);
    })();
  }

  return (function* () {
    if (result.ok) return result.value;
    yield result;
    throw new Error(RESUMED_AFTER_SHORT_CIRCUIT);
  })();
}

/**
 * Runs a do-notation block: a flat body where each fallible step is
 * `yield* safeUnwrap(...)`, and any `Err` short-circuits the whole block.
 *
 * The generator returns a `Result` **explicitly** (`return ok(v)`, or an early
 * `return err(e)`); this returns it directly and never auto-wraps a bare value.
 * One overloaded runner covers both worlds — a `function*` returns `Result`, an
 * `async function*` returns `Promise<Result>`. There is no `safeTryAsync`.
 *
 * The error channel is union-accumulated: `Result<T, E₁ | … | Eₙ | Eᵣ>`, the
 * same rule `andThen` uses (do-notation *is* `andThen` chaining with nicer
 * syntax). Errors union rather than convert — TypeScript has no `From` trait, so
 * there is no Rust-style coercion.
 *
 * @example
 * ```ts
 * const total = safeTry(function* () {
 *   const user  = yield* safeUnwrap(findUser(id));    // Err short-circuits
 *   const order = yield* safeUnwrap(loadOrder(user)); // binds its own type
 *   return ok(user.credit + order.total);
 * });
 * ```
 *
 * `Y` is a **naked** type parameter, and that is load-bearing — see the note on
 * the implementation below.
 */
export function safeTry<Y extends Err<unknown>, T = never, E = never>(
  body: () => Generator<Y, Result<T, E>>,
): Result<T, E | ErrorOf<Y>>;
export function safeTry<Y extends Err<unknown>, T = never, E = never>(
  body: () => AsyncGenerator<Y, Result<T, E>>,
): Promise<Result<T, E | ErrorOf<Y>>>;

/**
 * Three details here are load-bearing. Each was established by prototype and is
 * pinned by a type-level test in `test/core/do-notation.spec.ts` — none of them
 * fails visibly on a happy-path call site.
 *
 * 1. `Y` is naked. Spelling the yield slot `Generator<Err<E>, ...>` instead makes
 *    TypeScript decompose the yielded union into one inference candidate per
 *    constituent and keep only the first, silently collapsing
 *    `NotFound | Forbidden` to `NotFound`. A naked `Y` captures the union whole;
 *    `ErrorOf<Y>` then distributes it back out.
 *
 * 2. `T` and `E` default to `never`. In a body whose only exit is `return ok(v)`,
 *    nothing matches the `Err<E>` arm of `Result<T, E>`, so `E` gets no inference
 *    candidate and would fall back to `unknown` — and `unknown | ErrorOf<Y>`
 *    swallows the accumulated union. A default applies exactly when inference
 *    finds no candidate, so a body that does `return err(...)` still infers `E`
 *    from it. `never` is also the honest answer: a block with nothing fallible
 *    has an uninhabited error channel.
 *
 * 3. The implementation signature is deliberately loose. It cannot see that `Y`
 *    relates to `ErrorOf<Y>`, and the two public overloads above are what callers
 *    get. It needs no cast: a yielded `Err<unknown>` and a returned
 *    `Result<unknown, unknown>` are both already `Result<unknown, unknown>`.
 */
export function safeTry(
  body: () =>
    | Generator<Err<unknown>, Result<unknown, unknown>>
    | AsyncGenerator<Err<unknown>, Result<unknown, unknown>>,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  // One `.next()` — which is the whole short-circuit mechanism. A body suspended
  // at its first `yield` is never resumed, so every later step is unreachable.
  // A yielded Err and a returned Result are both the answer, so `.value` is the
  // result either way and no `done` branch is needed.
  const next = body().next();

  return next instanceof Promise
    ? next.then((settled) => settled.value)
    : next.value;
}
