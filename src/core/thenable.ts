import type { Result } from './result';

/**
 * Detects a thenable, not specifically a `Promise` — and the distinction is a
 * correctness fix, not a stylistic one (spec §10.6).
 *
 * **Internal.** Not in §5.9's export list, and never re-exported from the
 * barrel.
 *
 * `instanceof Promise` asks which *realm* a value was born in. A native promise
 * from a `vm` context, worker, or iframe is a `Promise<Result<T, E>>` as far as
 * TypeScript is concerned — it typechecks, it awaits — and `instanceof Promise`
 * still says `false`. Branch on that and the failure is silent: the value takes
 * the plain-`Result` path, `.ok` reads `undefined`, the err branch is taken, and
 * the caller gets the raw promise typed as a `Result`. No throw, just a wrong
 * value with a confident type. `test/core/transforms.spec.ts` and
 * `test/core/do-notation.spec.ts` each pin it with a real cross-realm promise.
 *
 * `await` and `Promise.resolve` are themselves defined on thenables, so this
 * check is what agrees with the language; `instanceof` was the deviation.
 * `ResultAsync` (§6.2) implements `PromiseLike` and rides along for free, but it
 * is a beneficiary — not the reason. This check would be correct with `/fluent`
 * deleted.
 *
 * A `Result` produced by `ok()` / `err()` is `{ ok, value }` / `{ ok, error }`
 * and carries no `then`. **It does not follow that the check cannot misfire on
 * the union, and an earlier version of this note claimed exactly that** (§10.9).
 * §2 makes the union *purely structural with no brand*, so any `{ ok: true,
 * value }` **is** an `Ok<T>` — including one that also has a `then`, which
 * excess-property checking never sees because it fires only on fresh object
 * literals. Verified: such a value passes `isOk`, and `map(it, syncCallback)`
 * deadlocks on the **input** branch with a purely synchronous callback. The
 * no-brand invariant is what makes the misfire possible, not what prevents it.
 *
 * A callback's **return** is inspected too, and under an identity `map` the
 * input and the return are the same object. Which leads to the price:
 *
 * **Known limitation (spec §10.7): a non-promise object with a callable `then`
 * is assimilated, and if its `then` never invokes a callback, it deadlocks.**
 *
 * ```ts
 * const builder = { tag: 'builder', then(next) { return this } }; // a workflow
 * map(ok(builder), (v) => v);        // a Promise that never settles
 * ```
 *
 * This is **inherited from the language, not chosen**. `PromiseResolveThenableJob`
 * assimilates on exactly one condition — `IsCallable(thenAction)` — so plain
 * `await builder` hangs identically with no library involved. TypeScript declines
 * to unwrap a `then` that takes no value-receiving callback, so it types the
 * object as settled; that discrepancy is TC39's and TypeScript's, and it exists
 * with or without this package.
 *
 * It is **not fixable here**, and the reason is specific to this codebase rather
 * than a general one. Every runtime technique that excludes the builder —
 * `util.types.isPromise`, `Object.prototype.toString`, a `Promise.prototype.then`
 * brand probe — is a check for a *native* promise, and `ResultAsync` (§6.2) is
 * not one: it is a hand-written class that `implements PromiseLike`. Each of
 * those checks therefore returns `false` for this package's own headline type,
 * reintroducing the §10.6 failure above on the most common path there is. A rare
 * third-party false positive would be traded for a guaranteed false negative on
 * our own surface. Detecting the hang instead is undecidable: a legitimately slow
 * thenable and a never-calling one are observationally identical at every finite
 * observation time, so any timeout is a policy that eventually cancels valid
 * work.
 *
 * **What the ecosystem actually does**, surveyed against current source rather
 * than reputation, because an earlier draft of this note got it wrong in both
 * directions. No consumer library gates on a *native brand* — that much holds.
 * But several do not accept a bare `then` either: `@praha/byethrow`,
 * `p-is-promise`, and zod's data classifier all require **`then` and `catch`**,
 * which would exclude the builder above.
 *
 * **That option was examined and rejected (§10.8), on a rule worth keeping:
 * the runtime check must never be narrower than the published type.**
 * `PromiseLike<T>` has exactly one member in TypeScript's own `lib.es5.d.ts` —
 * `then` — so every §5.2 signature accepting `PromiseLike` is a published
 * promise to handle a `then`-only thenable. Requiring `catch` breaks it
 * silently: `{ then(r) { r(42) } }` matches the async arm, tsc says
 * `Promise<Result<number, E>>`, and the runtime hands back a sync `Result`
 * wrapping the raw thenable. §10.6's failure mode, from a check that is too
 * *narrow* instead of too broad.
 *
 * The libraries above are not disagreeing with us — they publish `Promise` in
 * their types, and every real `Promise` has a `catch`, so their check matches
 * their signature. Ours accepts `PromiseLike`, so ours must not. zod likewise
 * uses `instanceof Promise` for its *internal* control flow, sound only because
 * it owns both ends; we do not.
 *
 * Note also that Bluebird, core-js, and promise-polyfill read `then` exactly
 * once through a `try`/`catch` (Promises/A+ 2.3.3.1) while none of the consumers
 * do — and that split is not carelessness. A+ is scoped "by implementers, for
 * implementers", and 2.3.3.2's remedy is to *reject the promise you are
 * implementing*. A pure consumer has no such promise, so the clause has no
 * subject. See §10.7 for why adopting it here would be regressive.
 *
 * The blast radius is narrow: this is never applied to arbitrary user data, only
 * to a `Result`-typed input or the return of a user callback. Reaching the
 * deadlock means returning a `.then`-bearing domain object from a `map` /
 * `andThen` callback — which `await` would hang on just the same.
 *
 * @remarks
 * It lives in its own module because more than one caller needs it — the §5.2
 * transforms and §5.7's `safeUnwrap` — and §10.6 makes *the check itself* the decision, so
 * it gets exactly one definition. Duplicating it per module would let the two
 * drift, and drift is invisible for precisely the reason above. The alternative
 * home was `transforms.ts`, but `do-notation.ts` has no business importing from
 * it.
 */
