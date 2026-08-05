import { renderDiagnostic } from './render';
import { isErr, isOk } from './result';
import type { Result } from './result';

/**
 * Narrows a {@link Result} to its value, throwing a descriptive error on `Err`.
 *
 * ```ts
 * const value = expectOk(result);
 * expect(value.items).toHaveLength(2);
 * ```
 *
 * The payload goes through {@link renderDiagnostic}, not `JSON.stringify` —
 * this message is thrown at the moment a caller is already confused, and a raw
 * `TypeError: Converting circular structure to JSON` in its place answers a
 * question nobody asked. The `/testing` matchers delegate every wrong-branch
 * message here, so they inherit that guarantee.
 *
 * A `TypedError` (or an array of them, as `combineWithAllErrors` produces)
 * reads as a §3.4 `✖ type: message` block with its `details` and `cause`
 * beneath, rather than as one line of JSON — the point being that the failure
 * is diagnosable from the test output alone. Every other payload renders
 * exactly as it did before.
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!isOk(result)) {
    throw new Error(renderDiagnostic('Expected Ok, got Err', result.error));
  }
  return result.value;
}

/**
 * Narrows a {@link Result} to its error, throwing a descriptive error on `Ok`.
 *
 * ```ts
 * const error = expectErr(result);
 * expect(error.type).toBe('not_found');
 * ```
 *
 * Renders through {@link renderDiagnostic} for the reason {@link expectOk}
 * does, and **symmetrically**: an `Ok` carrying a typed error shape prettifies
 * too. That is unusual but not wrong, and one rule that holds on both branches
 * beats two rules that differ by which half you are on.
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (!isErr(result)) {
    throw new Error(renderDiagnostic('Expected Err, got Ok', result.value));
  }
  return result.error;
}
