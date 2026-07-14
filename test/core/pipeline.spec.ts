import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ResultKit,
  type Result,
  type TypedErrorUnion,
} from '../../src/core';

type AuthError = TypedErrorUnion<'unauthorized'>;
type UserError = TypedErrorUnion<'user_not_found'>;
type BillingError = TypedErrorUnion<'invoice_not_found'>;

describe('ResultPipeline', () => {
  it('starts from a raw value and widens error unions across sync steps', () => {
    const requireSession = (
      token: string,
    ): Result<{ userId: string }, AuthError> =>
      token
        ? ResultKit.success({ userId: 'u_123' })
        : ResultKit.fail({
            type: 'unauthorized',
            message: 'Missing token',
          });

    const findUser = (
      session: { userId: string },
    ): Result<{ id: string }, UserError> =>
      ResultKit.success({ id: session.userId });

    const loadInvoice = (
      user: { id: string },
    ): Result<{ id: string; userId: string }, BillingError> =>
      ResultKit.success({ id: 'inv_1', userId: user.id });

    const result = ResultKit
      .pipe('token')
      .andThen(requireSession)
      .andThen(findUser)
      .andThen(loadInvoice)
      .done();

    expectTypeOf(result).toEqualTypeOf<
      Result<{ id: string; userId: string }, AuthError | UserError | BillingError>
    >();
    expect(result).toEqual({
      ok: true,
      value: { id: 'inv_1', userId: 'u_123' },
    });
  });

  it('starts from an existing failure result and short-circuits later sync steps', () => {
    let calls = 0;

    const result = ResultKit
      .pipe(
        ResultKit.fail({
          type: 'unauthorized',
          message: 'Missing token',
        }),
      )
      .andThen(() => {
        calls += 1;
        return ResultKit.success({ id: 'u_123' });
      })
      .done();

    expect(calls).toBe(0);
    expect(result).toEqual({
      ok: false,
      error: {
        type: 'unauthorized',
        message: 'Missing token',
      },
    });
  });

  it('supports sync map, mapError, tap, orElse, and match helpers', () => {
    const observed: string[] = [];

    const successValue = ResultKit
      .pipe({ name: 'Ada Lovelace' })
      .map((user) => user.name.toUpperCase())
      .tap({
        onSuccess: (name) => observed.push(`success:${name}`),
      })
      .match({
        onSuccess: (name) => name,
        onFailure: () => 'fallback',
      });

    const failedLengthResult: Result<number, TypedErrorUnion<'missing_name'>> =
      ResultKit.fail({
        type: 'missing_name',
        message: 'Name is required',
      });

    const recovered = ResultKit
      .pipe(failedLengthResult)
      .mapError((error) => error.type)
      .tap({
        onFailure: (errorType) => observed.push(`failure:${errorType}`),
      })
      .orElse((errorType) => ResultKit.success(errorType.length))
      .done();

    expect(successValue).toBe('ADA LOVELACE');
    expect(recovered).toEqual(ResultKit.success('missing_name'.length));
    expect(observed).toEqual([
      'success:ADA LOVELACE',
      'failure:missing_name',
    ]);
  });

  it('starts from promises and widens error unions across async steps', async () => {
    const requireSessionAsync = async (
      token: string,
    ): Promise<Result<{ userId: string }, AuthError>> =>
      token
        ? ResultKit.success({ userId: 'u_123' })
        : ResultKit.fail({
            type: 'unauthorized',
            message: 'Missing token',
          });

    const findUserAsync = async (
      session: { userId: string },
    ): Promise<Result<{ id: string }, UserError>> =>
      ResultKit.success({ id: session.userId });

    const result = await ResultKit
      .pipeAsync(Promise.resolve('token'))
      .andThen(requireSessionAsync)
      .andThen(findUserAsync)
      .done();

    expectTypeOf(result).toEqualTypeOf<
      Result<{ id: string }, AuthError | UserError>
    >();
    expect(result).toEqual({
      ok: true,
      value: { id: 'u_123' },
    });
  });

  it('short-circuits later async steps after the first failure', async () => {
    let calls = 0;

    const result = await ResultKit
      .pipeAsync(
        Promise.resolve(
          ResultKit.fail({
            type: 'unauthorized',
            message: 'Missing token',
          }),
        ),
      )
      .andThen(async () => {
        calls += 1;
        return ResultKit.success({ id: 'u_123' });
      })
      .done();

    expect(calls).toBe(0);
    expect(result).toEqual({
      ok: false,
      error: {
        type: 'unauthorized',
        message: 'Missing token',
      },
    });
  });

  it('supports mixed sync and async callbacks in async pipelines', async () => {
    const observed: string[] = [];

    const successValue = await ResultKit
      .pipeAsync(Promise.resolve('Ada Lovelace'))
      .map((name) => name.toUpperCase())
      .tap({
        onSuccess: async (name) => {
          observed.push(`success:${name}`);
        },
      })
      .match({
        onSuccess: (name) => name,
        onFailure: () => 'fallback',
      });

    const recovered = await ResultKit
      .pipeAsync(
        Promise.resolve(
          ResultKit.fail({
            type: 'missing_name',
            message: 'Name is required',
          }),
        ),
      )
      .mapError(async (error) => error.type)
      .tap({
        onFailure: (errorType) => {
          observed.push(`failure:${errorType}`);
        },
      })
      .orElse(async (errorType) => ResultKit.success(errorType.length))
      .done();

    expect(successValue).toBe('ADA LOVELACE');
    expect(recovered).toEqual(ResultKit.success('missing_name'.length));
    expect(observed).toEqual([
      'success:ADA LOVELACE',
      'failure:missing_name',
    ]);
  });
});
