import { err, ok } from './result';
import type { Result } from './result';
import { isThenable } from './thenable';

/**
 * Every transform below shares one overload pattern, and its **arm order is
 * load-bearing** — it is the reason these six live in one module and were built
 * as one unit.
 *
 * TypeScript resolves overloads top-down and takes the first arm that matches,
 * so the async-callback arm must be declared **before** the sync-callback arm.
 * Spec §5.2 presents them in the opposite order; that ordering is
 * presentational, and implementing it literally is wrong in two distinct ways:
 *
 * 1. `map`'s sync arm is `fn: (value: T) => U` with `U` unconstrained, so an
 *    async callback matches it with `U = Promise<X>` — yielding
 *    `Result<Promise<X>, E>` instead of `Promise<Result<X, E>>`.
 * 2. `inspect`'s sync arm is worse: `() => Promise<void>` *is* assignable to
 *    `() => void` under TypeScript's void-return rule, so a sync-first arm
 *    swallows every async tee and drops the await.
 *
 * Reversed, the arms are mutually exclusive — a sync callback's `U` cannot match
 * `PromiseLike<U>` — so each call falls through to exactly the right arm. The
 * signatures §5.2 specifies are unchanged; only their order is.
 *
 * Neither failure raises at runtime. `test/core/transforms.spec.ts` pins every
 * arm, and `pnpm check` is the only thing that runs those assertions.
 */

/**
 * Maps the value inside an `Ok`, leaving an `Err` untouched.
 *
 * The `Err` branch is passed through by **identity**, not rebuilt — `map` on a
 * failure returns the very same object it was given.
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => PromiseLike<U>,
): Promise<Result<U, E>>;
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E>;
export function map<T, U, E>(
  result: PromiseLike<Result<T, E>>,
  fn: (value: T) => PromiseLike<U>,
): Promise<Result<U, E>>;
export function map<T, U, E>(
  result: PromiseLike<Result<T, E>>,
  fn: (value: T) => U,
): Promise<Result<U, E>>;

/**
 * The promise-input arm is split in two rather than written as §5.2's single
 * `fn: (value: T) => U | PromiseLike<U>`. Against that union an async callback
 * offers TypeScript two inference candidates for `U` — `Promise<X>` from the
 * naked arm and `X` from the `PromiseLike<U>` arm — and the naked one wins,
 * collapsing the result to `Promise<Result<Promise<X>, E>>`. Two arms give each
 * callback exactly one candidate. The resolved input/output pairs are identical
 * to the three §5.2 specifies.
 */
export function map(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (value: unknown) => unknown,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (!settled.ok) return settled;

    const mapped = fn(settled.value);

    return isThenable(mapped)
      ? Promise.resolve(mapped).then((value) => ok(value))
      : ok(mapped);
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}

/**
 * Maps the error inside an `Err`, leaving an `Ok` untouched.
 *
 * This is v1's `mapError`, renamed. The `Ok` branch is passed through by
 * identity.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => PromiseLike<F>,
): Promise<Result<T, F>>;
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F>;
export function mapErr<T, E, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (error: E) => PromiseLike<F>,
): Promise<Result<T, F>>;
export function mapErr<T, E, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (error: E) => F,
): Promise<Result<T, F>>;
export function mapErr(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (error: unknown) => unknown,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (settled.ok) return settled;

    const mapped = fn(settled.error);

    return isThenable(mapped)
      ? Promise.resolve(mapped).then((error) => err(error))
      : err(mapped);
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}

/**
 * Chains a fallible step onto an `Ok`, short-circuiting an `Err`.
 *
 * **Accumulates the error union `E | F`** — the highest-value inference
 * behaviour in the design. Do not "simplify" this to a monomorphic
 * `Result<U, E>`: that reintroduces the fp-ts `chainW` / `mapLeft` gymnastics
 * the planning map explicitly rejected, and it fails silently — a collapsed
 * union is invisible until a consumer handles an error the types said could not
 * occur.
 */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => PromiseLike<Result<U, F>>,
): Promise<Result<U, E | F>>;
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F>;
export function andThen<T, U, E, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (value: T) => PromiseLike<Result<U, F>>,
): Promise<Result<U, E | F>>;
export function andThen<T, U, E, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (value: T) => Result<U, F>,
): Promise<Result<U, E | F>>;
export function andThen(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (
    value: unknown,
  ) => Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (!settled.ok) return settled;

    const next = fn(settled.value);

    return isThenable(next) ? Promise.resolve(next) : next;
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}

