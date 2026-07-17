import {
  isErr as coreIsErr,
  isOk as coreIsOk,
  type Result,
} from '../core/result';
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
 * The sync fluent wrapper (spec §6.1) — **the documented hero** of 5.0.0.
 *
 * A **transient ergonomic envelope, never the interchange or serialized type**
 * (spec §4, rule 1). Chain with zero ceremony, then leave through `.toResult()`
 * and hold the plain union again:
 *
 * ```ts
 * import { ok } from '@zireal/result-kit/fluent';
 *
 * ok(user).map(charge).andThen(save).match({ ok: receipt, err: report });
 * ```
 *
 * **One implementation** (spec §4, rule 2). Every member below delegates
 * one-to-one to the same core free function — this is a thin envelope, not a
 * second codebase. Nothing here reimplements the core's logic, which is why the
 * core's decisions (union-accumulating error channels, `match`'s per-branch
 * inference slots, `unwrapOrThrow`'s `cause` handling) hold identically on this
 * side without being restated.
 *
 * **The wrapper mirrors only single-instance functions.** Array- and
 * entry-shaped ones — `combine`, `partition`, `from*`, `isTypedError` — stay
 * free-function-only; re-enter fluent-land with `from(...)`.
 *
 * @remarks
 * `ResultChain` was named by **spec §10.1, not by any ADR** — all eight say "the
 * wrapper". The pair reads asymmetrically (`ResultChain` / `ResultAsync`), and
 * that is an accepted, recorded cost. Do not "fix" it.
 *
 * The class is exported as a **type only**: instances come from `ok` / `err` /
 * `from` / `safeTry`, never `new`.
 */
export class ResultChain<T, E> {
  /**
   * Native-private, so the envelope cannot be picked apart or impersonated.
   * `.toResult()` is the only way out — which is what makes rule 1 enforceable
   * rather than aspirational.
   */
  readonly #result: Result<T, E>;

  /**
   * @internal Not part of the §6.3 surface. `ResultChain` is exported as a type,
   * so no consumer can reach this — instances come from `ok` / `err` / `from`.
   */
  constructor(result: Result<T, E>) {
    this.#result = result;
  }

  /** Transforms the value of an `Ok`, passing an `Err` through untouched. */
  map<U>(fn: (value: T) => U): ResultChain<U, E> {
    return new ResultChain(coreMap(this.#result, fn));
  }

  /** Transforms the error of an `Err`, passing an `Ok` through untouched. */
  mapErr<F>(fn: (error: E) => F): ResultChain<T, F> {
    return new ResultChain(coreMapErr(this.#result, fn));
  }

  /**
   * Chains a fallible step onto an `Ok`, accumulating the error channel to
   * `E | F` — the same rule the core `andThen` uses.
   */
  andThen<U, F>(fn: (value: T) => Result<U, F>): ResultChain<U, E | F> {
    return new ResultChain(coreAndThen(this.#result, fn));
  }

  /** Recovers from an `Err`, accumulating the success channel to `T | U`. */
  orElse<U, F>(fn: (error: E) => Result<U, F>): ResultChain<T | U, F> {
    return new ResultChain(coreOrElse(this.#result, fn));
  }

  /** Tees the value of an `Ok` for a side effect, returning it unchanged. */
  inspect(fn: (value: T) => void): ResultChain<T, E> {
    return new ResultChain(coreInspect(this.#result, fn));
  }

  /** Tees the error of an `Err` for a side effect, returning it unchanged. */
  inspectErr(fn: (error: E) => void): ResultChain<T, E> {
    return new ResultChain(coreInspectErr(this.#result, fn));
  }

  /**
   * Collapses to a single value by handling both branches — exhaustive by
   * construction, and **the type-safe way to narrow on this side**.
   *
   * Two inference slots, `UOk | UErr`, for the reason spec §5.3's note gives and
   * §10 says applies identically here: a single naked `U` across both callbacks
   * takes its *first* inference candidate rather than unioning them, locking `U`
   * to the `ok` branch and rejecting the `err` branch outright.
   */
  match<UOk, UErr = UOk>(cases: {
    ok: (value: T) => UOk;
    err: (error: E) => UErr;
  }): UOk | UErr {
    return coreMatch(this.#result, cases);
  }

  /** Extracts the value of an `Ok`, falling back to `defaultValue`. */
  unwrapOr(defaultValue: T): T {
    return coreUnwrapOr(this.#result, defaultValue);
  }

  /** Extracts the value of an `Ok`, computing the fallback from the error. */
  unwrapOrElse(fn: (error: E) => T): T {
    return coreUnwrapOrElse(this.#result, fn);
  }

  /** Extracts the value of an `Ok`, **throwing** a real `Error` on an `Err`. */
  unwrapOrThrow(message?: string): T {
    return coreUnwrapOrThrow(this.#result, message);
  }

  /** Extracts the value of an `Ok`, or `null`. */
  toNullable(): T | null {
    return coreToNullable(this.#result);
  }

  /**
   * Whether this is an `Ok` — a **plain boolean, not a type predicate**.
   *
   * A method cannot emit a predicate that narrows its own class's generics the
   * way a free function narrows a plain union: there is no `this is
   * ResultChain<T, never>` that would refine `T` and `E` at the call site. So
   * `if (chain.isOk())` tells you *which branch*, and buys **no narrowing** —
   * `.unwrapOr()` still demands a fallback inside the `if`.
   *
   * It exists so a hero-path user reaching for `if (result.isOk())` does not hit
   * a DX cliff. Nothing more. **Type-safe narrowing on the fluent side goes
   * through `.match()` / the terminals**, which is why they take both branches.
   * `test/fluent/result-chain.spec.ts` pins the limitation so it is
   * discoverable rather than folklore.
   */
  isOk(): boolean {
    return coreIsOk(this.#result);
  }

  /** Whether this is an `Err` — a **plain boolean**, for the reason on {@link isOk}. */
  isErr(): boolean {
    return coreIsErr(this.#result);
  }

  /**
   * Exits to the plain `Result<T, E>` — the documented way out, and the only
   * shape §2.1's JSON round-trip guarantee covers.
   */
  toResult(): Result<T, E> {
    return this.#result;
  }

  /**
   * The **pit-of-success net**: an accidental `JSON.stringify(chain)` silently
   * emits the correct plain union instead of leaking class internals — the
   * `Date.prototype.toJSON` idiom.
   *
   * It makes the mistake lossless; it does **not** replace the documented
   * `.toResult()` path. Without it, `JSON.stringify` on a `#result`-carrying
   * class yields `{}` — the private field is invisible to the serializer — so
   * the failure mode this prevents is silent data loss, not an error.
   */
  toJSON(): Result<T, E> {
    return this.toResult();
  }
}
