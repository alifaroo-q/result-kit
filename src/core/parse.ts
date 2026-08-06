/**
 * Validating re-entry: the safe landing half of the §2.1 round-trip guarantee
 * ([#66](https://github.com/alifaroo-q/result-kit/issues/66)).
 *
 * §2 makes the union purely structural so a `Result` can *leave* — through
 * `JSON.stringify`, an HTTP body, a queue message, a `postMessage`. Nothing
 * shipped covered the way back in, so every wire-crossing consumer wrote
 * `as Result<T, E>`: an assertion the round-trip marketing implicitly
 * encourages and the type system cannot check. These two functions are the
 * honest form of that cast.
 *
 * **The payload halves stay `unknown`, and there is no generic parameter.**
 * `parseResult<T, E>(json)` would be the same lie behind a friendlier face —
 * this module can prove the *envelope*, and nothing whatsoever about what it
 * carries. Narrowing `T` and `E` is the caller's job, or `fromSchema`'s.
 *
 * @module
 */

import type { TypedError } from './error';
import { err, ok, type Result } from './result';

/**
 * Why a value was rejected as a `Result`.
 *
 * A closed union, so a consumer can branch on the failure *kind* — the exact
 * affordance [ADR 0015](../../docs/adr/0015-standard-schema-issue-mapping.md)
 * §2 had to give up for `fromSchema`, where the vocabulary belongs to the
 * vendor and varies between them. Here the vocabulary is ours, so it is free.
 *
 * Exported because it appears inside {@link MalformedResult}'s `details` and
 * therefore surfaces in hover and `.d.ts` output whether exported or not — a
 * symbol a user can see but cannot import is strictly worse (spec §10.2).
 */
export type MalformedResultReason =
  /** A primitive, `null`, or an array. */
  | 'not_an_object'
  /** An object whose own properties could not be read — a hostile `Proxy`. */
  | 'unreadable'
  /** No `ok` property at all. */
  | 'missing_discriminant'
  /** An `ok` property that is not a boolean. */
  | 'invalid_discriminant'
  /** `ok: false` with no `error` key — see the constant's note below. */
  | 'error_dropped';

/**
 * The failure {@link parseResult} produces.
 *
 * A single `TypedError`, following
 * [ADR 0015](../../docs/adr/0015-standard-schema-issue-mapping.md) §1's
 * precedent: a `Result` has one error channel, and an array in `E` makes every
 * downstream consumer special-case one.
 *
 * `details` is `{ reason }` and nothing else. **The rejected value is not in
 * it** — unlike `fromSchema`, whose issues are produced inside the adapter and
 * are otherwise unreachable, the caller of `parseResult` is holding the input
 * already. Putting it in `details` would buy nothing and would route arbitrary
 * wire data — PII, a `BigInt`, a cycle — into the field §2.1 promises is
 * JSON-safe. That is also why there is no `includeCause` option here.
 */
export type MalformedResult = TypedError<
  'malformed_result',
  { readonly reason: MalformedResultReason }
>;

/**
 * One static message per reason.
 *
 * Static, with **nothing interpolated from the input** — §3.4's payload-in-
 * `message` trap: a message can carry payload before any formatter runs, and no
 * formatter can undo it. The reason discriminates; the message explains.
 */
const MESSAGES: Readonly<Record<MalformedResultReason, string>> = {
  not_an_object: 'Malformed Result: expected an object, got a primitive, `null`, or an array.',
  unreadable: 'Malformed Result: the value is an object whose properties could not be read.',
  missing_discriminant: 'Malformed Result: no `ok` property.',
  invalid_discriminant: 'Malformed Result: the `ok` property is not a boolean.',
  // The one reason that is a *diagnosis* rather than a description, and the
  // reason this branch is checked at all. `JSON.stringify` drops a property
  // whose value is `undefined`, a function, a symbol, or an object whose
  // `toJSON` returns `undefined` — so `err(thatThing)` reaches the wire as a
  // bare `{"ok":false}` and the failure data is gone with no diagnostic. That
  // is precisely the silent-loss class the package refuses elsewhere (ADR 0015
  // §3 coerces a symbol path segment rather than let `JSON.stringify` eat it).
  error_dropped:
    'Malformed Result: the `ok: false` branch carries no `error`. `JSON.stringify` drops a payload that is not JSON-serializable — `undefined`, a function, a symbol, or a `toJSON` returning `undefined`. Send `null` for a failure with no detail.',
};

/**
 * Is `key` a property that would survive `JSON.stringify`?
 *
 * `propertyIsEnumerable` is exactly that question — it is true for **own
 * enumerable** properties and nothing else, which is precisely the set
 * `JSON.stringify` writes.
 *
 * A plain `'ok' in value` was the first spelling and it was wrong, caught by
 * its own test rather than by review: `in` walks the prototype chain, so an
 * object *inheriting* `ok` — a class instance with a `get ok()` on the
 * prototype, or an `Object.create(existingResult)` — read as well-formed while
 * serializing to `{}`. A guard for wire re-entry that disagrees with the wire
 * about what is on the object is worse than no guard. Nothing `JSON.parse`
 * produces is affected: parsed objects carry own enumerable properties only.
 *
 * `match-type.ts` reached for `hasOwnProperty` over `in` for the neighbouring
 * reason (§3.5) — a tag of `constructor` would otherwise find `Object.prototype`'s
 * member. Same class of bug, one step further: own is not enough here, because
 * a non-enumerable own property is dropped by `JSON.stringify` too.
 *
 * Called through `Object.prototype` so a null-prototype object — which has no
 * such method of its own — is asked the same question as everything else.
 */
