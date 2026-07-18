import type { Err, Ok, Result } from './result';
import { isSettledResult, isThenable } from './thenable';

/**
 * The error types carried by a union of {@link Err}s.
 *
 * Distributive, so `Err<A> | Err<B>` unpacks to `A | B`. Internal — not part of
 * the §5.9 export list. Do not confuse it with the public `ErrTypeOf`, which
 * extracts from a `Result`, not from an `Err` union.
 */
type ErrorOf<Y> = Y extends Err<infer E> ? E : never;

/**
 * The `Ok` half of the same decomposition — `ValueOf<Ok<T> | Err<E>>` is `T`.
 *
 * **Internal**, and distinct from the public `OkTypeOf` for the same reason
 * {@link ErrorOf} is distinct from `ErrTypeOf`: this one distributes over a bare
 * union of halves, which is what a naked return-slot parameter captures.
 */
type ValueOf<R> = R extends Ok<infer T> ? T : never;

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
 *
 * The async arm takes `PromiseLike`, and detects a thenable rather than asking
 * `instanceof Promise` — spec §10.6, the same rule the §5.2 transforms follow,
 * for the same reason and via the same `isThenable`. This shipped in [#23] with
 * an `instanceof` check and was a **live silent-wrong-value bug**, not a
 * speculative one: a native cross-realm promise typechecks as
 * `Promise<Result<T, E>>`, awaits correctly, fails `instanceof`, took the sync
 * branch, read `.ok` as `undefined` and yielded the raw promise as a malformed
 * `Err`. Fixed in [#28]; pinned by a cross-realm regression test.
 */
export function safeUnwrap<T, E = never>(result: Result<T, E>): Generator<Err<E>, T>;
export function safeUnwrap<T, E = never>(
  result: PromiseLike<Result<T, E>>,
): AsyncGenerator<Err<E>, T>;
export function safeUnwrap<T, E = never>(
  result: Result<T, E> | PromiseLike<Result<T, E>>,
): Generator<Err<E>, T> | AsyncGenerator<Err<E>, T> {
  if (!isSettledResult(result)) {
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
 * `Y` and `R` are both **naked** type parameters, and that is load-bearing —
 * see the note on the implementation below.
 */
export function safeTry<
  Y extends Err<unknown>,
  R extends Result<unknown, unknown>,
>(body: () => Generator<Y, R>): Result<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>;
export function safeTry<
  Y extends Err<unknown>,
  R extends Result<unknown, unknown>,
>(
  body: () => AsyncGenerator<Y, R>,
): Promise<Result<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>>;

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
 * 2. **`R` is naked too, and for the identical reason as `Y`** (§10.9). The
 *    return slot was originally spelled `Result<T, E>` with `T`/`E` defaulting to
 *    `never` — which handled a body whose only exit is `return ok(v)`, but broke
 *    on the shape ADR 0007 §6 explicitly blesses: two distinct
 *    `return err(...)` exits. Non-naked, they give `E` two inference candidates,
 *    and the call fails to resolve *at all* — a hard `TS2769`, not a silent
 *    collapse. Note 1 had already found this exact mechanism one slot over; the
 *    return channel simply never got the same treatment.
 *
 *    A naked `R` captures the returned union whole, and `ValueOf`/`ErrorOf`
 *    distribute it back out. The `never` defaults become unnecessary rather than
 *    merely relocated: a body that only returns `ok(v)` infers `R = Ok<T>`, and
 *    `ErrorOf<Ok<T>>` is `never` — the same honest answer the default gave, now
 *    derived instead of asserted.
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
  // result either way and no `done` branch is needed *for the value*.
  //
  // The generator itself is a different matter (§10.9). Suspending it is what
  // short-circuits, but leaving it suspended strands the body mid-execution and
  // its `finally` blocks never run — so a `try/finally` released its resource on
  // the success path (the generator completes normally) and leaked it on the
  // error path, which is the path cleanup exists for. Silent: the `Result` is
  // correct either way. `.return()` resumes the body at the `yield` as though it
  // were a `return`, which runs every pending `finally` and closes it.
  const generator = body();
  const next = generator.next();

  // `done` distinguishes the two exits: a *returned* Result means the body ran
  // to completion and already unwound itself, while a *yielded* Err means it is
  // parked and owes us its `finally` blocks. Closing a completed generator is a
  // no-op, but branching says which case is load-bearing.
  // Returns whatever `.return()` gave back, because an `async function*` closes
  // asynchronously — its `finally` runs in a microtask, so the caller's promise
  // must not settle until that has finished. Dropping this value would resolve
  // `safeTry` before the body released anything, which is the same leak one turn
  // later.
  const release = (
    settled: IteratorResult<unknown, unknown>,
  ): unknown | undefined =>
    settled.done ? undefined : generator.return(undefined as never);

  // Thenable-detected for the same §10.6 reason as `safeUnwrap` above, and it is
  // the same live bug, not a precaution: `body` is the *caller's* generator, so
  // an `async function*` defined in another realm returns a foreign promise from
  // `.next()`. Under `instanceof` that took the sync branch and read `.value` off
  // a promise — `safeTry` returned `undefined` where it promised
  // `Promise<Result<T, E>>`. Verified against a real cross-realm generator, not
  // reasoned about. `#28` found this one; §10.6's debt note named only
  // `safeUnwrap`.
  //
  // `Promise.resolve` normalizes: accept any thenable, hand back a native
  // promise, exactly as the transforms do at their boundary.
  if (isThenable(next)) {
    return Promise.resolve(next).then(async (settled) => {
      await release(settled);
      return settled.value;
    });
  }

  release(next);
  return next.value;
}