export function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    (typeof x === 'object' || typeof x === 'function') &&
    x !== null &&
    typeof (x as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * The **static** counterpart of {@link isThenable}, and the second half of the
 * same decision (spec §10.7, widened by §10.9, relocated by §10.11).
 *
 * A transform over a settled `Result` cannot promise an asynchronous output: it
 * may never call the callback at all, so on the short-circuit branch there is no
 * thenable to detect and the settled `Result` comes straight back. When the
 * callback's return type admits a thenable, the outcome is therefore genuinely
 * **branch-dependent**, and this says so.
 *
 * **It lives in the return type, and that position is the decision** (§10.11).
 * The first implementation spread the same conditional as a *rest parameter* so
 * the call could be rejected outright. That works only when `U` is resolved at
 * the call site: against an unresolved type parameter a conditional never
 * reduces, so the guarded arm stopped matching and **every generic wrapper over
 * `Result` failed to compile** —
 *
 * ```ts
 * function helper<A, B>(r: Result<A, string>, f: (a: A) => B) {
 *   return map(r, f);   // TS2769 under the parameter-position guard
 * }
 * ```
 *
 * — with no escape, since the guard type was not exported. It also had to
 * carve out `any` (whose conditional takes both branches and so always looked
 * thenable), and that carve-out let an `any`-returning callback claim a settled
 * `Result` while the runtime handed back a promise: the very failure the guard
 * existed to prevent, reintroduced by its own workaround.
 *
 * A conditional in *return* position has neither problem. It defers harmlessly
 * for a generic `U` and resolves once `U` is known, and `any` needs no special
 * case — it extracts to `PromiseLike<unknown>`, lands in the honest branch, and
 * gets the union it deserves. When `U` holds no thenable this **is** the plain
 * `Result<U, E>`, so ordinary synchronous code is unchanged.
 *
 * `await` collapses the union to the settled `Result`, which is what a caller
 * doing async work writes anyway.
 */
export type SettledOr<U, R> = [Extract<U, PromiseLike<unknown>>] extends [never]
  ? R
  : R | Promise<R>;

/**
 * Whether a value is a **settled `Result`**, used wherever the alternative is a
 * promise *of* one — and the fix for the hole §10.9 left open (§10.11).
 *
 * `isThenable` alone cannot make that call. §2 makes the union purely structural
 * with no brand, so any `{ ok: true, value }` **is** an `Ok<T>` — including one
 * that also carries a `then`, which excess-property checking never sees because
 * it fires only on fresh object literals. Ask "is this thenable?" first and such
 * a value is assimilated: the transform returns a `Promise` where its signature
 * promised a settled `Result`, `.ok` reads `undefined`, and a success is
 * reported as a failure. That reproduced on all six members of both surfaces.
 *
 * Asking "is this a `Result`?" first resolves it, because the two shapes are
 * distinguishable in the direction that matters: **a `Result` has a boolean
 * `ok`, and a promise of one does not.** So this is checked *before* falling
 * back to the thenable path, and §10.6's cross-realm fix is untouched — a
 * foreign `Promise<Result>` has no `ok`, still fails this, and still awaits.
 *
 * Deliberately narrower than `isOk`/`isErr`: those answer *which half*, this
 * answers *settled or pending*, and only the second question is being asked at
 * these call sites.
 */
export function isSettledResult<T, E>(
  x: Result<T, E> | PromiseLike<Result<T, E>>,
): x is Result<T, E> {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { ok?: unknown }).ok === 'boolean'
  );
}
