// PROTOTYPE — throwaway. Answers issue #17: lock the `defineError` signature.
// Delete me once the verdict is recorded in ADR 0002 §4.
//
// Two candidate factory shapes are implemented side by side so we can feel the
// ergonomics against real call sites (see callsites.ts) and let tsc adjudicate
// inference (see the type-level asserts there).

/** v2 TypedError shape, per ADR 0002 §3 (nested typed `details`, 4 fields). */
export interface TypedError<
  TType extends string = string,
  TData = Record<string, unknown>,
> {
  readonly type: TType;
  readonly message: string;
  readonly details?: TData;
  readonly cause?: unknown;
}

/** Default message: a static string, or a function of the payload (DRY + override). */
type MessageArg<TData> = string | ((details: TData) => string);

/**
 * The constructor a factory returns. The KEY design move: the call shape is
 * *conditional* on whether the variant carries a payload.
 *
 *  - no payload (`TData = void`)  →  `(message?) => TypedError<T, never>`
 *  - has payload                  →  `(details, message?) => TypedError<T, TData>`
 *
 * Note the produced payload type for a no-payload variant is `never`, NOT
 * `Record<string, unknown>` — that is what stops the permissive interface
 * default from leaking into typed variants (issue #17, question 3).
 */
export type ErrorCtor<TType extends string, TData> = ([TData] extends [void]
  ? (message?: string) => TypedError<TType, never>
  : (details: TData, message?: string) => TypedError<TType, TData>) & {
  /** The bound discriminant, readable without constructing a value. */
  readonly type: TType;
  /** Optional per-variant runtime guard (question 4). Tag-only; payload is not validated. */
  is(
    x: unknown,
  ): x is TypedError<TType, [TData] extends [void] ? never : TData>;
};

// Shared runtime builder. Prototype-grade: a single impl disambiguates the two
// public call forms by arg type (payloads are objects, no-payload messages are
// strings). Real code would not need this because the public type already forbids
// the wrong shape.
function build<TType extends string, TData>(
  type: TType,
  defaultMessage: MessageArg<TData>,
): ErrorCtor<TType, TData> {
  const ctor = (first?: unknown, second?: string): TypedError<TType, TData> => {
    const hasPayload = first !== undefined && typeof first !== 'string';
    const payload = hasPayload ? (first as TData) : undefined;
    const override = hasPayload ? second : (first as string | undefined);
    const message =
      override ??
      (typeof defaultMessage === 'function'
        ? defaultMessage(payload as TData)
        : defaultMessage);
    return {
      type,
      message,
      ...(payload === undefined ? {} : { details: payload }),
    };
  };
  const withStatics = ctor as unknown as ErrorCtor<TType, TData>;
  Object.assign(ctor, {
    type,
    is: (x: unknown): boolean =>
      !!x &&
      typeof x === 'object' &&
      (x as { type?: unknown }).type === type,
  });
  return withStatics;
}

/**
 * LOCKED SIGNATURE (issue #17) — hybrid single-call + curried `.withData`.
 *
 * Default form: single call; the payload type is declared by annotating the
 * message function's parameter (no explicit generics). Terse for the common case
 * (message derives from payload) and for no-payload variants.
 *
 *   const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
 *   const forbidden = defineError('forbidden', 'Access denied');
 *
 * A default message is ALWAYS required (`string | (details) => string`) — never
 * fully omittable; the guaranteed human-readable fallback, per ADR 0002 §3.
 */
function defineErrorBase<TType extends string, TData = void>(
  type: TType,
  defaultMessage: MessageArg<TData>,
): ErrorCtor<TType, TData> {
  return build(type, defaultMessage);
}

/**
 * `.withData` — curried escape hatch for the one case the single-call form can't
 * infer: a payload paired with a *static* message. Gives the payload type
 * explicitly up front without repeating the `type` literal.
 *
 *   const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');
 */
function withData<TData>() {
  return <TType extends string>(
    type: TType,
    defaultMessage: MessageArg<TData>,
  ): ErrorCtor<TType, TData> => build<TType, TData>(type, defaultMessage);
}

export const defineError = Object.assign(defineErrorBase, { withData });
