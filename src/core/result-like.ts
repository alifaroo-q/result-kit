/**
 * The one shallow structural `Result` check, per spec §2.
 *
 * It lives in its own module for the reason [`thenable.ts`](./thenable.ts) and
 * [`render.ts`](./render.ts) do: it is one decision with two callers — the
 * `/testing` matchers' non-`Result` guard and §5.4's combinators — and a second
 * copy is a copy that gets fixed once. It is internal: not in spec §5.9's export
 * list, not reachable from the barrel. The two copies existed for exactly one
 * commit and had already drifted apart on both of the clauses below, which is
 * the argument made concrete.
 *
 * **This is not `parseResult`'s question.** That one proves the *envelope* —
 * `ok: false` with no `error` key is a dropped error, extra properties pass, a
 * hostile `Proxy` is `'unreadable'` — and answers with a typed error saying why
 * not. This asks only whether there is something here whose `.ok` means what a
 * caller reading it assumes.
 *
 * @module
 */

import type { Result } from './result';

/**
 * True when a value can be read as a {@link Result} at all.
 *
 * It does **not** require the `value` / `error` key, deliberately. `ok()`
 * produces `{ ok: true, value: undefined }`, which JSON round-trips to
 * `{ ok: true }` — and §2.1 promises that round-trip yields a usable `Result`.
 * A presence check would reject exactly the value the guarantee is about.
 *
 * **A callable is admitted**, for the same reason §10.9 widened `isTypedError`:
 * a function carrying `ok: true` is structurally an `Ok` and tsc assigns it, so
 * a guard that rejected it would be narrower than the type it gates.
 *
 * **A throwing `ok` getter propagates**, and that is the one place this differs
 * from `renderPayload` and `schema.ts`'s classifier, which swallow. Those two
 * are *reporters* — a crash there replaces the answer the caller came for. This
 * is a *classifier*, and a subject that explodes on read cannot be classified:
 * the throw surfaces it, and what matters is that it does not silently pass.
 * That limit is pinned as a `/testing` matcher test and predates this module;
 * both callers inherit it, so they cannot disagree about it.
 */
export function isResultLike(value: unknown): value is Result<unknown, unknown> {
  return readOk(value) !== undefined;
}

/**
 * The single read of `ok` behind {@link isResultLike} — the branch itself, or
 * `undefined` when there is no readable boolean there.
 *
 * Exported so a caller that must both *classify* and *branch on* a value can do
 * it in **one** property access. §2's union is brandless, so `ok` may be a
 * getter, and a getter is free to answer differently each time it is asked:
 * §5.4's combinators validate a whole bag and then fold it, and asking twice
 * let the two passes disagree — the fold took a branch validation had not
 * approved. Reading once and carrying the answer is the only fix that does not
 * either duplicate this guard or re-ask a value that has already lied.
 *
 * `undefined` is unambiguous as the negative: `ok` is `boolean` by §2, so a
 * `Result` can never produce it.
 */
export function readOk(value: unknown): boolean | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }

  const ok = (value as { readonly ok?: unknown }).ok;

  return typeof ok === 'boolean' ? ok : undefined;
}
