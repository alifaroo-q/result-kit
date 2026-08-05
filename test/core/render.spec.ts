import { describe, expect, it } from 'vitest';

import { renderPayload } from '../../src/core/render';

/**
 * `renderPayload` is internal (not in §5.9's export list), but it is the single
 * point every thrown diagnostic in this package passes through, so it is tested
 * directly rather than only through its two callers. Two properties matter, and
 * they are what every test below is an instance of:
 *
 *   1. it never throws, whatever it is handed;
 *   2. it never renders two distinguishable payloads as the same string.
 */

const circular = (): Record<string, unknown> => {
  const node: Record<string, unknown> = { type: 'not_found' };
  node.self = node;
  return node;
};

// ---------------------------------------------------------------------------
// Happy path — JSON-safe input must be byte-identical to JSON.stringify
// ---------------------------------------------------------------------------

describe('renderPayload — JSON-safe input', () => {
  // This is the whole reason the change is a bug fix and not a message change:
  // every payload a caller could already read renders exactly as before.
  const jsonSafe: [label: string, value: unknown][] = [
    ['a string', 'boom'],
    ['a number', 42],
    ['a negative number', -1],
    ['zero', 0],
    ['true', true],
    ['false', false],
    ['null', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['a typed-error shape', { type: 'not_found', message: 'User not found' }],
    ['a nested object', { user: { id: 'u1', tags: ['a', 'b'] } }],
    ['an array of objects', [{ a: 1 }, { b: 2 }]],
    ['a string needing escapes', 'he said "hi"\n\tbye'],
    ['a unicode string', '日本語 🎉 café'],
  ];

  it.each(jsonSafe)(
    'renderPayload_%s_matchesJsonStringifyExactly',
    (_label, value) => {
      expect(renderPayload(value)).toBe(JSON.stringify(value));
    },
  );
});

// ---------------------------------------------------------------------------
// Broken state — the shapes JSON.stringify throws on
// ---------------------------------------------------------------------------

describe('renderPayload — input JSON.stringify throws on', () => {
  // Each of these previously escaped as a raw TypeError, replacing the caller's
  // diagnostic with an unrelated serializer crash.
  const throwsUnderStringify: [label: string, make: () => unknown][] = [
    ['a circular object', circular],
    ['a BigInt', () => 10n],
    ['a nested BigInt', () => ({ id: 10n })],
    ['a deeply nested BigInt', () => ({ a: { b: { c: 1n } } })],
    ['a BigInt in an array', () => [1n, 2n]],
    [
      'an object with a throwing toJSON',
      () => ({
        toJSON() {
          throw new Error('nope');
        },
      }),
    ],
    [
      'an object with a throwing getter',
      () => ({
        get boom() {
          throw new Error('getter exploded');
        },
      }),
    ],
    [
      'a Proxy that throws on read',
      () =>
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('proxy exploded');
            },
          },
        ),
    ],
  ];

  it.each(throwsUnderStringify)(
    'renderPayload_%s_returnsAStringRatherThanThrowing',
    (_label, make) => {
      const rendered = renderPayload(make());

      expect(typeof rendered).toBe('string');
      expect(rendered).not.toBe('');
    },
  );

  it('renderPayload_circularObject_keepsTheSurroundingStructure', () => {
    // The point of resolving the cycle in a replacer rather than bailing to a
    // describe(): the useful part of the payload still reaches the caller. A
    // fallback-only implementation would render `[object Object]` and pass the
    // "does not throw" test above just as happily.
    const rendered = renderPayload(circular());

    expect(rendered).toContain('not_found');
    expect(rendered).toContain('[Circular]');
  });

  it('renderPayload_nestedBigInt_keepsTheSurroundingStructure', () => {
    expect(renderPayload({ id: 10n, name: 'Ada' })).toBe(
      '{"id":"10n","name":"Ada"}',
    );
  });

  it('renderPayload_repeatedButAcyclicReference_isNotCalledCircular', () => {
    // The trap in a WeakSet-based cycle check: a diamond is not a cycle. Marking
    // the second visit `[Circular]` would silently drop real data from the
    // message, and `JSON.stringify` itself renders both copies.
    const shared = { id: 'u1' };

    expect(renderPayload({ a: shared, b: shared })).toBe(
      JSON.stringify({ a: shared, b: shared }),
    );
  });
});

// ---------------------------------------------------------------------------
// Validation — the shapes JSON.stringify silently elides
// ---------------------------------------------------------------------------

