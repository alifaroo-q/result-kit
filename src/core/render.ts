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
 * When [#67](https://github.com/alifaroo-q/result-kit/issues/67) renders
 * `TypedError`s through `prettifyErrors`, this is the seam it replaces — one
 * function, two call sites.
 */

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
 */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  if (value instanceof Error) {
    // `name` and `message` are non-enumerable, so this is the only way they
    // reach the message at all. `stack` is deliberately left out — it is
    // multi-line and would bury the one line the caller is reading.
    return `${value.name}: ${value.message}`;
  }

  switch (typeof value) {
    case 'bigint':
      // The `n` suffix keeps `10n` distinguishable from the number `10`, which
      // is the whole reason a caller reached for a BigInt.
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
    default:
      return Object.prototype.toString.call(value);
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
