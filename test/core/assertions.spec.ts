import { describe, expect, expectTypeOf, it } from 'vitest';

import { expectErr, expectOk, ok, err } from '../../src/index';
import type { Result } from '../../src/index';

const launder = <T, E>(r: Result<T, E>): Result<T, E> => r;

describe('expectOk', () => {
  it('returns the value on Ok', () => {
    const value = expectOk(ok(42));
    expect(value).toBe(42);
  });

  it('narrows the value type', () => {
    const r = launder<{ name: string }, string>(ok({ name: 'alice' }));
    const value = expectOk(r);
    expectTypeOf(value).toEqualTypeOf<{ name: string }>();
    expect(value.name).toBe('alice');
  });

  it('throws a descriptive error on Err', () => {
    expect(() => expectOk(err('boom'))).toThrow(
      'Expected Ok, got Err: "boom"',
    );
  });

  it('throws with JSON-stringified payload on Err', () => {
    const error = { type: 'not_found', message: 'User not found' };
    expect(() => expectOk(err(error))).toThrow(
      'Expected Ok, got Err: ' + JSON.stringify(error),
    );
  });
});

describe('expectErr', () => {
  it('returns the error on Err', () => {
    const error = expectErr(err('boom'));
    expect(error).toBe('boom');
  });

  it('narrows the error type', () => {
    const r = launder<number, { type: string }>(err({ type: 'not_found' }));
    const error = expectErr(r);
    expectTypeOf(error).toEqualTypeOf<{ type: string }>();
    expect(error.type).toBe('not_found');
  });

  it('throws a descriptive error on Ok', () => {
    expect(() => expectErr(ok(42))).toThrow(
      'Expected Err, got Ok: 42',
    );
  });

  it('throws with JSON-stringified payload on Ok', () => {
    const value = { id: '123', name: 'alice' };
    expect(() => expectErr(ok(value))).toThrow(
      'Expected Err, got Ok: ' + JSON.stringify(value),
    );
  });
});
