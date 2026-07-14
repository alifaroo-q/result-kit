import {
  isTypedError,
  type TypedError,
} from './error';
import {
  type Failure,
  type Result,
  type Success,
} from './result';
import {
  AsyncResultPipeline,
  ResultPipeline,
} from './pipeline';

const isResultShape = <T, E>(value: unknown): value is Result<T, E> => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    ok?: unknown;
  };

  // `pipe(...)` accepts either a raw value or an existing Result. Runtime
  // normalization must therefore be shape-based, so values that already match
  // the Result contract are treated as wrapped results.
  return candidate.ok === true || candidate.ok === false;
};

/**
 * Static utilities for creating, transforming, inspecting, and consuming
 * {@link Result} values.
 *
 * The class is intentionally abstract because it acts as a namespaced toolbox
 * rather than a type meant to be instantiated.
 */
export abstract class ResultKit {
  static pipe<T, E>(result: Result<T, E>): ResultPipeline<T, E>;
  static pipe<T>(value: T): ResultPipeline<T, never>;
  static pipe<T, E>(valueOrResult: T | Result<T, E>): ResultPipeline<T, E> {
    return isResultShape<T, E>(valueOrResult)
      ? new ResultPipeline(valueOrResult)
      : new ResultPipeline(this.success(valueOrResult as T));
  }

  static pipeAsync<T, E>(
    result: Promise<Result<T, E>>,
  ): AsyncResultPipeline<T, E>;
  static pipeAsync<T>(value: Promise<T>): AsyncResultPipeline<T, never>;
  static pipeAsync<T, E>(result: Result<T, E>): AsyncResultPipeline<T, E>;
  static pipeAsync<T>(value: T): AsyncResultPipeline<T, never>;
  static pipeAsync<T, E>(
    valueOrResultOrPromise: T | Promise<T> | Result<T, E> | Promise<Result<T, E>>,
  ): AsyncResultPipeline<T, E> {
    return new AsyncResultPipeline(
      Promise.resolve(valueOrResultOrPromise).then((resolved) =>
        isResultShape<T, E>(resolved)
          ? resolved
          : this.success(resolved as T),
      ),
    );
  }

