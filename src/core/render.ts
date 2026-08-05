/**
 * The one renderer used by every diagnostic this package throws.
 *
 * **It cannot throw, and it cannot elide.** Those are the two failure modes it
 * exists to close, and both were shipped bugs rather than hypotheticals:
 *
 * - `JSON.stringify` *throws* on a circular object (a domain model with
 *   back-references) and on a `BigInt` (an id from a database driver). The
 *   thrown `TypeError: Converting circular structure to JSON` then replaced the
 *   diagnostic entirely — the caller asking "why is this an Err?" got an
 *   unrelated serializer crash instead of an answer.
 * - `JSON.stringify` *returns `undefined`* — not a string — for a symbol, a
 *   function, and `undefined` itself, and silently *drops* all three from
 *   inside an object. Interpolated, the first three read as the literal text
 *   `undefined`, so `err(Symbol('x'))` and `err(undefined)` threw byte-identical
 *   messages. Distinct causes, one indistinguishable report.
 * - `JSON.stringify(new Error('kaboom'))` is `'{}'` — `name`, `message` and
 *   `stack` are all non-enumerable. An `Err` half carrying a real `Error` is
 *   what every `fromThrowable`-shaped wrapper produces, so the single most
 *   common payload rendered as nothing at all.
 *
 * This lives in its own module for the reason [`thenable.ts`](./thenable.ts)
 * does: it is one decision, shared by `assertions.ts` and the `/testing`
 * matchers' non-`Result` guard, and a second copy is a copy that gets fixed
 * once. It is internal — not in spec §5.9's export list, not reachable from the
 * barrel.
 *
 * **A JSON-safe payload renders exactly as `JSON.stringify` would**, so this is
 * a bug fix and not a message change: every payload a caller could already read
 * is byte-identical, and only the broken ones move.
 *
 * {@link renderDiagnostic} sits on top of it — the §3-aware layer
 * ([#67](https://github.com/alifaroo-q/result-kit/issues/67)) that prettifies a
 * `TypedError` before falling back here. `renderPayload` stays the floor: every
 * value that is *not* a typed error, and every sub-payload of one that is, still
 * comes through this function.
 */

import { isTypedError } from './error';
import type { TypedError } from './error';
import { prettifyErrors } from './format';

/**
 * True when `JSON.stringify` can represent the value at all.
 *
 * Used to route the *top-level* payload, where `stringify` returns `undefined`
 * rather than a string. Sending those through {@link describe} directly is what
 * keeps `undefined` rendering as bare `undefined` — the wording the existing
 * message already had — rather than as a quoted `"undefined"`.
 */
function isRenderableAsJson(value: unknown): boolean {
  if (value === null) return true;
  if (value instanceof Error) return false;

  switch (typeof value) {
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      return false;
    default:
      return true;
  }
}

/**
 * Describes a value `JSON.stringify` refuses to represent faithfully.
 *
 * Ordered by specificity: `Error` before the primitive arms, and those before
 * `Object.prototype.toString`, which flattens everything it sees to
 * `[object Foo]`.
 *
 * **This is the last resort, so it is the one function that must not fail** —
 * it is what {@link renderPayload}'s `catch` calls, and a throw here escapes the
 * module with nothing left to catch it. Every branch below touches the value in
 * a way a `Proxy` can trap: `instanceof` (`getPrototypeOf`), `name` / `message`
 * (`get`), and — the one actually observed — `Object.prototype.toString`, which
 * reads `Symbol.toStringTag` through the `get` trap. So the whole inspection
 * runs inside a `try`, and a value that refuses even to describe itself gets a
 * name for that fact rather than crashing the diagnostic.
 *
 * Found by `renderDiagnostic_a Proxy that explodes on every read_…`, not by
 * review: the original comment here already argued that `String` was unsafe as
 * a fallback, and then closed only part of the gap it had named.
 */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  try {
    if (value instanceof Error) {
      // `name` and `message` are non-enumerable, so this is the only way they
      // reach the message at all. `stack` is deliberately left out — it is
      // multi-line and would bury the one line the caller is reading.
      return `${value.name}: ${value.message}`;
    }

    switch (typeof value) {
      case 'bigint':
        // The `n` suffix keeps `10n` distinguishable from the number `10`,
        // which is the whole reason a caller reached for a BigInt.
        return `${value}n`;
      case 'symbol':
        return value.toString();
      case 'function':
        return `[Function: ${value.name || 'anonymous'}]`;
      default:
        return Object.prototype.toString.call(value);
    }
  } catch {
    // `typeof` is the one thing no trap can intercept, so it is all that is
    // left to say — and saying it still distinguishes an unrenderable object
    // from an unrenderable function.
    return `[unrenderable ${typeof value}]`;
  }
}

/**
 * Renders any value as a single-line string, without ever throwing.
 *
 * Three layers, each catching what the one before it cannot:
 *
 * 1. The top-level {@link isRenderableAsJson} route, for the values
 *    `stringify` would hand back as `undefined`.
 * 2. `JSON.stringify` with a replacer, which resolves the *nested* hazards in
 *    place — a cycle, a `BigInt`, an `Error` three levels down — so the rest of
 *    the structure still renders around them.
 * 3. The `catch`, for what a replacer cannot pre-empt: a throwing `toJSON`, a
 *    throwing getter, a `Proxy` that explodes on read. {@link describe} is used
 *    there rather than `String`, because `String(Symbol())` throws too and
 *    would reintroduce the same class of failure one level down.
 */
