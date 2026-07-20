/**
 * A structured, serializable error value.
 *
 * An **opt-in convention**, never mandated by the error channel: `E` in
 * `Result<T, E>` stays fully generic, so `err("not found")` and
 * `err(new DomainError())` remain first-class.
 *
 * Purely structural — **never a class, never `extends Error`**, no eager stack
 * capture. Errors are values narrowed with `switch (err.type)`, not exceptions
 * thrown. Code needing a real `Error` at a throw boundary constructs one there,
 * or carries the original in {@link TypedError.cause}.
 *
 * The shape stays exactly these four fields. A validation error's `path` belongs
 * inside its `details`, not at the top level.
 *
 * `TData` defaults to the permissive `Record<string, unknown>` here so a
 * hand-written `TypedError<'not_found'>` keeps behaving as it did in v1. The
 * {@link defineError} factory deliberately defaults to `void` instead — see its
 * docs.
 */
export interface TypedError<
  TType extends string = string,
  TData = Record<string, unknown>,
> {
  /** Discriminant — narrow a union of variants with `switch (err.type)`. */
  readonly type: TType;

  /** Required. The guaranteed human-readable, loggable summary. */
  readonly message: string;

  /** The typed payload, nested rather than spread across the top level. */
  readonly details?: TData;

  /**
   * ES2022-style error chaining.
   *
   * Outside the JSON round-trip guarantee: `{ type, message, details }` is
   * JSON-safe, but a populated `cause` may hold anything. The caller sanitizes
   * or drops it before serializing — this package never silently mutates error
   * data to auto-strip it.
   */
  readonly cause?: unknown;
}

/** A variant's default message: static, or derived from the payload. */
type MessageArg<TData> = string | ((details: TData) => string);

/**
 * The constructor {@link defineError} returns.
 *
 * The call shape is **conditional on whether the variant carries a payload**:
 *
 * - no payload (`TData = void`) → `(message?) => TypedError<TType, never>`
 * - has payload → `(details, message?) => TypedError<TType, TData>`
 *
 * A no-payload variant produces `TypedError<TType, never>`, *not*
 * `TypedError<TType, Record<string, unknown>>` — that `never` is what stops the
 * interface's permissive default from leaking into typed variants.
 */
export type ErrorCtor<TType extends string, TData> = ([TData] extends [void]
  ? (message?: string) => TypedError<TType, never>
  : (details: TData, message?: string) => TypedError<TType, TData>) & {
  /** The bound discriminant, readable without constructing a value. */
  readonly type: TType;

  /**
   * Per-variant guard. **Tag-plus-`message`** — it narrows an error union
   * cheaply but cannot validate the typed payload at runtime; that needs a
   * schema.
   *
   * It checks `message` as well as the tag (§10.9), which the original tag-only
   * version did not. `message: string` is the one field `TypedError` promises
   * unconditionally, and this predicate narrows *to* `TypedError` — so a
   * tag-only object passed the guard and left `e.message` `undefined` under a
   * type asserting `string`. The `@remarks` disclaimer covers the *payload*;
   * `message` is not payload. Checking it costs nothing and keeps the tag-only
   * spirit intact.
   */
  is(x: unknown): x is TypedError<TType, [TData] extends [void] ? never : TData>;
};

/**
 * Shared runtime builder for both public call forms.
 *
 * `hasPayload` is resolved once at definition time rather than sniffed per call:
 * a payload variant always reads `args[0]` as `details`, a no-payload variant
 * always reads it as the message override.
 *
 * Sniffing the argument's *type* at call time instead — the prototype's
 * approach — is silently wrong for a variant whose payload is itself a string:
 * `defineError.withData<string>()('bad', 'msg')('my-payload')` would read the
 * payload as a message override and drop `details` entirely. It typechecks, so
 * the failure is invisible. Definition time knows the answer for free.
 */
function build<TType extends string, TData>(
  type: TType,
  defaultMessage: MessageArg<TData>,
  hasPayload: boolean,
): ErrorCtor<TType, TData> {
  const ctor = (...args: readonly unknown[]): TypedError<TType, TData> => {
    const details = (hasPayload ? args[0] : undefined) as TData | undefined;
    const override = (hasPayload ? args[1] : args[0]) as string | undefined;
    const message =
      override ??
      (typeof defaultMessage === 'function'
        ? defaultMessage(details as TData)
        : defaultMessage);

    return {
      type,
      message,
      ...(details === undefined ? {} : { details }),
    };
  };

  return Object.assign(ctor, {
    type,
    is: (x: unknown): boolean =>
      (typeof x === 'object' || typeof x === 'function') &&
      x !== null &&
      (x as { type?: unknown }).type === type &&
      typeof (x as { message?: unknown }).message === 'string',
  }) as unknown as ErrorCtor<TType, TData>;
}