function isWireProperty(value: object, key: string): boolean {
  return Object.prototype.propertyIsEnumerable.call(value, key);
}

/**
 * The single implementation behind both exports: `null` means well-formed.
 *
 * **It cannot throw.** Every probe below can, against a hostile object — a
 * `Proxy` with a `has` or `get` trap, or a revoked one, which makes even
 * `Array.isArray` throw. A validator that crashes on the input it exists to
 * judge is the shape this codebase has now hit five times (three holes in
 * `renderPayload`, one in `schema.ts`'s classifier); the `catch` is what keeps
 * this the fifth *avoided* one rather than the sixth occurrence.
 *
 * The order matters once: `typeof`/`=== null` come **before** the `try`,
 * because neither can throw and both are true of values no trap can reach.
 */
function classify(value: unknown): MalformedResultReason | null {
  if (typeof value !== 'object' || value === null) return 'not_an_object';

  try {
    // An array cannot round-trip as a `Result`: `JSON.stringify` writes only
    // its indices, so any `ok` property it carried is already gone.
    if (Array.isArray(value)) return 'not_an_object';

    if (!isWireProperty(value, 'ok')) return 'missing_discriminant';

    const discriminant = (value as { readonly ok?: unknown }).ok;
    if (typeof discriminant !== 'boolean') return 'invalid_discriminant';

    // Asymmetric on purpose, and the asymmetry is the spec's, not taste.
    //
    // Both halves lose an `undefined` payload to `JSON.stringify`, so both
    // `ok()` and `err(undefined)` reach the wire one field short — and
    // TypeScript rejects *both* results (`{ ok: true }` is not assignable to
    // `Ok<void>`, let alone `Ok<unknown>`). What separates them is provenance:
    // spec §10.9 carves out `Ok<void>` **because §5.1 recommends the
    // constructor that produces it**, so `{ ok: true }` is the library's own
    // blessed output. `err` has no no-arg overload and no such carve-out, so a
    // bare `{ ok: false }` only ever means a non-serializable error went onto
    // the wire — the §2.1 violation itself.
    //
    // Measured, not argued: a wire `{ ok: false }` admitted here crashes
    // `matchType`, `groupByType` and `prettifyErrors` one hop later, all three
    // reading `type` off `undefined`. There is no value-side equivalent —
    // nothing in the package consumes `.value` structurally, so `{ ok: true }`
    // behaves correctly in every function that touches it.
    if (!discriminant && !isWireProperty(value, 'error')) {
      return 'error_dropped';
    }

    // Deliberately nothing else. A missing `value` on the `ok: true` branch
    // passes (above), and **extra properties pass**: §2's exactly-two-fields
    // rule binds what this package *builds*, and a gateway or tracing layer
    // that stamped a `traceId` onto the envelope has not made it stop being a
    // `Result`. Rejecting there breaks every consumer at once to guard against
    // a field nobody reads.
    return null;
  } catch {
    return 'unreadable';
  }
}

/**
 * Narrows an `unknown` to a `Result` — the cheap, in-place check.
 *
 * ```ts
 * const payload: unknown = JSON.parse(body);
 * if (isResult(payload)) {
 *   payload.ok; // narrowed to Result<unknown, unknown>
 * }
 * ```
 *
 * Reach for this inside your own code, and for {@link parseResult} at a wire
 * boundary where you want the rejection to say *why*. Both run the same
 * `classify`, so they can never disagree about what a `Result` is.
 *
 * Composes with `fromPredicate` when you want the check in the `Result` world
 * with an error of your own choosing:
 * `fromPredicate(payload, isResult, myError)`.
 *
 * @remarks
 * A value already typed as a `Result<User, E>` keeps its narrower type through
 * this guard — `Result<User, E>` is assignable to `Result<unknown, unknown>`,
 * so TypeScript keeps the more specific of the two.
 */
export function isResult(value: unknown): value is Result<unknown, unknown> {
  return classify(value) === null;
}

/**
 * Validates that an `unknown` is a well-formed `Result` and returns it typed,
 * or a {@link MalformedResult} saying what was wrong with it.
 *
 * ```ts
 * const parsed = parseResult(await response.json());
 * if (isErr(parsed)) {
 *   log(parsed.error.details.reason); // 'error_dropped' | 'not_an_object' | …
 *   return;
 * }
 * const inner = parsed.value; // Result<unknown, unknown>
 * ```
 *
 * The nesting is real and is the honest shape: the outer `Result` answers *was
 * this a `Result` at all*, the inner one answers *did the operation succeed*.
 * Collapsing them would make a malformed envelope indistinguishable from a
 * reported failure, which is the distinction the whole function exists to draw.
 *
 * **The input is returned as-is on success** — same object, extra properties
 * and all. This validates; it never normalizes, strips, or reconstructs, so the
 * value you get back is the value you handed in.
 */
export function parseResult(
  value: unknown,
): Result<Result<unknown, unknown>, MalformedResult> {
  const reason = classify(value);

  if (reason !== null) {
    return err({
      type: 'malformed_result',
      message: MESSAGES[reason],
      details: { reason },
    });
  }

  return ok(value as Result<unknown, unknown>);
}