describe('renderPayload — input JSON.stringify elides', () => {
  it('renderPayload_undefined_saysUndefinedUnquoted', () => {
    // Unquoted, because this is the wording the message already had and the
    // top-level route exists to preserve it.
    expect(renderPayload(undefined)).toBe('undefined');
  });

  it('renderPayload_symbol_namesTheSymbol', () => {
    expect(renderPayload(Symbol('session'))).toBe('Symbol(session)');
  });

  it('renderPayload_function_namesTheFunction', () => {
    expect(renderPayload(function handler() {})).toBe('[Function: handler]');
  });

  it('renderPayload_anonymousFunction_saysSo', () => {
    // An array element gets no inferred name, unlike a `const` binding.
    const anonymous = [(): void => {}][0]!;

    expect(renderPayload(anonymous)).toBe('[Function: anonymous]');
  });

  it('renderPayload_bigInt_keepsTheNSuffix', () => {
    // Without the suffix `10n` and `10` render identically — and telling them
    // apart is the entire reason the caller reached for a BigInt.
    expect(renderPayload(10n)).toBe('10n');
    expect(renderPayload(10n)).not.toBe(renderPayload(10));
  });

  const indistinguishableBefore: [label: string, value: unknown][] = [
    ['undefined', undefined],
    ['a symbol', Symbol('s')],
    ['a function', function named() {}],
    ['a BigInt', 1n],
  ];

  it('renderPayload_theValuesStringifyDroppedAreAllDistinguishable', () => {
    // The regression this pins: every one of these rendered as the literal text
    // `undefined`, so four distinct causes produced one identical message.
    const rendered = indistinguishableBefore.map(([, v]) => renderPayload(v));

    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

// ---------------------------------------------------------------------------
// Errors — the most common Err payload of all
// ---------------------------------------------------------------------------

describe('renderPayload — Error payloads', () => {
  it('renderPayload_error_carriesNameAndMessage', () => {
    // `JSON.stringify(new Error('kaboom'))` is `'{}'`: name, message and stack
    // are all non-enumerable, so the payload rendered as nothing at all.
    expect(renderPayload(new Error('kaboom'))).toBe('Error: kaboom');
  });

  it('renderPayload_errorSubclass_usesItsOwnName', () => {
    class NotFoundError extends Error {
      override name = 'NotFoundError';
    }

    expect(renderPayload(new NotFoundError('no user'))).toBe(
      'NotFoundError: no user',
    );
  });

  it('renderPayload_typeError_usesItsOwnName', () => {
    expect(renderPayload(new TypeError('bad type'))).toBe(
      'TypeError: bad type',
    );
  });

  it('renderPayload_nestedError_isDescribedInPlace', () => {
    expect(renderPayload({ type: 'io_failed', cause: new Error('EACCES') })).toBe(
      '{"type":"io_failed","cause":"Error: EACCES"}',
    );
  });

  it('renderPayload_error_omitsTheStack', () => {
    // A multi-line stack would bury the one line the caller is reading.
    expect(renderPayload(new Error('kaboom'))).not.toContain('\n');
  });

  it('renderPayload_errorWithEnumerableExtras_stillNamesTheMessage', () => {
    const enriched = Object.assign(new Error('kaboom'), { code: 'E_BOOM' });

    expect(renderPayload(enriched)).toBe('Error: kaboom');
  });
});

// ---------------------------------------------------------------------------
// Weird but reachable
// ---------------------------------------------------------------------------

describe('renderPayload — surprising input', () => {
  it('renderPayload_nullPrototypeObject_rendersItsKeys', () => {
    const bare = Object.assign(Object.create(null) as object, { type: 'x' });

    expect(renderPayload(bare)).toBe('{"type":"x"}');
  });

  it('renderPayload_date_keepsTheIsoString', () => {
    // `toJSON` is honoured, as it must be — `JSON.stringify` is still doing the
    // work for everything that is not a hazard.
    const at = new Date('2026-08-06T00:00:00.000Z');

    expect(renderPayload(at)).toBe('"2026-08-06T00:00:00.000Z"');
  });

  it('renderPayload_mapAndSet_doNotThrowEvenThoughJsonEmptiesThem', () => {
    // Documented, not endorsed: `JSON.stringify(new Set([1]))` is `{}`. This
    // pins the current honest-but-lossy rendering rather than claiming better.
    expect(renderPayload(new Set([1, 2]))).toBe('{}');
    expect(renderPayload(new Map([['a', 1]]))).toBe('{}');
  });

  it('renderPayload_deeplyNestedStructure_doesNotOverflow', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 500; i += 1) nested = { nested };

    expect(() => renderPayload(nested)).not.toThrow();
  });

  it('renderPayload_isPureAcrossRepeatedCalls', () => {
    // The WeakSet is per-call; a module-level one would make the second render
    // of the same object report `[Circular]` for a value that is not.
    const value = { a: { id: 1 } };

    expect(renderPayload(value)).toBe(renderPayload(value));
  });

  it('renderPayload_doesNotMutateItsInput', () => {
    const value = { type: 'x', nested: { id: 1n } };
    const snapshot = { type: 'x', nested: { id: 1n } };

    renderPayload(value);

    expect(value).toEqual(snapshot);
  });
});
