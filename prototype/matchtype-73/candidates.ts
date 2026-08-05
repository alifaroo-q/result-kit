// PROTOTYPE — throwaway. Issue #73. Delete once the verdict is recorded.
//
// Candidate `matchType` signatures. Runtime bodies are one line each; the whole
// prototype is the *types*. Nothing here imports from `src/` except the two
// public types, so the probes exercise the real `TypedError` / `ErrorsOf`.

import type { TypedError } from '../../src/core/error.ts';

/* ------------------------------------------------------------------ *
 * A — naked `U` across every arm (the shape §5.3 warns about for `match`)
 * ------------------------------------------------------------------ */

export function matchTypeA<E extends TypedError, U>(
  error: E,
  handlers: { [K in E['type']]: (variant: Extract<E, { type: K }>) => U },
): U {
  return (handlers as unknown as Record<string, (v: E) => U>)[error.type]!(error);
}

/* ------------------------------------------------------------------ *
 * B — infer the handler bag, union the return types
 * ------------------------------------------------------------------ */

type Arms<E extends TypedError> = {
  [K in E['type']]: (variant: Extract<E, { type: K }>) => unknown;
};

export function matchTypeB<E extends TypedError, H extends Arms<E>>(
  error: E,
  handlers: H,
): ReturnType<H[keyof H]> {
  return (handlers as unknown as Record<string, (v: E) => never>)[error.type]!(error);
}

/* ------------------------------------------------------------------ *
 * C — B plus a default arm, as an overload pair
 * ------------------------------------------------------------------ */

type PartialArms<E extends TypedError> = {
  [K in E['type']]?: (variant: Extract<E, { type: K }>) => unknown;
};

type WithDefault<E extends TypedError> = PartialArms<E> & {
  _: (variant: E) => unknown;
};

export function matchTypeC<E extends TypedError, H extends Arms<E>>(
  error: E,
  handlers: H,
): ReturnType<H[keyof H]>;
export function matchTypeC<E extends TypedError, H extends WithDefault<E>>(
  error: E,
  handlers: H,
): ReturnType<NonNullable<H[keyof H]>>;
export function matchTypeC(
  error: TypedError,
  handlers: Record<string, ((v: TypedError) => unknown) | undefined>,
): unknown {
  const arm = handlers[error.type] ?? handlers['_'];
  return arm!(error);
}

/* ------------------------------------------------------------------ *
 * D — C, but the default arm sees only the *residual* variants.
 *     Needs the handled tags known before the arms are contextually typed,
 *     hence the curried call.
 * ------------------------------------------------------------------ */

export function matchTypeD<E extends TypedError>(error: E) {
  return <H extends PartialArms<E>, R>(
    handlers: H & {
      _: (variant: Extract<E, { type: Exclude<E['type'], keyof H> }>) => R;
    },
  ): ReturnType<NonNullable<H[keyof H]>> | R => {
    const bag = handlers as unknown as Record<
      string,
      ((v: E) => never) | undefined
    >;
    return (bag[error.type] ?? bag['_'])!(error);
  };
}

/* ------------------------------------------------------------------ *
 * Test-only helpers
 * ------------------------------------------------------------------ */

export type IsAny<T> = 0 extends 1 & T ? true : false;
export type Expect<T extends true> = T;
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/* ------------------------------------------------------------------ *
 * B2 — B, plus a constraint that rejects arms for tags not in the union
 * ------------------------------------------------------------------ */

export function matchTypeB2<E extends TypedError, H extends Arms<E>>(
  error: E,
  handlers: H & Record<Exclude<keyof H, E['type']>, never>,
): ReturnType<H[keyof H]> {
  return (handlers as unknown as Record<string, (v: E) => never>)[error.type]!(
    error,
  );
}

/* ------------------------------------------------------------------ *
 * D2 — residual-narrowed default arm as its own parameter
 * ------------------------------------------------------------------ */

export function matchTypeD2<
  E extends TypedError,
  H extends PartialArms<E>,
  R,
>(
  error: E,
  handlers: H,
  fallback: (variant: Exclude<E, { type: keyof H }>) => R,
): ReturnType<NonNullable<H[keyof H]>> | R {
  const bag = handlers as Record<string, ((v: E) => never) | undefined>;
  return bag[error.type]?.(error) ?? fallback(error as never);
}
