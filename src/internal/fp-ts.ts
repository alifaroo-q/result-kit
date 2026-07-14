import * as FpEither from 'fp-ts/Either';
import type { Either } from 'fp-ts/Either';
import type { TaskEither } from 'fp-ts/TaskEither';

import type { Result } from '../core/result';

export const toEither = <T, E>(result: Result<T, E>): Either<E, T> =>
  result.ok ? FpEither.right(result.value) : FpEither.left(result.error);

export const fromEither = <T, E>(either: Either<E, T>): Result<T, E> =>
  FpEither.isRight(either)
    ? { ok: true, value: either.right }
    : { ok: false, error: either.left };

export const toTaskEither = <T, E>(
  input: Promise<Result<T, E>> | (() => Promise<Result<T, E>>),
): TaskEither<E, T> => async () => {
  const result = typeof input === 'function' ? await input() : await input;

  return toEither(result);
};

export const fromTaskEither = async <T, E>(
  taskEither: TaskEither<E, T>,
): Promise<Result<T, E>> => fromEither(await taskEither());
