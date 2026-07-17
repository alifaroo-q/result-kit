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
 * A `Result` is `{ ok, value }` / `{ ok, error }` and never carries a `then`, so
 * this cannot misfire on the union itself. A *value* inside an `Ok` may well be
 * a thenable, but no caller here inspects `.value`.
 *
 * @remarks
 * It lives in its own module because two callers need it — the §5.2 transforms
 * and §5.7's `safeUnwrap` — and §10.6 makes *the check itself* the decision, so
 * it gets exactly one definition. Duplicating it per module would let the two
 * drift, and drift is invisible for precisely the reason above. The alternative
 * home was `transforms.ts`, but `do-notation.ts` has no business importing from
 * it.
 */
export function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as PromiseLike<unknown>).then === 'function'
  );
}
