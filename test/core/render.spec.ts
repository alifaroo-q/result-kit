import { describe, expect, it } from 'vitest';

import { prettifyErrors } from '../../src/core/format';
import { renderDiagnostic, renderPayload } from '../../src/core/render';

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

  it('renderPayload_proxyThatThrowsOnEveryRead_doesNotEscapeTheModule', () => {
    // The `catch` calls `describe`, and `describe`'s last-resort
    // `Object.prototype.toString` reads `Symbol.toStringTag` — through the
    // `get` trap. So the handler that exists to stop a serializer crash was
    // itself the crash. Reached via `renderDiagnostic` first; pinned here too
    // because it is `renderPayload`'s own "never throws" invariant that broke.
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error('nope');
        },
      },
    );

    expect(() => renderPayload(exploding)).not.toThrow();
    expect(renderPayload(exploding)).toBe('[unrenderable object]');
  });

  it('renderPayload_doesNotMutateItsInput', () => {
    const value = { type: 'x', nested: { id: 1n } };
    const snapshot = { type: 'x', nested: { id: 1n } };

    renderPayload(value);

    expect(value).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// renderDiagnostic — the §3-aware layer (#67)
// ---------------------------------------------------------------------------

/**
 * `renderDiagnostic` adds one thing to `renderPayload`: a `TypedError` reads as
 * a `✖ type: message` block instead of a line of JSON. Everything it does not
 * recognise must fall through **byte-identically**, which is what keeps the
 * change additive rather than a rewording of every failure message in the
 * package. That fallthrough is the first group below and it is the important
 * one.
 */

describe('renderDiagnostic — fallthrough is byte-identical', () => {
  const notAnError: [label: string, value: unknown][] = [
    ['a string', 'boom'],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { id: 'u1' }],
    ['a real Error', new Error('kaboom')],
    ['a BigInt', 10n],
    ['a symbol', Symbol('session')],
    ['an array of plain objects', [{ a: 1 }, { b: 2 }]],
    // `type` is a string but `message` is missing — not a TypedError per §3.
    ['a tag-only object', { type: 'not_found' }],
    // `message` is present but not a string.
    ['a bad-message object', { type: 'not_found', message: 404 }],
    // §3 requires `details` to be a non-null, non-array object when present.
    ['a typed error with array details', { type: 'x', message: 'm', details: [1] }],
    // Mixed arrays are not the accumulation shape, so they stay JSON.
    ['a mixed array', [{ type: 'x', message: 'm' }, 'boom']],
  ];

  it.each(notAnError)(
    'renderDiagnostic_%s_matchesRenderPayloadExactly',
    (_l, value) => {
      expect(renderDiagnostic('P', value)).toBe(`P: ${renderPayload(value)}`);
    },
  );

  it('renderDiagnostic_emptyArray_doesNotRenderAnEmptyBlock', () => {
    // `[]` vacuously satisfies "every element is a TypedError", and
    // `prettifyErrors([])` is `''` by design — so without the length guard this
    // is the string `P:` and nothing else. `[]` says strictly more.
    expect(renderDiagnostic('P', [])).toBe('P: []');
  });
});

describe('renderDiagnostic — typed errors', () => {
  it('renderDiagnostic_typedErrorWithDetails_showsTheLineAndThePayload', () => {
    const error = {
      type: 'not_found',
      message: 'No user u1',
      details: { id: 'u1' },
    };

    expect(renderDiagnostic('Expected Ok, got Err', error)).toBe(
      'Expected Ok, got Err:\n' +
        '  ✖ not_found: No user u1\n' +
        '    details: {"id":"u1"}',
    );
  });

  it('renderDiagnostic_typedErrorWithoutDetails_staysOneLine', () => {
    // A no-payload variant must not grow an empty `details:` line.
    expect(
      renderDiagnostic('P', { type: 'forbidden', message: 'Access denied' }),
    ).toBe('P:\n  ✖ forbidden: Access denied');
  });

  it('renderDiagnostic_typedErrorWithCause_namesTheUnderlyingError', () => {
    // `cause` is the field that answers "why", and it usually holds a real
    // Error — which `JSON.stringify` renders as `{}`. `renderPayload` is what
    // stops that here.
    const error = {
      type: 'db_failed',
      message: 'Query failed',
      cause: new TypeError('conn reset'),
    };

    expect(renderDiagnostic('P', error)).toBe(
      'P:\n  ✖ db_failed: Query failed\n    cause: TypeError: conn reset',
    );
  });

  it('renderDiagnostic_typedErrorWithHostileDetails_stillRenders', () => {
    const details: Record<string, unknown> = { id: 'u1' };
    details.self = details;

    const out = renderDiagnostic('P', {
      type: 'not_found',
      message: 'No user u1',
      details,
    });

    expect(out).toContain('✖ not_found: No user u1');
    expect(out).toContain('[Circular]');
  });

  it('renderDiagnostic_typedErrorArray_rendersOneBlockEach', () => {
    // The `combineWithAllErrors` shape (§5.4) — the whole accumulation story
    // arrives as a flat array, and this is what a failing test of one looks
    // like.
    const errors = [
      { type: 'not_found', message: 'No user u1', details: { id: 'u1' } },
      { type: 'forbidden', message: 'Not permitted' },
    ];

    expect(renderDiagnostic('Expected Ok, got Err', errors)).toBe(
      'Expected Ok, got Err:\n' +
        '  ✖ not_found: No user u1\n' +
        '    details: {"id":"u1"}\n' +
        '  ✖ forbidden: Not permitted',
    );
  });

  it('renderDiagnostic_typedErrorLine_isPrettifyErrorsOutput', () => {
    // The `✖` form is defined once, in §3.4. If `prettifyErrors` changes, this
    // message changes with it — that is the point of delegating rather than
    // reimplementing the line here.
    const error = { type: 'not_found', message: 'No user u1' };

    expect(renderDiagnostic('P', error)).toContain(prettifyErrors([error]));
  });
});

describe('renderDiagnostic — never throws', () => {
  // The dispatch reads `type`, `message`, `details` and `cause` *before*
  // `renderPayload`'s own try/catch is reached, so it needs its own. A
  // diagnostic that crashes instead of diagnosing is the failure this whole
  // module exists to prevent.
  const hostile: [label: string, make: () => unknown][] = [
    [
      'a throwing `type` getter',
      () => ({
        get type(): string {
          throw new Error('nope');
        },
        message: 'm',
      }),
    ],
    [
      'a throwing `details` getter',
      () => ({
        type: 'x',
        message: 'm',
        get details(): unknown {
          throw new Error('nope');
        },
      }),
    ],
    [
      'a throwing `cause` getter',
      () => ({
        type: 'x',
        message: 'm',
        get cause(): unknown {
          throw new Error('nope');
        },
      }),
    ],
    [
      'a Proxy that explodes on every read',
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error('nope');
            },
          },
        ),
    ],
  ];

  it.each(hostile)('renderDiagnostic_%s_returnsAStringAnyway', (_l, make) => {
    const value = make();

    expect(() => renderDiagnostic('P', value)).not.toThrow();
    expect(renderDiagnostic('P', value)).toMatch(/^P: \S/);
  });
});
