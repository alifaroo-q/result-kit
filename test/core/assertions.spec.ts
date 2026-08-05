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

describe('expectOk / expectErr — payloads that broke the message', () => {
  // These are public API in their own right, not only the matchers' delegate,
  // and each of these threw the *wrong error entirely* before `renderPayload`:
  // the caller asking "why is this an Err?" got a serializer crash instead.
  const hostile: [label: string, make: () => unknown][] = [
    [
      'a circular object',
      () => {
        const node: Record<string, unknown> = { type: 'not_found' };
        node.self = node;
        return node;
      },
    ],
    ['a BigInt', () => 10n],
    ['an object carrying a BigInt id', () => ({ id: 10n })],
    [
      'an object with a throwing toJSON',
      () => ({
        toJSON() {
          throw new Error('nope');
        },
      }),
    ],
    ['a Symbol', () => Symbol('session')],
    ['a function', () => function handler() {}],
    ['a real Error', () => new Error('kaboom')],
  ];

  it.each(hostile)('expectOk_errCarrying_%s_throwsItsOwnMessage', (_l, make) => {
    expect(() => expectOk(err(make()))).toThrow(/^Expected Ok, got Err: \S/);
  });

  it.each(hostile)('expectErr_okCarrying_%s_throwsItsOwnMessage', (_l, make) => {
    expect(() => expectErr(ok(make()))).toThrow(/^Expected Err, got Ok: \S/);
  });

  it('expectOk_errCarryingARealError_namesItRatherThanEmptyBraces', () => {
    // The most common Err payload there is — anything a try/catch wrapper
    // produces — and `JSON.stringify` renders it as `{}`.
    expect(() => expectOk(err(new Error('kaboom')))).toThrow(
      'Expected Ok, got Err: Error: kaboom',
    );
  });

  it('expectOk_errCarryingACircularObject_keepsTheReadablePart', () => {
    const node: Record<string, unknown> = { type: 'not_found' };
    node.self = node;

    expect(() => expectOk(err(node))).toThrow(/not_found/);
  });

  it('expectOk_stillReturnsTheValueWhenThePayloadIsHostile', () => {
    // The rendering change must not reach the success path — nothing is
    // rendered when the assertion holds.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(expectOk(ok(circular))).toBe(circular);
  });
});

describe('root barrel surface', () => {
  // §5.9 lists `expectOk` / `expectErr` in the Assertions group — the mirror of
  // error.spec.ts's negative surface check, locking the two symbols on `.`.
  it('exports expectOk and expectErr', async () => {
    const surface = await import('../../src/index');

    expect(Object.keys(surface)).toContain('expectOk');
    expect(Object.keys(surface)).toContain('expectErr');
  });
});
