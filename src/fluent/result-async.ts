import type { Result } from '../core/result';
import {
  match as coreMatch,
  toNullable as coreToNullable,
  unwrapOr as coreUnwrapOr,
  unwrapOrElse as coreUnwrapOrElse,
  unwrapOrThrow as coreUnwrapOrThrow,
} from '../core/terminals';
import {
  andThen as coreAndThen,
  inspect as coreInspect,
  inspectErr as coreInspectErr,
  map as coreMap,
  mapErr as coreMapErr,
  orElse as coreOrElse,
} from '../core/transforms';

/**
 * The awaitable async wrapper (spec §6.2, [ADR 0009]) — one `await` at the
 * front, a terminal at the end, no `await` ceremony in between:
 *
 * ```ts
 * const displayName = await ok(token)
 *   .andThen(requireSession)
 *   .andThen(findUser)              // → ResultAsync
 *   .map((user) => user.name)
 *   .match({ ok: (n) => n, err: () => 'anon' });
 * ```
 *
 * **The rule: `ResultAsync` is `ResultChain`, lifted** — every value-terminal
 * mirrored with a `Promise`-lifted return — with two deliberate departures: no
 * guards, and a throwing `toJSON`. One sentence a reader can hold; any subset
 * draws a line that has to be memorized, and *"why can I `await ra.match()` but
 * not `await ra.unwrapOr()`?"* has no principled answer.
 *
 * **Terminal handlers stay synchronous** — only the *return* is lifted. Async
 * work belongs upstream in `.andThen()`. (A deliberate departure from v1, whose
 * `AsyncResultPipeline.match` took `Awaitable<U>` handlers.)
 *
 * @remarks
 * ADR 0009 exists because an earlier reading derived a chaining-only surface
 * from ADR 0005 §2's "terminals stay strictly synchronous". That reading is
 * **withdrawn** (§10.4): ADR 0005 §2 is scoped to the *functional core*, and its
 * objection — inference cost of a value-or-promise **overload** — does not
 * transfer to an unconditionally-async *method* on a class that already
 * represents an in-flight result. Do not re-derive it.
 *
 * Exported as a **value** (class), because ADR 0005 §4 specifies the static
 * `ResultAsync.from`. The asymmetry with `ResultChain` — free `from` for sync, a
 * static for async — is as-decided; do not "fix" it without a new decision.
 */
export class ResultAsync<T, E> implements PromiseLike<Result<T, E>> {
  readonly #promise: Promise<Result<T, E>>;

  private constructor(promise: Promise<Result<T, E>>) {
    this.#promise = promise;
  }

  /**
   * Lifts a `Promise<Result<T, E>>` that is **already** a union into the wrapper.
   *
   * Not interchangeable with `fromPromise`, and the difference is the whole
   * argument of §10.5: this takes a promise that has already entered the result
   * world, while `fromPromise` catches a **rejection** off a raw `Promise<T>`.
   * Neither substitutes for the other.
   */
  static from<T, E>(promise: Promise<Result<T, E>>): ResultAsync<T, E> {
    return new ResultAsync(promise);
  }