  /**
   * Determines whether a result contains a successful value.
   *
   * Use this as a type guard when branching manually over a {@link Result}.
   *
   * @param result Result to inspect.
   * @returns `true` when `result` is a {@link Success}.
   */
  static isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
    return result.ok === true;
  }

  /**
   * Determines whether a result contains a failure value.
   *
   * Use this as a type guard when branching manually over a {@link Result}.
   *
   * @param result Result to inspect.
   * @returns `true` when `result` is a {@link Failure}.
   */
  static isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
    return result.ok === false;
  }

  /**
   * Constructs a successful result.
   *
   * Prefer this helper over hand-writing `{ ok: true, value }` so result
   * creation stays uniform across the codebase.
   *
   * @param value Successful value to wrap.
   * @returns A {@link Success} containing `value`.
   */
  static success<T>(value: T): Success<T> {
    return { ok: true, value };
  }

  /**
   * Constructs a failed result with any error payload.
   *
   * This is the generic failure constructor for non-`TypedError` failures.
   *
   * @param error Error payload to wrap.
   * @returns A {@link Failure} containing `error`.
   */
  static failure<E>(error: E): Failure<E> {
    return { ok: false, error };
  }

  /**
   * Constructs a failed result from a {@link TypedError}.
   *
   * This is a convenience wrapper around {@link ResultKit.failure} for the
   * package's structured error convention.
   *
   * @param error Structured error payload to wrap.
   * @returns A failed result carrying the provided typed error.
   */
  static fail<T extends string>(error: TypedError<T>): Failure<TypedError<T>> {
    return this.failure(error);
  }

  /**
   * Determines whether an unknown value satisfies the runtime shape of
   * {@link TypedError}.
   *
   * @param error Value to validate.
   * @returns `true` when `error` looks like a typed error object.
   */
  static isTypedError(error: unknown): error is TypedError<string> {
    return isTypedError(error);
  }

  /**
   * Transforms the success value of a result while leaving failures untouched.
   *
   * Use this when you want to project successful data without changing the
   * failure channel.
   *
   * @param result Result whose success value may be transformed.
   * @param fn Mapping function applied only when `result` is successful.
   * @returns A new successful result with the mapped value, or the original
   * failure when `result` is unsuccessful.
   */
  static map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return this.isSuccess(result) ? this.success(fn(result.value)) : result;
  }

  /**
   * Transforms both branches of a result in one operation.
   *
   * Use this when success and failure values both need projection into new
   * shapes.
   *
   * @param result Result to transform.
   * @param onSuccess Mapper applied when `result` is successful.
   * @param onFailure Mapper applied when `result` is failed.
   * @returns A result whose success and failure payloads have been mapped into
   * the target types.
   */
  static bimap<T, U, E, F>(
    result: Result<T, E>,
    onSuccess: (value: T) => U,
    onFailure: (error: E) => F,
  ): Result<U, F> {
    return this.isSuccess(result)
      ? this.success(onSuccess(result.value))
      : this.failure(onFailure(result.error));
  }

  /**
   * Asynchronously transforms the success value of a result.
   *
   * Failures are returned unchanged and `fn` is never invoked for them.
   *
   * @param result Result whose success value may be transformed.
   * @param fn Async mapping function applied only when `result` is successful.
   * @returns A promise resolving to a mapped success result or the original
   * failure.
   */
  static async mapAsync<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Promise<U>,
  ): Promise<Result<U, E>> {
    return this.isSuccess(result)
      ? this.success(await fn(result.value))
      : result;
  }

  /**
   * Transforms the failure value of a result while leaving successes untouched.
   *
   * @param result Result whose error may be transformed.
   * @param fn Mapping function applied only when `result` is failed.
   * @returns The original success result or a new failed result containing the
   * mapped error.
   */
  static mapError<T, E, F>(
    result: Result<T, E>,
    fn: (error: E) => F,
  ): Result<T, F> {
    return this.isFailure(result) ? this.failure(fn(result.error)) : result;
  }

  /**
   * Asynchronously transforms the failure value of a result.
   *
   * Success values are returned unchanged and `fn` is never invoked for them.
   *
   * @param result Result whose error may be transformed.
   * @param fn Async mapping function applied only when `result` is failed.
   * @returns A promise resolving to the original success result or a new failed
   * result containing the mapped error.
   */
  static async mapErrorAsync<T, E, F>(
    result: Result<T, E>,
    fn: (error: E) => Promise<F>,
  ): Promise<Result<T, F>> {
    return this.isFailure(result)
      ? this.failure(await fn(result.error))
      : result;
  }

  /**
   * Chains another result-producing operation onto a successful result.
   *
   * This is the standard flat-mapping operation for the success branch and is
   * useful for sequencing dependent computations without nesting `Result`
   * values.
   *
   * @param result Result to continue from.
   * @param fn Function invoked only when `result` is successful.
   * @returns The chained result, or the original failure unchanged.
   */
  static andThen<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Result<U, E>,
  ): Result<U, E> {
    return this.isSuccess(result) ? fn(result.value) : result;
  }

  /**
   * Asynchronously chains another result-producing operation onto a successful
   * result.
   *
   * @param result Result to continue from.
   * @param fn Async function invoked only when `result` is successful.
   * @returns A promise resolving to the chained result or the original failure.
   */
  static async andThenAsync<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Promise<Result<U, E>>,
  ): Promise<Result<U, E>> {
    return this.isSuccess(result) ? fn(result.value) : result;
  }

  /**
   * Recovers from a failed result by mapping it into a new result.
   *
   * Use this to provide fallback logic, error translation, or alternate
   * retrieval paths for the failure branch.
   *
   * @param result Result to recover from.
   * @param fn Recovery function invoked only when `result` is failed.
   * @returns The original success result or the recovery result.
   */
  static orElse<T, E, F>(
    result: Result<T, E>,
    fn: (error: E) => Result<T, F>,
  ): Result<T, F> {
    return this.isFailure(result) ? fn(result.error) : result;
  }

  /**
   * Asynchronously recovers from a failed result by mapping it into a new
   * result.
   *
   * @param result Result to recover from.
   * @param fn Async recovery function invoked only when `result` is failed.
   * @returns A promise resolving to the original success result or the recovery
   * result.
   */
  static async orElseAsync<T, E, F>(
    result: Result<T, E>,
    fn: (error: E) => Promise<Result<T, F>>,
  ): Promise<Result<T, F>> {
    return this.isFailure(result) ? fn(result.error) : result;
  }

  /**
   * Extracts the success value from a result when present.
   *
   * This helper is intentionally non-throwing. Failures resolve to
   * `undefined`, making it suitable when absence is acceptable.
   *
   * @param result Result to unwrap.
   * @returns The success value, or `undefined` when the result is failed.
   */
  static unwrap<T, E>(result: Result<T, E>): T | undefined {
    return this.isSuccess(result) ? result.value : undefined;
  }

  /**
   * Extracts the value from a known {@link Success}.
   *
   * Use this when the success branch has already been narrowed and you want a
   * small semantic wrapper around direct property access.
   *
   * @param result Successful result to unwrap.
   * @returns The contained success value.
   */
  static unwrapSuccess<T>(result: Success<T>): T {
    return result.value;
  }

  /**
   * Extracts the error from a known {@link Failure}.
   *
   * Use this when the failure branch has already been narrowed and you want a
   * small semantic wrapper around direct property access.
   *
   * @param result Failed result to unwrap.
   * @returns The contained error value.
   */
  static unwrapFailure<E>(result: Failure<E>): E {
    return result.error;
  }

  /**
   * Extracts the success value or returns a provided fallback.
   *
   * The fallback is evaluated eagerly before the call, so use
   * {@link ResultKit.unwrapOrElse} when computing the fallback is expensive.
   *
   * @param result Result to unwrap.
   * @param defaultValue Value to return when `result` is failed.
   * @returns The success value or `defaultValue`.
   */
  static unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return this.isSuccess(result) ? result.value : defaultValue;
  }

  /**
   * Extracts the success value or computes a fallback from the failure.
   *
   * The fallback callback is evaluated lazily and receives the failure value.
   *
   * @param result Result to unwrap.
   * @param fn Function used to derive a fallback from the error.
   * @returns The success value or the callback result.
   */
  static unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
    return this.isSuccess(result) ? result.value : fn(result.error);
  }

  /**
   * Asynchronously extracts the success value or computes a fallback from the
   * failure.
   *
   * @param result Result to unwrap.
   * @param fn Async function used to derive a fallback from the error.
   * @returns A promise resolving to the success value or the callback result.
   */
  static async unwrapOrElseAsync<T, E>(
    result: Result<T, E>,
    fn: (error: E) => Promise<T>,
  ): Promise<T> {
    return this.isSuccess(result) ? result.value : fn(result.error);
  }

  /**
   * Folds a result into a single output value.
   *
   * This is useful at application boundaries where both branches need to
   * produce the same final shape.
   *
   * @param result Result to match against.
   * @param handlers Branch handlers for success and failure.
   * @returns The value returned by the matching handler.
   */
  static match<T, E, U>(
    result: Result<T, E>,
    handlers: {
      onSuccess: (value: T) => U;
      onFailure: (error: E) => U;
    },
  ): U {
    return this.isSuccess(result)
      ? handlers.onSuccess(result.value)
      : handlers.onFailure(result.error);
  }

  /**
   * Asynchronously folds a result into a single output value.
   *
   * @param result Result to match against.
   * @param handlers Async branch handlers for success and failure.
   * @returns A promise resolving to the value returned by the matching handler.
   */
  static async matchAsync<T, E, U>(
    result: Result<T, E>,
    handlers: {
      onSuccess: (value: T) => Promise<U>;
      onFailure: (error: E) => Promise<U>;
    },
  ): Promise<U> {
    return this.isSuccess(result)
      ? handlers.onSuccess(result.value)
      : handlers.onFailure(result.error);
  }

  /**
   * Runs side effects for a result branch and returns the original result.
   *
   * Use this for logging, metrics, tracing, or other observational work that
   * should not change the result payload.
   *
   * @param result Result to observe.
   * @param handlers Optional side-effect handlers for either branch.
   * @returns The original `result` instance.
   */
  static tap<T, E>(
    result: Result<T, E>,
    handlers: {
      onSuccess?: (value: T) => void;
      onFailure?: (error: E) => void;
    },
  ): Result<T, E> {
    if (this.isSuccess(result)) {
      handlers.onSuccess?.(result.value);
    } else {
      handlers.onFailure?.(result.error);
    }

    return result;
  }

  /**
   * Asynchronously runs side effects for a result branch and returns the
   * original result.
   *
   * @param result Result to observe.
   * @param handlers Optional async side-effect handlers for either branch.
   * @returns A promise resolving to the original `result` instance after side
   * effects complete.
   */
  static async tapAsync<T, E>(
    result: Result<T, E>,
    handlers: {
      onSuccess?: (value: T) => Promise<void>;
      onFailure?: (error: E) => Promise<void>;
    },
  ): Promise<Result<T, E>> {
    if (this.isSuccess(result)) {
      await handlers.onSuccess?.(result.value);
    } else {
      await handlers.onFailure?.(result.error);
    }

    return result;
  }

  /**
   * Combines an array of results into a single result of an array.
   *
   * Combination short-circuits on the first failure encountered. When every
   * result succeeds, the returned success contains the collected values in the
   * same order as the input array.
   *
   * @param results Results to combine.
   * @returns A success containing all values, or the first failure encountered.
   */
  static combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];

    for (const result of results) {
      if (this.isFailure(result)) {
        return result;
      }

      values.push(result.value);
    }

    return this.success(values);
  }

  /**
   * Asynchronously combines multiple promised results into one result.
   *
   * All promises are awaited before combination, so this helper does not stop
   * pending asynchronous work after an eventual failure.
   *
   * @param results Promises resolving to results.
   * @returns A promise resolving to the same output as {@link ResultKit.combine}.
   */
  static async combineAsync<T, E>(
    results: Promise<Result<T, E>>[],
  ): Promise<Result<T[], E>> {
    return this.combine(await Promise.all(results));
  }

  /**
   * Combines an array of results while collecting every failure.
   *
   * Successful values are preserved in order. If one or more failures occur,
   * the returned failure contains an array of all collected errors rather than
   * only the first one.
   *
   * @param results Results to combine.
   * @returns A success containing all values when every result succeeds, or a
   * failure containing all collected errors.
   */
  static combineWithAllErrors<T, E>(results: Result<T, E>[]): Result<T[], E[]> {
    const values: T[] = [];
    const errors: E[] = [];

    for (const result of results) {
      if (this.isSuccess(result)) {
        values.push(result.value);
      } else {
        errors.push(result.error);
      }
    }

    return errors.length > 0 ? this.failure(errors) : this.success(values);
  }

  /**
   * Asynchronously combines multiple promised results while collecting every
   * failure.
   *
   * As with {@link ResultKit.combineAsync}, all promises are awaited before
   * reduction.
   *
   * @param results Promises resolving to results.
   * @returns A promise resolving to the same output as
   * {@link ResultKit.combineWithAllErrors}.
   */
  static async combineWithAllErrorsAsync<T, E>(
    results: Promise<Result<T, E>>[],
  ): Promise<Result<T[], E[]>> {
    return this.combineWithAllErrors(await Promise.all(results));
  }

  /**
   * Removes one layer of `Result` nesting from the success branch.
   *
   * This is useful after operations that already return a `Result` have been
   * wrapped in another success result.
   *
   * @param result Nested result to flatten.
   * @returns The inner result when successful, or the outer failure unchanged.
   */
  static flatten<T, E>(result: Result<Result<T, E>, E>): Result<T, E> {
    return this.isSuccess(result) ? result.value : result;
  }

  /**
   * Converts a promise that may reject into a promise of `Result`.
   *
   * Rejections are caught and normalized through `errorFn`, allowing async
   * exception sources to participate in explicit result-based control flow.
   *
   * @param promise Promise to execute.
   * @param errorFn Function used to convert an unknown rejection reason into
   * the desired error type.
   * @returns A promise resolving to a successful result for fulfilled values or
   * a failed result for rejected values.
   */
  static async fromPromise<T, E>(
    promise: Promise<T>,
    errorFn: (error: unknown) => E,
  ): Promise<Result<T, E>> {
    try {
      return this.success(await promise);
    } catch (error) {
      return this.failure(errorFn(error));
    }
  }

  /**
   * Wraps a synchronous function so thrown exceptions are returned as failures.
   *
   * The resulting function preserves the original parameter list while
   * converting thrown errors with `errorFn`.
   *
   * @param fn Function that may throw.
   * @param errorFn Function used to map an unknown thrown value into the
   * desired error type.
   * @returns A new function that returns `Result` instead of throwing.
   */
  static fromThrowable<Args extends unknown[], T, E>(
    fn: (...args: Args) => T,
    errorFn: (error: unknown) => E,
  ): (...args: Args) => Result<T, E> {
    return (...args) => {
      try {
        return this.success(fn(...args));
      } catch (error) {
        return this.failure(errorFn(error));
      }
    };
  }

  /**
   * Wraps an asynchronous function so thrown exceptions and rejected promises
   * are returned as failures.
   *
   * @param fn Async function that may throw or reject.
   * @param errorFn Function used to map an unknown failure reason into the
   * desired error type.
   * @returns A new function that resolves to `Result` instead of propagating
   * exceptions.
   */
  static fromThrowableAsync<Args extends unknown[], T, E>(
    fn: (...args: Args) => Promise<T>,
    errorFn: (error: unknown) => E,
  ): (...args: Args) => Promise<Result<T, E>> {
    return async (...args) => {
      try {
        return this.success(await fn(...args));
      } catch (error) {
        return this.failure(errorFn(error));
      }
    };
  }

  /**
   * Converts a nullable value into a result.
   *
   * `null` and `undefined` become failures carrying the provided error. Any
   * other value becomes a success and is narrowed to `NonNullable<T>`.
   *
   * @param value Value to check for nullability.
   * @param error Error to return when `value` is nullish.
   * @returns A success for non-nullish values or a failure for nullish values.
   */
  static fromNullable<T, E>(
    value: T | null | undefined,
    error: E,
  ): Result<NonNullable<T>, E> {
    return value == null ? this.failure(error) : this.success(value);
  }

  /**
   * Converts a predicate check into a result.
   *
   * @param value Value to validate.
   * @param predicate Predicate that determines whether `value` is acceptable.
   * @param error Error to return when the predicate fails.
   * @returns A success containing `value` when the predicate passes, otherwise
   * a failure containing `error`.
   */
  static fromPredicate<T, E>(
    value: T,
    predicate: (value: T) => boolean,
    error: E,
  ): Result<T, E> {
    return predicate(value) ? this.success(value) : this.failure(error);
  }

  /**
   * Converts a result into a nullable value.
   *
   * Use this when crossing into APIs that model absence with `null` rather
   * than an explicit failure channel.
   *
   * @param result Result to convert.
   * @returns The success value or `null` when the result is failed.
   */
  static toNullable<T, E>(result: Result<T, E>): T | null {
    return this.isSuccess(result) ? result.value : null;
  }

  /**
   * Splits an array of results into parallel arrays of successes and failures.
   *
   * Ordering is preserved independently within each returned array.
   *
   * @param results Results to partition.
   * @returns A tuple containing successful values at index `0` and failure
   * values at index `1`.
   */
  static partition<T, E>(results: Result<T, E>[]): [T[], E[]] {
    const values: T[] = [];
    const errors: E[] = [];

    for (const result of results) {
      if (this.isSuccess(result)) {
        values.push(result.value);
      } else {
        errors.push(result.error);
      }
    }

    return [values, errors];
  }

  /**
   * Collects only the success values from an array of results.
   *
   * Failures are discarded.
   *
   * @param results Results to filter.
   * @returns An array of success values in input order.
   */
  static filterSuccesses<T, E>(results: Result<T, E>[]): T[] {
    return results
      .filter((result): result is Success<T> => this.isSuccess(result))
      .map((result) => result.value);
  }

  /**
   * Collects only the failure values from an array of results.
   *
   * Successes are discarded.
   *
   * @param results Results to filter.
   * @returns An array of failure values in input order.
   */
  static filterFailures<T, E>(results: Result<T, E>[]): E[] {
    return results
      .filter((result): result is Failure<E> => this.isFailure(result))
      .map((result) => result.error);
  }
}