/**
 * Recovers from an `Err`, leaving an `Ok` untouched.
 *
 * **Accumulates the success union `T | U`** — the mirror of `andThen`'s error
 * accumulation, and the same warning applies. The `Ok` branch is passed through
 * by identity.
 */
export function orElse<T, E, U, F>(
  result: Result<T, E>,
  fn: (error: E) => PromiseLike<Result<U, F>>,
): Promise<Result<T | U, F>>;
export function orElse<T, E, U, F>(
  result: Result<T, E>,
  fn: (error: E) => Result<U, F>,
): Result<T | U, F>;
export function orElse<T, E, U, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (error: E) => PromiseLike<Result<U, F>>,
): Promise<Result<T | U, F>>;
export function orElse<T, E, U, F>(
  result: PromiseLike<Result<T, E>>,
  fn: (error: E) => Result<U, F>,
): Promise<Result<T | U, F>>;
export function orElse(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (
    error: unknown,
  ) => Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (settled.ok) return settled;

    const next = fn(settled.error);

    return isThenable(next) ? Promise.resolve(next) : next;
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}

/**
 * Tees a side effect off the `Ok` branch and returns the result **unchanged** —
 * by identity, not a copy.
 */
export function inspect<T, E>(
  result: Result<T, E>,
  fn: (value: T) => PromiseLike<unknown>,
): Promise<Result<T, E>>;
export function inspect<T, E>(
  result: Result<T, E>,
  fn: (value: T) => void,
): Result<T, E>;
export function inspect<T, E>(
  result: PromiseLike<Result<T, E>>,
  fn: (value: T) => unknown,
): Promise<Result<T, E>>;

/**
 * The tee arms widen §5.2's `Promise<void>` / `void | Promise<void>` callbacks,
 * and each widening buys a specific failure:
 *
 * - `PromiseLike<unknown>` on the async arm, not `PromiseLike<void>`. An async
 *   callback whose body ends in a value-returning call — `async (u) => log(u)`
 *   where `log` returns anything — is a `Promise<X>`, which is *not* assignable
 *   to `PromiseLike<void>`. It would fall through to the sync arm, typecheck via
 *   the void-return rule, and float the promise unawaited.
 * - `unknown` on the promise-input arm, not `void | PromiseLike<void>`. The
 *   void-return rule fires only when the target return type is exactly `void`,
 *   never for a union containing it — so `void | PromiseLike<void>` would reject
 *   the ordinary `(u) => arr.push(u)`. That arm always returns a `Promise`
 *   regardless of what the callback gives back, so `unknown` costs nothing.
 */
export function inspect(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (value: unknown) => unknown,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (!settled.ok) return settled;

    const teed = fn(settled.value);

    return isThenable(teed)
      ? Promise.resolve(teed).then(() => settled)
      : settled;
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}

/**
 * Tees a side effect off the `Err` branch and returns the result **unchanged** —
 * by identity, not a copy. The mirror of {@link inspect}; the same widening note
 * applies to its arms.
 */
export function inspectErr<T, E>(
  result: Result<T, E>,
  fn: (error: E) => PromiseLike<unknown>,
): Promise<Result<T, E>>;
export function inspectErr<T, E>(
  result: Result<T, E>,
  fn: (error: E) => void,
): Result<T, E>;
export function inspectErr<T, E>(
  result: PromiseLike<Result<T, E>>,
  fn: (error: E) => unknown,
): Promise<Result<T, E>>;
export function inspectErr(
  result: Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
  fn: (error: unknown) => unknown,
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> {
  const step = (settled: Result<unknown, unknown>) => {
    if (settled.ok) return settled;

    const teed = fn(settled.error);

    return isThenable(teed)
      ? Promise.resolve(teed).then(() => settled)
      : settled;
  };

  return isThenable(result)
    ? Promise.resolve(result).then(step)
    : step(result);
}
