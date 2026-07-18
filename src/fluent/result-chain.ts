import {
  isErr as coreIsErr,
  isOk as coreIsOk,
  type Result,
} from '../core/result';
import { isSettledResult } from '../core/thenable';
import type { SettledOr } from '../core/thenable';
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

import { ResultAsync } from './result-async';

/**
 * Re-wraps whatever a core transform handed back into the matching envelope.
 *
 * **Restored by §10.11**, having been deleted by §10.9 as "the defect". That was
 * wrong, and the deletion was a net regression. `wrap()` was never the thing
 * that made the sync→async seam unsound — the *async-callback arm* was, and
 * removing that arm is what fixed it. What `wrap()` actually did was cope with
 * the case where the core returns a promise anyway, which §2's brandless union
 * still permits: a structurally valid `{ ok: true, value }` may also carry a
 * `then`, and then the core's own `isThenable` sends it down the async path.
 * Without this, that promise was stuffed into a `ResultChain` and `.toResult()`
 * returned a `Promise` typed as a settled `Result` — `.ok` reading `undefined`,
 * a success read as a failure. With it, the caller gets a `ResultAsync`, which
 * is what the return type now admits.
 *
 * It reads the core's decision rather than making a second one.
 */
function wrap<U, F>(
  out: Result<U, F> | Promise<Result<U, F>>,
): ResultChain<U, F> | ResultAsync<U, F> {
  return isSettledResult(out)
    ? new ResultChain(out as Result<U, F>)
    : ResultAsync.from(out as Promise<Result<U, F>>);
}

/**
 * The fluent counterpart of §10.11's {@link SettledOr}: a settled wrapper when
 * the callback cannot return a thenable, and the honest pair when it can.
 */
type ChainOr<U, C, A> = [Extract<U, PromiseLike<unknown>>] extends [never]
  ? C
  : C | A;

/**
 * What the core transforms return for the calls this class makes.
 *
 * That is a stronger statement than it was before §10.9, and it is now true by
 * construction rather than by convention: every member below rejects a
 * thenable-returning callback via `NoThenableReturn`, and the input is always
 * this instance's settled `#result`. Neither the input nor the output can be
 * asynchronous, so there is nothing left to sniff. The `wrap()` helper that used
 * to re-detect it is gone — it was the thing that made the sync→async seam
 * silently wrong on the short-circuit branch, because a callback that never runs
 * produces no thenable to detect.
 */
type Settled<U, F> = Result<U, F> | Promise<Result<U, F>>;

/**
 * The four guarded core transforms, re-typed **without** §10.7's
 * `NoThenableReturn` rest parameter — and for a mechanical reason, not to opt out
 * of the guard.
 *
 * The guard is a conditional over the callback's return type. Inside these
 * generic members that type is still an unresolved type *parameter*, so TS
 * cannot reduce the conditional to the empty tuple, the guarded arm stops
 * matching, and the call falls through to the promise-input arm. The guard
 * exists to protect **call sites**, and `ResultChain` re-declares it on its own
 * public arms below — where `U` *is* resolved, because a user supplied the
 * callback. This delegation is not a call site any consumer can reach: it is
 * already fully cast, and `#result` is native-private.
 *
 * Stated once here for the same reason {@link Settled} is: better one explained
 * alias than four unexplained casts.
 */