export function renderPayload(value: unknown): string {
  if (!isRenderableAsJson(value)) return describe(value);

  // The *ancestor path*, not a set of everything visited. A `WeakSet` of seen
  // objects conflates a cycle with a diamond — `{ a: shared, b: shared }` is
  // acyclic, and `JSON.stringify` renders both copies — so the set version
  // silently replaced real data with `[Circular]`. Caught by
  // `renderPayload_repeatedButAcyclicReference_isNotCalledCircular`.
  //
  // It tracks the *original* graph rather than the replacer's `raw` argument:
  // a `toJSON` returning a fresh object each call would otherwise never repeat,
  // so its cycle would never be caught.
  const path: object[] = [];

  try {
    return (
      JSON.stringify(
        value,
        function replacer(this: unknown, key: string, raw: unknown): unknown {
          const original = (this as Record<string, unknown>)[key];

          if (typeof original === 'object' && original !== null) {
            // `stringify` walks depth-first, so unwinding to the current holder
            // leaves exactly this node's ancestors on the stack.
            while (path.length > 0 && path[path.length - 1] !== this) path.pop();

            if (path.includes(original)) return '[Circular]';
            path.push(original);
          }

          return isRenderableAsJson(raw) ? raw : describe(raw);
        },
      ) ?? describe(value)
    );
  } catch {
    return describe(value);
  }
}

/**
 * Renders one {@link TypedError} as its `prettifyErrors` line plus whatever of
 * `details` / `cause` it actually carries, each indented beneath it.
 *
 * `prettifyErrors` is called rather than reimplemented, so the `✖ type: message`
 * form stays defined in exactly one place (§3.4) and a future change to it
 * reaches these messages for free.
 *
 * **`details` is added back deliberately**, and the tension is worth naming:
 * §3.4 documents that `prettifyErrors` never reads `details`, because a
 * diagnostic *one-liner* is the wrong place for an arbitrary, possibly-large
 * payload. That reasoning is about `prettifyErrors`' own contract and it still
 * holds — but this message is not a one-liner, and `details` is the field the
 * caller would otherwise go and `console.log`. Rendering the summary *without*
 * it would have made this message strictly less useful than the bare
 * {@link renderPayload} dump it replaces, which is the opposite of the point.
 *
 * `cause` is included on the same argument and is the stronger case: it is
 * §3's ES2022 chaining field, so it typically holds the original thrown `Error`
 * — the actual answer to "why did this fail?". It is outside the JSON
 * round-trip guarantee and may hold anything, which is exactly why it goes
 * through `renderPayload` like every other sub-payload.
 *
 * Both lines are **presence-gated**: a no-payload variant renders as one line,
 * unchanged.
 */
function renderTypedError(error: TypedError): string {
  const lines = [`  ${prettifyErrors([error])}`];

  if (error.details !== undefined) {
    lines.push(`    details: ${renderPayload(error.details)}`);
  }
  if (error.cause !== undefined) {
    lines.push(`    cause: ${renderPayload(error.cause)}`);
  }

  return lines.join('\n');
}

/**
 * Builds a full wrong-branch diagnostic — the message `expectOk` / `expectErr`
 * throw ([#67](https://github.com/alifaroo-q/result-kit/issues/67)).
 *
 * It takes the `prefix` rather than returning a fragment because the *shape* of
 * the message depends on the payload: a typed error becomes an indented block
 * under the prefix, and everything else stays the single line it already was.
 * Leaving that join to the caller would mean two call sites agreeing on a
 * leading-newline-or-leading-space convention, which is a convention that gets
 * broken.
 *
 * Three payload shapes, in order:
 *
 * 1. **A `TypedError`** — prettified per {@link renderTypedError}.
 * 2. **A non-empty array of `TypedError`s** — the shape `combineWithAllErrors`
 *    (§5.4) produces, and `prettifyErrors`' native input. One block each, so a
 *    failing accumulation test reads as a list of causes rather than a JSON
 *    blob.
 * 3. **Anything else** — {@link renderPayload}, byte-identical to what shipped
 *    before. That fallback is what keeps this additive: only §3-shaped payloads
 *    change wording.
 *
 * **An empty array takes the fallback**, and the guard is load-bearing rather
 * than defensive. `[]` vacuously satisfies "every element is a `TypedError`",
 * and `prettifyErrors([])` correctly returns `''` (§3.4 — no invented
 * placeholder), so without the length check `err([])` would throw the message
 * `Expected Ok, got Err:` with nothing after the colon. `[]` is strictly more
 * informative.
 *
 * **It cannot throw**, the same invariant {@link renderPayload} carries, and it
 * needs its own `try` to keep it: the dispatch above *reads properties* —
 * `isTypedError` touches `type` and `message`, `renderTypedError` touches
 * `details` and `cause` — before `renderPayload`'s own `try` is ever entered. A
 * throwing getter or an exploding `Proxy` would otherwise replace the
 * diagnostic with an unrelated crash, which is the exact failure class this
 * module exists to close.
 */
export function renderDiagnostic(prefix: string, value: unknown): string {
  try {
    if (isTypedError(value)) {
      return `${prefix}:\n${renderTypedError(value)}`;
    }

    if (Array.isArray(value) && value.length > 0 && value.every(isTypedError)) {
      return `${prefix}:\n${value.map(renderTypedError).join('\n')}`;
    }
  } catch {
    // Fall through to the floor renderer, which has its own guarantees.
  }

  return `${prefix}: ${renderPayload(value)}`;
}
