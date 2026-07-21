import { isErr, isOk } from './result';
import type { Result } from './result';

/**
 * Narrows a {@link Result} to its value, throwing a descriptive error on `Err`.
 *
 * ```ts
 * const value = expectOk(result);
 * expect(value.items).toHaveLength(2);
 * ```
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!isOk(result)) {
    throw new Error(
      `Expected Ok, got Err: ${JSON.stringify(result.error)}`,
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
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (!isErr(result)) {
    throw new Error(
      `Expected Err, got Ok: ${JSON.stringify(result.value)}`,
    );
  }
  return result.error;
}