const mapUnguarded = coreMap as unknown as <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
) => Settled<U, E>;
const mapErrUnguarded = coreMapErr as unknown as <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
) => Settled<T, F>;
const inspectUnguarded = coreInspect as unknown as <T, E>(
  result: Result<T, E>,
  fn: (value: T) => unknown,
) => Settled<T, E>;
const inspectErrUnguarded = coreInspectErr as unknown as <T, E>(
  result: Result<T, E>,
  fn: (error: E) => unknown,
) => Settled<T, E>;

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
   * Native-private, so the envelope cannot be picked apart or impersonated by a
   * structural look-alike. `.toResult()` is the only way out — which is what
   * makes rule 1 enforceable rather than aspirational. See the constructor note
   * for what this does *not* claim.
   */
  readonly #result: Result<T, E>;

  /**
   * @internal Not part of the §6.3 surface. `ResultChain` is exported as a
   * **type**, so the name is not importable and instances come from `ok` /
   * `err` / `from`.
   *
   * That is a hiding, not a gate, and an earlier version of this note overstated
   * it as "no consumer can reach this" (§10.9). The constructor is still
   * reachable at runtime — `new (ok(1).constructor)(someResult)` builds a
   * working instance. What the native-private `#result` *does* guarantee is that
   * an instance cannot be **impersonated** by a look-alike object: every member
   * throws on a foreign receiver. Forging one requires the real constructor and
   * yields a genuine, well-formed wrapper, so it buys an attacker nothing.
   */
  constructor(result: Result<T, E>) {
    this.#result = result;
  }

  /**
   * Transforms the value of an `Ok`, passing an `Err` through untouched.
   *
   * **Synchronous only.** An async callback is a compile error; cross to §6.2's
   * surface with {@link ResultChain.toAsync} first.
   *
   * @remarks
   * Every member of this class used to carry a second, async-callback arm
   * returning a `ResultAsync` — the implicit sync→async seam. **§10.9 removed
   * all six**, because the wrapper decided sync-vs-async by inspecting what the
   * callback returned, and on the short-circuit branch the callback never runs:
   * `err.map(async …)` was declared `ResultAsync` and handed back a
   * `ResultChain`, so `await` yielded the wrapper itself and a success read as a
   * failure. No amount of arm *ordering* fixed that — the information simply is
   * not there at runtime.
   *
   * What remains is sound by two separate means, and §10.9 originally claimed
   * only the first while asserting both. A thenable-returning callback is now
   * **typed honestly** rather than rejected, so the return type admits the
   * `ResultAsync` the runtime can produce; and a thenable-carrying *input* —
   * which §2's brandless union permits — is read as the settled `Result` it is,
   * by `isSettledResult`. `wrap()` reads whichever the core produced. Nothing
   * here is "sound by construction"; it is sound by two checks that were each
   * verified to fire.
   */
  map<U>(
    fn: (value: T) => U,
  ): ChainOr<U, ResultChain<Awaited<U>, E>, ResultAsync<Awaited<U>, E>> {
    return wrap(mapUnguarded(this.#result, fn)) as never;
  }

  /** Transforms the error of an `Err`, passing an `Ok` through untouched. */
  mapErr<F>(
    fn: (error: E) => F,
  ): ChainOr<F, ResultChain<T, Awaited<F>>, ResultAsync<T, Awaited<F>>> {
    return wrap(mapErrUnguarded(this.#result, fn)) as never;
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

  /**
   * Tees the value of an `Ok` for a side effect, returning it unchanged.
   *
   * @remarks
   * `R` captures the callback's return type rather than discarding it as `void`,
   * which is what lets `NoThenableReturn` see a promise at all — under a plain
   * `=> void` arm the void-return rule silently accepted `async (u) => log(u)`
   * and floated it unawaited. An ordinary value-returning tee like
   * `(u) => arr.push(u)` is still accepted; only a thenable return is rejected.
   */
  inspect<R>(
    fn: (value: T) => R,
  ): ChainOr<R, ResultChain<T, E>, ResultAsync<T, E>> {
    return wrap(inspectUnguarded(this.#result, fn)) as never;
  }

  /**
   * Tees the error of an `Err` for a side effect, returning it unchanged. The
   * mirror of {@link ResultChain.inspect}; the same arm note applies.
   */
  inspectErr<R>(
    fn: (error: E) => R,
  ): ChainOr<R, ResultChain<T, E>, ResultAsync<T, E>> {
    return wrap(inspectErrUnguarded(this.#result, fn)) as never;
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
   * Crosses to the async surface (§6.2) — **the sync→async seam, made explicit**
   * (§10.9).
   *
   * The seam used to be implicit: passing an async callback to `.map()` returned
   * a `ResultAsync`. That was silently wrong on the short-circuit branch. The
   * wrapper decided sync-vs-async by inspecting what the callback returned, and
   * on an `Err` the callback never runs — so `err.map(async …)` was declared
   * `ResultAsync` and handed back a `ResultChain`. Awaiting a non-thenable
   * yields the object itself, so callers read `.ok` off the wrapper as
   * `undefined` and a success was reported as a failure. Data-dependent, no
   * throw: §10.6's signature failure.
   *
   * The rule that replaced it: **a settled input cannot produce an asynchronous
   * output.** Async work starts from a promise, and this is how you get one —
   * after which every `ResultAsync` member is sound, because its input is always
   * a promise and its output is a promise on both branches.
   *
   * ```ts
   * ok(user).map(charge).toAsync().andThen(saveRemote).match({ ok, err });
   * ```
   *
   * Lossless and total: it wraps the settled `Result` this instance already
   * holds, so it cannot fail and adds one microtask, not a round trip.
   */
  toAsync(): ResultAsync<T, E> {
    return ResultAsync.from(Promise.resolve(this.#result));
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