/**
 * Declares an error variant once and returns a constructor for it.
 *
 * The payload type is declared by **annotating the message function's
 * parameter** — no explicit type argument:
 *
 * ```ts
 * const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
 * notFound({ id: '123' });
 * // → { type: 'not_found', message: 'User 123 not found', details: { id: '123' } }
 * notFound({ id: '123' }, 'Custom message');   // per-call override
 *
 * const forbidden = defineError('forbidden', 'Access denied');   // no payload
 * ```
 *
 * The default `message` is **always required** — there is no silent fallback to
 * the `type` string, which is what keeps the guaranteed-message invariant true
 * at the constructor boundary.
 *
 * `TData` defaults to `void` here, unlike the {@link TypedError} interface's
 * permissive `Record<string, unknown>`. The asymmetry is deliberate: it makes
 * absent-payload variants `TypedError<TType, never>`, so the permissive default
 * never leaks into a no-payload error.
 *
 * Error unions build straight from the constructors' return types, each with its
 * own payload:
 *
 * ```ts
 * type ApiError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>;
 * ```
 *
 * Produces a *value*, not a `Result` — compose it with `err(notFound({ id }))`,
 * or use it anywhere an error value is wanted (log it, stash it in `cause`).
 *
 * For a payload paired with a *static* message — the one shape this single-call
 * form cannot infer — use {@link defineError.withData}.
 *
 * @remarks
 * Passing explicit type arguments to bind a payload alongside a static message —
 * `defineError<'conflict', { id: string }>('conflict', 'Already exists')` — is
 * **not supported**: nothing is declared at runtime for the constructor to read,
 * so it builds a no-payload variant and drops `details`. That call shape is the
 * all-or-nothing type-argument tax `.withData` exists to replace; use
 * `defineError.withData<{ id: string }>()('conflict', 'Already exists')`.
 */
function defineErrorBase<TType extends string, TData = void>(
  type: TType,
  defaultMessage: MessageArg<TData>,
): ErrorCtor<TType, TData> {
  // A single-call payload variant is exactly the one that declares a payload by
  // annotating a message-function parameter — so count the parameters. A static
  // message declares none, and neither does `() => 'timed out'`, whose TData
  // stays `void` and whose sole call argument is therefore a message override.
  //
  // The parameter must be annotated and undefaulted, matching what the types
  // infer: `(d: X = …) => …` reports arity 0 and reads here as a no-payload
  // variant, as does the type-argument form this factory does not support —
  // see the `@remarks` on {@link defineError}.
  const hasPayload =
    typeof defaultMessage === 'function' && defaultMessage.length >= 1;
  return build(type, defaultMessage, hasPayload);
}

/**
 * The escape hatch for the one shape the single-call form cannot infer: a
 * payload paired with a **static** message. Supplies the payload type explicitly
 * **without repeating the `type` literal**.
 *
 * ```ts
 * const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');
 * ```
 */
function withData<TData>() {
  return <TType extends string>(
    type: TType,
    defaultMessage: MessageArg<TData>,
  ): ErrorCtor<TType, TData> => build<TType, TData>(type, defaultMessage, true);
}

export const defineError = Object.assign(defineErrorBase, { withData });

/**
 * Narrows a caught `unknown` — or a generic `E` — to the base
 * {@link TypedError} shape.
 *
 * Structural and tag-agnostic: it checks for a `string` `type`, a `string`
 * `message`, and — when `details` is present — a non-null, non-array object.
 *
 * The object test admits a **function** as well (§10.9), for the same reason
 * §10.8 widened `isThenable`: a callable carrying `type` and `message` is a
 * structurally valid `TypedError` and tsc assigns it without complaint, so a
 * guard that rejected it was narrower than the type it publishes. That gap was
 * not academic — `unwrapOrThrow` consumes this guard, so it silently replaced
 * such an error's real message with the generic fallback.
 * That last check is what keeps the narrowing honest: this guard lands on the
 * base `TypedError`, whose `TData` takes the interface's
 * `Record<string, unknown>` default, and an array or `null` is not a `Record`.
 *
 * It cannot validate a *specific* variant's payload (that needs a schema); for a
 * known variant, prefer that constructor's `.is()`.
 */
