import * as FpEither from 'fp-ts/Either';
import { describe, expect, it } from 'vitest';

import { ResultKit } from '../../src/core';
import {
  fromEither,
  fromTaskEither,
  toEither,
  toTaskEither,
} from '../../src/fp-ts';

describe('@zireal/result-kit/fp-ts', () => {
  it('converts result values to and from Either', () => {
    expect(toEither(ResultKit.success(42))).toEqual(FpEither.right(42));
    expect(toEither(ResultKit.failure('boom'))).toEqual(FpEither.left('boom'));

    expect(fromEither(FpEither.right('ok'))).toEqual(ResultKit.success('ok'));
    expect(fromEither(FpEither.left('nope'))).toEqual(ResultKit.failure('nope'));
  });

  it('converts promised results to and from TaskEither', async () => {
    const successfulTaskEither = toTaskEither(Promise.resolve(ResultKit.success(7)));
    const failedTaskEither = toTaskEither(() =>
      Promise.resolve(ResultKit.failure('network_error')),
    );

    await expect(successfulTaskEither()).resolves.toEqual(FpEither.right(7));
    await expect(failedTaskEither()).resolves.toEqual(
      FpEither.left('network_error'),
    );

    await expect(
      fromTaskEither(async () => FpEither.right({ id: 'u_123' })),
    ).resolves.toEqual(ResultKit.success({ id: 'u_123' }));
    await expect(
      fromTaskEither(async () => FpEither.left('timeout')),
    ).resolves.toEqual(ResultKit.failure('timeout'));
  });
});
