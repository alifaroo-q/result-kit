import { renderPayload } from './render';
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
 * The payload goes through {@link renderPayload}, not `JSON.stringify` — this
 * message is thrown at the moment a caller is already confused, and a raw
 * `TypeError: Converting circular structure to JSON` in its place answers a
 * question nobody asked. The `/testing` matchers delegate every wrong-branch
 * message here, so they inherit that guarantee.
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!isOk(result)) {
    throw new Error(
      `Expected Ok, got Err: ${renderPayload(result.error)}`,
    );
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
 * Renders through {@link renderPayload} for the reason {@link expectOk} does.
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (!isErr(result)) {
    throw new Error(
      `Expected Err, got Ok: ${renderPayload(result.value)}`,
    );
  }
  return result.error;
}
