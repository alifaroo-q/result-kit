import * as FpEither from "fp-ts/Either";
import { pipe } from "fp-ts/function";
import type { Either } from "fp-ts/Either";
import type { TaskEither } from "fp-ts/TaskEither";

import {
  fromEither,
  fromTaskEither,
  toEither,
  toTaskEither,
} from "../internal/fp-ts";
import { type Result } from "./result";

type Awaitable<T> = T | Promise<T>;

type SyncTapHandlers<T, E> = {
  onSuccess?: (value: T) => void;
  onFailure?: (error: E) => void;
};

type AsyncTapHandlers<T, E> = {
  onSuccess?: (value: T) => Awaitable<void>;
  onFailure?: (error: E) => Awaitable<void>;
};

const isResultShape = <T, E>(
  value: Result<T, E> | Either<E, T>,
): value is Result<T, E> =>
  !!value &&
  typeof value === "object" &&
  "ok" in value &&
  (value.ok === true || value.ok === false);

const isTaskEither = <T, E>(
  value: Promise<Result<T, E>> | TaskEither<E, T>,
): value is TaskEither<E, T> => typeof value === "function";

const mapTaskEither =
  <T, U, E>(
    taskEither: TaskEither<E, T>,
    fn: (value: T) => Awaitable<U>,
  ): TaskEither<E, U> =>
  async () => {
    const either = await taskEither();

    if (FpEither.isLeft(either)) {
      return FpEither.left<E, U>(either.left);
    }

    return FpEither.right<E, U>(await fn(either.right));
  };

const mapTaskEitherError =
  <T, E, F>(
    taskEither: TaskEither<E, T>,
    fn: (error: E) => Awaitable<F>,
  ): TaskEither<F, T> =>
  async () => {
    const either = await taskEither();

    if (FpEither.isLeft(either)) {
      return FpEither.left<F, T>(await fn(either.left));
    }

    return FpEither.right<F, T>(either.right);
  };

const flatMapTaskEither =
  <T, U, E, F>(
    taskEither: TaskEither<E, T>,
    fn: (value: T) => Awaitable<Result<U, F>>,
  ): TaskEither<E | F, U> =>
  async () => {
    const either = await taskEither();

    if (FpEither.isLeft(either)) {
      return FpEither.left<E | F, U>(either.left);
    }

    return toEither(await fn(either.right));
  };

const orElseTaskEither =
  <T, E, F>(
    taskEither: TaskEither<E, T>,
    fn: (error: E) => Awaitable<Result<T, F>>,
  ): TaskEither<F, T> =>
  async () => {
    const either = await taskEither();

    if (FpEither.isLeft(either)) {
      return toEither(await fn(either.left));
    }

    return FpEither.right<F, T>(either.right);
  };

const tapTaskEither =
  <T, E>(
    taskEither: TaskEither<E, T>,
    handlers: AsyncTapHandlers<T, E>,
  ): TaskEither<E, T> =>
  async () => {
    const either = await taskEither();

    if (FpEither.isLeft(either)) {
      await handlers.onFailure?.(either.left);

      return FpEither.left<E, T>(either.left);
    }

    await handlers.onSuccess?.(either.right);

    return FpEither.right<E, T>(either.right);
  };

export class ResultPipeline<T, E> {
  private readonly either: Either<E, T>;

  constructor(result: Result<T, E> | Either<E, T>) {
    this.either = isResultShape(result) ? toEither(result) : result;
  }

  map<U>(fn: (value: T) => U): ResultPipeline<U, E> {
    return new ResultPipeline<U, E>(pipe(this.either, FpEither.map(fn)));
  }

  mapError<F>(fn: (error: E) => F): ResultPipeline<T, F> {
    return new ResultPipeline<T, F>(pipe(this.either, FpEither.mapLeft(fn)));
  }

  andThen<U, F>(fn: (value: T) => Result<U, F>): ResultPipeline<U, E | F> {
    return new ResultPipeline<U, E | F>(
      pipe(
        this.either,
        FpEither.chainW((value) => toEither(fn(value))),
      ),
    );
  }

  tap(handlers: SyncTapHandlers<T, E>): ResultPipeline<T, E> {
    if (FpEither.isLeft(this.either)) {
      handlers.onFailure?.(this.either.left);
    } else {
      handlers.onSuccess?.(this.either.right);
    }

    return new ResultPipeline<T, E>(this.either);
  }

  orElse<F>(fn: (error: E) => Result<T, F>): ResultPipeline<T, F> {
    return new ResultPipeline<T, F>(
      pipe(
        this.either,
        FpEither.orElseW((error) => toEither(fn(error))),
      ),
    );
  }

  match<U>(handlers: {
    onSuccess: (value: T) => U;
    onFailure: (error: E) => U;
  }): U {
    return pipe(
      this.either,
      FpEither.match(handlers.onFailure, handlers.onSuccess),
    );
  }

  done(): Result<T, E> {
    return fromEither(this.either);
  }
}

export class AsyncResultPipeline<T, E> {
  private readonly taskEither: TaskEither<E, T>;

  constructor(result: Promise<Result<T, E>> | TaskEither<E, T>) {
    this.taskEither = isTaskEither(result) ? result : toTaskEither(result);
  }

  andThen<U, F>(
    fn: (value: T) => Awaitable<Result<U, F>>,
  ): AsyncResultPipeline<U, E | F> {
    return new AsyncResultPipeline<U, E | F>(
      flatMapTaskEither(this.taskEither, fn),
    );
  }

  map<U>(fn: (value: T) => Awaitable<U>): AsyncResultPipeline<U, E> {
    return new AsyncResultPipeline<U, E>(mapTaskEither(this.taskEither, fn));
  }

  mapError<F>(fn: (error: E) => Awaitable<F>): AsyncResultPipeline<T, F> {
    return new AsyncResultPipeline<T, F>(
      mapTaskEitherError(this.taskEither, fn),
    );
  }

  tap(handlers: AsyncTapHandlers<T, E>): AsyncResultPipeline<T, E> {
    return new AsyncResultPipeline<T, E>(
      tapTaskEither(this.taskEither, handlers),
    );
  }

  orElse<F>(
    fn: (error: E) => Awaitable<Result<T, F>>,
  ): AsyncResultPipeline<T, F> {
    return new AsyncResultPipeline<T, F>(orElseTaskEither(this.taskEither, fn));
  }

  async match<U>(handlers: {
    onSuccess: (value: T) => Awaitable<U>;
    onFailure: (error: E) => Awaitable<U>;
  }): Promise<U> {
    const either = await this.taskEither();

    return FpEither.isLeft(either)
      ? handlers.onFailure(either.left)
      : handlers.onSuccess(either.right);
  }

  done(): Promise<Result<T, E>> {
    return fromTaskEither(this.taskEither);
  }
}