export function isTypedError(x: unknown): x is TypedError {
  if (
    (typeof x !== 'object' && typeof x !== 'function') ||
    x === null ||
    typeof (x as { type?: unknown }).type !== 'string' ||
    typeof (x as { message?: unknown }).message !== 'string'
  ) {
    return false;
  }

  const { details } = x as { details?: unknown };
  return (
    details === undefined ||
    (typeof details === 'object' && details !== null && !Array.isArray(details))
  );
}

/**
 * The structural lower bound of an error registry entry: **anything that builds
 * a `TypedError`**.
 *
 * Deliberately *not* `ErrorCtor<string, unknown>`. `ErrorCtor`'s call signature
 * is conditional on `[TData] extends [void]`, so a single concrete `ErrorCtor`
 * instantiation cannot be a supertype of both the no-payload and the payload
 * forms at once — a constraint written that way rejects half of every real
 * registry. A registry only ever needs its values to be *callable and to return
 * a `TypedError`*, which is exactly this shape; `(...args: never[])` is the
 * widest parameter list every constructor is assignable to. It also admits a
 * hand-rolled factory that never went through {@link defineError}, which is the
 * point — the registry helpers standardize the *shape*, not the origin.
 */
type ErrorRegistry = Record<string, (...args: never[]) => TypedError>;

/**
 * The union of every `TypedError` a registry's constructors produce — the
 * canonical replacement for hand-writing
 * `ReturnType<typeof a> | ReturnType<typeof b> | …`.
 *
 * @example
 * ```ts
 * const errors = defineErrors({ notFound, forbidden });
 * type AppError = ErrorsOf<typeof errors>;
 * //   ^? TypedError<'not_found', { id: string }> | TypedError<'forbidden', never>
 * ```
 *
 * **This is constructor-based, and that is the whole design.** It maps over the
 * registry's *values* and infers each constructor's **return type**, so every
 * variant keeps its own typed payload — `notFound`'s `{ id: string }` survives
 * intact. That is precisely why v1's `TypedErrorUnion` was cut (spec §3.3): it
 * worked off the *tags* (`TypedErrorUnion<'a' | 'b'>`) and rebuilt each variant
 * with the interface's **default** payload, erasing the per-variant type. Spec
 * §3.1 states the rule this encodes — "error unions are built from constructor
 * return types, each with its own payload." Do not reintroduce a tag-keyed
 * variant; it is the resurrection of a known-wrong design.
 *
 * The `: never` fallback lets it degrade gracefully over a registry derived from
 * a module (`import * as errors`): a non-constructor export contributes `never`
 * and vanishes from the union rather than erroring. The flip side is that a
 * wholly malformed input (e.g. a type passed where a value was meant) collapses
 * silently to `never` — {@link defineErrors} exists to catch that at the
 * registration site instead.
 */
export type ErrorsOf<T extends ErrorRegistry> = {
  [K in keyof T]: T[K] extends (...args: never[]) => infer R ? R : never;
}[keyof T];

/**
 * The canonical way to declare a registry of error constructors, so the union
 * of their outputs can be derived once with {@link ErrorsOf} instead of spelled
 * out by hand.
 *
 * It is a **constrained identity** — it returns the registry unchanged, and its
 * only runtime cost is the call. Its value is entirely at the type level: the
 * {@link ErrorRegistry} bound rejects a non-constructor entry *here*, at the
 * point the mistake is made, rather than letting {@link ErrorsOf} quietly fold
 * it into `never` downstream. The `const` type parameter preserves the object's
 * literal key set and each entry's precise `ErrorCtor` type, which is what keeps
 * the derived union exact.
 *
 * @example
 * ```ts
 * export const billingErrors = defineErrors({
 *   missingBaseItem,
 *   missingSwapItem,
 *   planNotFound,
 * });
 * export type BillingError = ErrorsOf<typeof billingErrors>;
 * ```
 *
 * Grouping is **opt-in**. The manual form —
 * `type E = ReturnType<typeof a> | ReturnType<typeof b>` — stays fully
 * supported (spec §3.1 shows it), and {@link ErrorsOf} also accepts a plain
 * object literal of constructors with no wrapping call. Reach for `defineErrors`
 * when you want the registration-time check and one named home for the bag.
 */
export function defineErrors<const T extends ErrorRegistry>(registry: T): T {
  return registry;
}
