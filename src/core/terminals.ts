import { isTypedError } from './error';
import type { Result } from './result';

/**
 * The five terminals (spec §5.3) — how a consumer leaves the `Result` world and
 * gets a plain value back.
 *
 * **Terminals do not overload over promises**, and the omission is a decision,
 * not a gap. You `await` before a terminal — natural, since a terminal ends the
 * chain — so unifying them buys nothing and only degrades inference. Nothing
 * here detects a thenable or carries the value-or-promise arms
 * `./transforms.ts` needs; every function below takes a settled `Result` and
 * returns synchronously. `test/core/terminals.spec.ts` pins the negative with a
 * `@ts-expect-error` per terminal.
 *
 * `ResultAsync`'s promise-returning terminals (spec §6.2) are not a
 * contradiction: ADR 0009 scopes the sync-terminals ruling to this
 * free-function core, and the wrapper delegates here after awaiting.
 */

/** {@link unwrapOrThrow}'s message when it has nothing better to say. */
const UNWRAP_FAILED = 'unwrapOrThrow called on an Err';

/**
 * Collapses a {@link Result} to a single value by handling both branches.
 *
 * Both `ok` and `err` are **required** → exhaustive by construction. (v1's
 * `onSuccess` / `onFailure` keys are renamed; neither survives.)
 *
 * @remarks
 * The branch callbacks get **one type parameter each**, returning `UOk | UErr`.
 * Spec §5.3 writes a single `U` across both, and implementing that literally
 * fails the spec's own intent — TypeScript collects inference candidates for a
 * naked `U` and takes the first rather than unioning them, so `U` locks to the
 * `ok` branch's type and the `err` branch is rejected outright:
 *
 * ```ts
 * match(r, { ok: (v) => v.n, err: () => 'fallback' });
 * //                               ^^^^^^^^^^ string is not assignable to number
 * ```
 *
 * That is a hard compile error, not a subtle degradation. A slot per callback
 * infers the union where the branches genuinely differ and still collapses to a
 * plain `string` — not `string | string` — where they agree, which is what §5.3
 * asks for in prose. The same presentational-vs-actual gap the transform arms
 * hit, and the same resolution.
 *
 * **`UErr` defaults to `UOk`**, which is what keeps this a strict superset of
 * §5.3 rather than a trade. The default is consulted only when inference finds
 * no candidate for `UErr` — which happens exactly when a caller supplies type
 * arguments explicitly — so the spec's own call shape means what it says:
 *
 * ```ts
 * match<User, NotFound, string>(r, { ok: …, err: … });   // one U, both branches
 * match<User, NotFound, number, string>(r, { ok: …, err: … });   // when they differ
 * ```
 *
 * Both branches are still held to that single `string` in the arity-3 form. A
 * `cases` object always supplies an `err`, so the default never fires on an
 * inferred call and cannot silently collapse the union.
 */
export function match<T, E, UOk, UErr = UOk>(
  result: Result<T, E>,
  cases: { ok: (value: T) => UOk; err: (error: E) => UErr },
): UOk | UErr {
  return result.ok ? cases.ok(result.value) : cases.err(result.error);
}

/**
 * Extracts the value from an `Ok`, falling back to `defaultValue` on an `Err`.
 *
 * The fallback is a `T`, so the return is a plain `T` — the terminal cannot
 * widen the type it was given.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Extracts the value from an `Ok`, computing the fallback **from the error** on
 * an `Err`.
 *
 * The lazy twin of {@link unwrapOr}: `fn` does not fire on the `Ok` branch, so
 * an expensive or side-effecting fallback costs nothing on the happy path.
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Extracts the value from an `Ok`, **throwing** on an `Err`.
 *
 * The **only throwing extractor**, and honestly named. There is deliberately no
 * bare `unwrap`: across the genre `unwrap` *throws*, and v1's returned
 * `T | undefined` — a silent-undefined footgun. Reach for {@link toNullable}
 * when you want value-or-empty, and {@link match} when you want neither.
 *
 * Always throws a real `Error` (never the raw `E`, which may be a string or a
 * plain object and would carry no stack), with the original error preserved in
 * `cause` — ADR 0002's "construct an `Error` at the throw boundary, or carry the
 * original in `cause`", discharged here so callers don't hand-roll it.
 *
 * The message is the explicit `message`, else the error's own if it
 * structurally satisfies the `TypedError` convention (whose `message` is
 * guaranteed present), else a generic fallback. Reading that convention when
 * it happens to hold keeps `E` fully generic — `err('boom')` throws just as
 * well, only less descriptively.
 *
 * ⚠️ **Not v1's `/nest` `unwrapOrThrow`**, which threw an `HttpException` to map
 * a `Result` onto an HTTP response. The name survives find-and-replace and still
 * typechecks — the migration's only silent break. Map to HTTP in your own
 * exception filter.
 */
export function unwrapOrThrow<T, E>(result: Result<T, E>, message?: string): T {
  if (result.ok) return result.value;

  const { error } = result;

  throw new Error(
    message ?? (isTypedError(error) ? error.message : UNWRAP_FAILED),
    { cause: error },
  );
}

/**
 * Degrades a {@link Result} to `T | null`, discarding the error.
 *
 * `null`, not `undefined` — one empty value, and the JSON-safe one.
 */
export function toNullable<T, E>(result: Result<T, E>): T | null {
  return result.ok ? result.value : null;
}
