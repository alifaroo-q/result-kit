import { err as coreErr, ok as coreOk, type Result } from '../core/result';

import { ResultChain } from './result-chain';

/**
 * The `/fluent` entrypoint (spec §6.3) — the opt-in ergonomic envelope.
 *
 * The root `.` bundle **must never contain this module**. That boundary is
 * ADR 0001's headline differentiator (a tree-shakable core class-only
 * neverthrow structurally cannot offer), and spec §7.3 makes an automated guard
 * mandatory rather than trusting prose: see `test/fluent/boundary.spec.ts`. The
 * rule is one-directional — `/fluent` imports the core functions it delegates
 * to; the root barrel never re-exports the wrapper.
 *
 * **Dual constructors** (spec §4, ADR 0001 §4): `ok` / `err` exist at *both*
 * entrypoints with the **same name** and a surface-appropriate return type — the
 * root's return plain data, these return wrappers. That is the decided design,
 * not a collision.
 */

export type { ResultChain };

/**
 * Builds a successful {@link ResultChain}.
 *
 * The no-arg overload mirrors the root's, covering the common `void` success:
 * prefer `ok()` over `ok(undefined)`.
 */
export function ok(): ResultChain<void, never>;
export function ok<T>(value: T): ResultChain<T, never>;
export function ok<T>(value?: T): ResultChain<T | void, never> {
  return new ResultChain(
    value === undefined ? coreOk() : coreOk<T | void>(value),
  );
}

/** Builds a failed {@link ResultChain}. */
export function err<E>(error: E): ResultChain<never, E> {
  return new ResultChain(coreErr(error));
}

/**
 * Re-enters fluent-land from a plain {@link Result}.
 *
 * The way back in from everything the wrapper deliberately does not mirror —
 * `combine`, `partition`, the `from*` constructors — all of which stay
 * free-function-only because they operate on arrays and non-`Result` inputs
 * rather than a single instance (spec §6).
 *
 * ```ts
 * from(combine([a, b])).map(sum).unwrapOr(0);
 * ```
 *
 * @remarks
 * A free `from` for sync, a static `ResultAsync.from` for async. The asymmetry
 * is as-decided by [ADR 0005 §4] and recorded in §6.3; do not "fix" it without
 * a new decision.
 */
export function from<T, E>(result: Result<T, E>): ResultChain<T, E> {
  return new ResultChain(result);
}
