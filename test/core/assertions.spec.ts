import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineError, expectErr, expectOk, ok, err } from '../../src/index';
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

  it('throws with the prettified error on Err', () => {
    // This test previously asserted `JSON.stringify(error)` verbatim. #67 is
    // precisely the decision to stop doing that for a §3-shaped payload, so the
    // expectation moves with it — a non-typed payload still round-trips through
    // `JSON.stringify` unchanged, which the case above and the group at the
    // bottom of this file both pin.
    const error = { type: 'not_found', message: 'User not found' };
    expect(() => expectOk(err(error))).toThrow(
      'Expected Ok, got Err:\n  ✖ not_found: User not found',
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
    [
      // A membrane revokes on teardown and the `Err` that captured one outlives
      // it. Reading its prototype throws, and `renderPayload` reads the
      // prototype *before* its own `try` — so this threw the proxy's TypeError
      // in place of the diagnostic, one trap over from the `get` trap #67 fixed.
      'a revoked Proxy',
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
    [
      'a Proxy whose getPrototypeOf throws',
      () =>
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error('no prototype for you');
            },
          },
        ),
    ],
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

describe('expectOk / expectErr — typed errors read as prose (#67)', () => {
  // The motivation is one sentence: a wrong-branch failure should be
  // diagnosable from the test output, without going back to add a console.log.
  // That means the `✖ type: message` summary *and* the payload — `details` is
  // exactly the thing the console.log would have printed.
  const notFound = defineError(
    'not_found',
    (d: { id: string }) => `No user ${d.id}`,
  );
  const forbidden = defineError('forbidden', 'Not permitted');

  it('expectOk_errCarryingATypedError_showsTheLineAndTheDetails', () => {
    expect(() => expectOk(err(notFound({ id: 'u1' })))).toThrow(
      'Expected Ok, got Err:\n' +
        '  ✖ not_found: No user u1\n' +
        '    details: {"id":"u1"}',
    );
  });

  it('expectOk_errCarryingAPayloadlessVariant_staysOneLine', () => {
    expect(() => expectOk(err(forbidden()))).toThrow(
      'Expected Ok, got Err:\n  ✖ forbidden: Not permitted',
    );
  });

  it('expectOk_errCarryingAccumulatedErrors_listsThemAll', () => {
    // The `combineWithAllErrors` shape. Reading this as one line of JSON was
    // the case that motivated handling the array at all.
    expect(() =>
      expectOk(err([notFound({ id: 'u1' }), forbidden()])),
    ).toThrow(
      'Expected Ok, got Err:\n' +
        '  ✖ not_found: No user u1\n' +
        '    details: {"id":"u1"}\n' +
        '  ✖ forbidden: Not permitted',
    );
  });

  it('expectErr_okCarryingATypedError_prettifiesSymmetrically', () => {
    // Unusual, but the rule is one rule: the renderer does not ask which half
    // it is on. An asymmetry here would be a second thing to remember for no
    // gain.
    expect(() => expectErr(ok(notFound({ id: 'u1' })))).toThrow(
      'Expected Err, got Ok:\n' +
        '  ✖ not_found: No user u1\n' +
        '    details: {"id":"u1"}',
    );
  });

  it('expectOk_errCarryingANonTypedError_isUnchanged', () => {
    // The guardrail on the whole change: only §3-shaped payloads move. If this
    // ever goes multi-line, the change stopped being additive.
    expect(() => expectOk(err('boom'))).toThrow('Expected Ok, got Err: "boom"');
    expect(() => expectOk(err({ id: 'u1' }))).toThrow(
      'Expected Ok, got Err: {"id":"u1"}',
    );
  });

  it('expectOk_errCarryingATypedErrorWithACause_namesTheUnderlyingError', () => {
    // `cause` usually holds the original throw, and `JSON.stringify` renders a
    // real Error as `{}` — so the one field that answers "why" was invisible.
    const wrapped = {
      type: 'db_failed',
      message: 'Query failed',
      cause: new TypeError('conn reset'),
    };

    expect(() => expectOk(err(wrapped))).toThrow(
      'Expected Ok, got Err:\n' +
        '  ✖ db_failed: Query failed\n' +
        '    cause: TypeError: conn reset',
    );
  });

  it('expectOk_stillReturnsTheValueForATypedErrorShapedOk', () => {
    // Nothing is rendered when the assertion holds — the dispatch must not
    // reach the success path.
    const value = notFound({ id: 'u1' });

    expect(expectOk(ok(value))).toBe(value);
  });
});
