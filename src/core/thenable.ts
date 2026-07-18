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
 * `true` only for `any`, via the one idiom that detects it: `any` is
 * simultaneously assignable to and from everything, so it is the sole type for
 * which `0 extends 1 & T` holds.
 *
 * {@link NoThenableReturn} needs this because `Extract<any, PromiseLike<unknown>>`
 * is **not** `never` — a conditional over `any` takes both branches, so it
 * reduces to `PromiseLike<unknown>` and the guard would fire. That would reject
 * every callback whose return type is `any`: an untyped JS callback, a
 * `vi.fn()` mock, anything crossing an untyped library boundary. `any` asserts
 * nothing about whether a promise is involved, so the honest answer is to let it
 * through rather than to reject on a technicality. `unknown` needs no such
 * carve-out — it extracts to `never` and passes already.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The **static** counterpart of {@link isThenable}, and the second half of the
 * same decision (spec §10.7, widened by §10.9).
 *
 * It rejects **any** callback whose return type can be a thenable, on a
 * transform whose input is a settled `Result`. Two defects converge here:
 *
 * 1. §10.7 — a callback returning `U | Promise<U>` (`cache.get(id) ??
 *    fetch(id)`) matched the sync arm with `U` = the whole union, so the caller
 *    was promised a settled `Result` and handed a `Promise` whenever the value
 *    happened to arrive asynchronously.
 * 2. §10.9 — a *purely* async callback had its own arm, which promised a
 *    `Promise` the implementation could not always deliver: on the short-circuit
 *    branch the callback never runs, so there is no thenable to detect and the
 *    settled `Result` came straight back. That arm is gone, and this guard is
 *    what now catches those calls.
 *
 * Both produce the same failure — `.ok` reads `undefined`, the err branch is
 * silently taken, `.error` is `undefined` though no error occurred — and both
 * are data-dependent, so they survive testing.
 *
 * The rule underneath is §10.9's: **a synchronous `Result` input cannot produce
 * an asynchronous output**, because the transform may never call the callback at
 * all. Async work starts from a promise — `map(Promise.resolve(r), fn)`, or
 * `chain.toAsync()` on the fluent surface — where the output is a promise on
 * every branch.
 *
 * This rejects those at the call site. Spreading it as a **rest
 * parameter** is what makes it work: `U` stays in a naked inference position in
 * the callback's return type, so inference is untouched, and the conditional is
 * evaluated only *after* `U` is known. Encoding the same check as
 * `U extends PromiseLike<unknown> ? never : U` on the parameter itself does not
 * work — a conditional type is not an inference site, so `U` collapses to
 * `unknown` and every call site degrades.
 *
 * When `U` contains no thenable this is the empty tuple: no extra argument, and
 * the resolved signature is byte-identical to what it was without the guard.
 * When it does, the call requires an argument that cannot be supplied, and the
 * label is the diagnostic.
 *
 * @remarks
 * This restores a symmetry the surface had already half-committed to: the sync
 * arms of `andThen`, `orElse`, and `safeUnwrap` demand a `Result`, so the same
 * union was always a loud compile error there. Half the surface said no; half
 * lied quietly. Note that the *promise-input* arms deliberately still accept the
 * union — spec §5.2 grants them that shape, and it is safe there because the
 * returned promise flattens it.
 */
export type NoThenableReturn<U> = IsAny<U> extends true
  ? []
  : [Extract<U, PromiseLike<unknown>>] extends [never]
  ? []
  : [
      error: 'This callback can return a promise, so the result would be settled or pending depending on the data. A synchronous Result input cannot produce an asynchronous output: await the value inside the callback, or start from a promise — map(Promise.resolve(r), fn) in the core, or chain.toAsync().map(fn) on the fluent surface.',
    ];