  /**
   * Transforms the value of an `Ok`.
   *
   * @remarks
   * The cast on every chaining member below is load-bearing and safe, and it is
   * the one place this class is not a pure re-export of a core signature. The
   * core's overloads are written for a caller who knows *at the call site*
   * whether their callback is async; here `fn` is `U | Promise<U>` — a union the
   * core resolves to `Result<U | Promise<U>, E>` because neither arm dominates.
   * The **runtime is already correct**: the core detects a thenable and awaits
   * the mapped value, so what comes back is a flat `Promise<Result<U, E>>`. The
   * cast states what the code does; it does not change it.
   */
  map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U, E> {
    return ResultAsync.from(
      coreMap(this.#promise, fn) as Promise<Result<U, E>>,
    );
  }

  /** Transforms the error of an `Err`. */
  mapErr<F>(fn: (error: E) => F | Promise<F>): ResultAsync<T, F> {
    return ResultAsync.from(
      coreMapErr(this.#promise, fn) as Promise<Result<T, F>>,
    );
  }

  /** Chains a fallible step onto an `Ok`, accumulating the error channel. */
  andThen<U, F>(
    fn: (value: T) => Result<U, F> | Promise<Result<U, F>>,
  ): ResultAsync<U, E | F> {
    return ResultAsync.from(
      coreAndThen(
        this.#promise,
        fn as (value: T) => Result<U, F>,
      ) as Promise<Result<U, E | F>>,
    );
  }

  /** Recovers from an `Err`, accumulating the success channel. */
  orElse<U, F>(
    fn: (error: E) => Result<U, F> | Promise<Result<U, F>>,
  ): ResultAsync<T | U, F> {
    return ResultAsync.from(
      coreOrElse(
        this.#promise,
        fn as (error: E) => Result<U, F>,
      ) as Promise<Result<T | U, F>>,
    );
  }

  /** Tees the value of an `Ok` for a side effect, returning it unchanged. */
  inspect(fn: (value: T) => void | Promise<void>): ResultAsync<T, E> {
    return ResultAsync.from(
      coreInspect(this.#promise, fn) as Promise<Result<T, E>>,
    );
  }

  /** Tees the error of an `Err` for a side effect, returning it unchanged. */
  inspectErr(fn: (error: E) => void | Promise<void>): ResultAsync<T, E> {
    return ResultAsync.from(
      coreInspectErr(this.#promise, fn) as Promise<Result<T, E>>,
    );
  }

  /**
   * Collapses to a single value by handling both branches — `Promise`-lifted,
   * with **synchronous** handlers.
   *
   * Two inference slots, `UOk | UErr`, carrying §5.3's amendment. §6.2 is
   * explicit that this must be fixed **here** and not merely delegated: binding
   * `T` and `E` on the class buys the method nothing, because `U` is still naked
   * across both callbacks, and `ra.match({ ok: (u) => u.credit, err: () =>
   * 'anon' })` fails to compile for the same first-candidate-wins reason. The
   * hero example in §6.2 is *not* affected — both branches return `string` —
   * which is exactly why this trap survives a happy-path reading.
   */
  async match<UOk, UErr = UOk>(cases: {
    ok: (value: T) => UOk;
    err: (error: E) => UErr;
  }): Promise<UOk | UErr> {
    return coreMatch(await this.#promise, cases);
  }

  /** Extracts the value of an `Ok`, falling back to `defaultValue`. */
  async unwrapOr(defaultValue: T): Promise<T> {
    return coreUnwrapOr(await this.#promise, defaultValue);
  }

  /** Extracts the value of an `Ok`, computing the fallback from the error. */
  async unwrapOrElse(fn: (error: E) => T): Promise<T> {
    return coreUnwrapOrElse(await this.#promise, fn);
  }

  /**
   * Extracts the value of an `Ok`, **rejecting** the promise on an `Err`.
   *
   * Rejects rather than throwing synchronously — idiomatic in an async context,
   * and the only option that survives `await`. The `Error` construction and its
   * `cause` come from the core terminal, unchanged.
   */
  async unwrapOrThrow(message?: string): Promise<T> {
    return coreUnwrapOrThrow(await this.#promise, message);
  }

  /** Extracts the value of an `Ok`, or `null`. */
  async toNullable(): Promise<T | null> {
    return coreToNullable(await this.#promise);
  }

  /** Exits to the plain `Promise<Result<T, E>>`. */
  toResult(): Promise<Result<T, E>> {
    return this.#promise;
  }

  /**
   * The `PromiseLike` contract — and **`await`-collapse is a guarantee, not an
   * accident** (ADR 0005 §5, safety property 1).
   *
   * `await ra` yields the plain `Result` union **by design**, exactly equivalent
   * to `await ra.toResult()`. Awaiting *is* the sanctioned exit from the fluent
   * async surface. This equivalence is the mitigation for the footgun that
   * spawned ADR 0005, so it is pinned by test rather than left to hold by
   * coincidence.
   *
   * It also **closes the floating-thenable gap v1's custom thenable left open**
   * (safety property 3): because this is a stock `PromiseLike`, a floating
   * un-`await`ed `ResultAsync` is flagged by plain
   * `@typescript-eslint/no-floating-promises` for free. **Do not reimplement
   * `then` in any way that defeats that rule** — delegate to the promise and
   * nothing more.
   */
  then<TResult1 = Result<T, E>, TResult2 = never>(
    onfulfilled?:
      | ((value: Result<T, E>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#promise.then(onfulfilled, onrejected);
  }

  /**
   * **Throws.** `ResultChain`'s lossless net (§6.1) cannot be built here.
   *
   * `JSON.stringify` is synchronous and the value is not available yet, so the
   * accident is lossy no matter what: returning a `Promise` serializes `{}`, and
   * omitting `toJSON` serializes `{}` too. The only real choice is **silent vs.
   * loud**, and ADR 0008 §6 fixed this project's stance on that axis.
   */
  toJSON(): never {
    throw new TypeError(
      'Cannot serialize an in-flight ResultAsync. ' +
        'await it first, then serialize the Result: JSON.stringify(await resultAsync)',
    );
  }
}
