import { describe, expect, it } from 'vitest';

import { isTypedError } from '../../src/core/error';
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
// Broken state — values whose *prototype* refuses to be read
// ---------------------------------------------------------------------------

/**
 * The `get`-trap hole was closed inside `describe`. This is the same hole one
 * trap over, and on the route *into* it: `isRenderableAsJson` asks
 * `value instanceof Error`, `instanceof` runs the `getPrototypeOf` trap, and
 * `renderPayload` calls it on its **first line** — before its own `try` exists.
 * So the function whose entire contract is "never throws" threw, and every
 * caller above it went with it: `renderDiagnostic`, `expectOk` / `expectErr`,
 * and the matchers' own non-`Result` guard.
 *
 * A revoked `Proxy` is the reachable form. Membranes and scoped-lifetime
 * wrappers revoke on teardown, and an `Err` that captured one outlives it —
 * which is precisely the moment someone runs an assertion to find out why.
 */
describe('renderPayload — values that refuse to be inspected', () => {
  it('renderPayload_proxyWhoseGetPrototypeOfThrows_doesNotEscapeTheModule', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('no prototype for you');
        },
      },
    );

    expect(() => renderPayload(hostile)).not.toThrow();
    expect(renderPayload(hostile)).toBe('[unrenderable object]');
  });

  it('renderPayload_revokedProxy_doesNotEscapeTheModule', () => {
    const { proxy, revoke } = Proxy.revocable({ type: 'not_found' }, {});
    revoke();

    expect(() => renderPayload(proxy)).not.toThrow();
    expect(renderPayload(proxy)).toBe('[unrenderable object]');
  });

  it('renderPayload_revokedFunctionProxy_saysFunctionRatherThanObject', () => {
    // `typeof` is the one thing no trap intercepts, which is what keeps the two
    // unrenderable cases distinguishable from each other.
    const { proxy, revoke } = Proxy.revocable(function handler() {}, {});
    revoke();

    expect(renderPayload(proxy)).toBe('[unrenderable function]');
  });

  it('renderPayload_nestedProxyWhoseGetPrototypeOfThrows_keepsTheSurroundingStructure', () => {
    // The nested route reaches `isRenderableAsJson` a second time, from inside
    // the replacer, and that is where the guard earns its keep: the hostile
    // leaf is named in place and the rest of the payload still reaches the
    // caller. Without it the throw would cost the whole object.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('no prototype for you');
        },
      },
    );

    expect(renderPayload({ type: 'io_failed', cause: hostile })).toBe(
      '{"type":"io_failed","cause":"[unrenderable object]"}',
    );
  });

  it('renderPayload_nestedRevokedProxy_fallsBackWholesaleWithoutThrowing', () => {
    // Measured, then pinned as a limit. A revoked Proxy refuses the `get` trap
    // too, and `stringify` reads `.toJSON` off a nested value *before* it calls
    // the replacer — so the throw happens one step above where the guard could
    // catch it, and the surrounding structure is lost with it. Naming only that
    // leaf would mean pre-walking the graph ourselves, which is the byte-identical
    // `JSON.stringify` guarantee gone. The invariant that matters holds: a
    // string comes back rather than the proxy's TypeError.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(renderPayload({ type: 'io_failed', cause: proxy })).toBe(
      '[object Object]',
    );
  });
});

// ---------------------------------------------------------------------------
// Broken state — the cycle check when a `toJSON` supplies the holder
// ---------------------------------------------------------------------------

/**
 * The ancestor path is unwound by matching the replacer's holder (`this`)
 * against the top of the stack. A `toJSON` returns a **fresh** object, and
 * `JSON.stringify` makes the replacer's return value the holder for that node's
 * children — so the holder was never on the stack, and the `while` popped the
 * *entire* path away. Every ancestor was forgotten at that point, so a cycle
 * running back through a `toJSON` was never detected: `stringify` recursed
 * until the stack blew, the `RangeError` landed in the outer `catch`, and the
 * whole payload collapsed to `[object Object]` — the exact
 * bail-to-nothing outcome the replacer exists to avoid.
 *
 * The module's own comment claimed the opposite: that tracking the *original*
 * graph rather than `raw` is what catches a `toJSON` returning a fresh object
 * each call. Tracking the original was necessary but not sufficient — the
 * *holder* had to be tracked alongside it.
 */
describe('renderPayload — cycles that run through a toJSON', () => {
  it('renderPayload_cycleThroughAToJson_isCalledCircularRatherThanCollapsing', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.child = { toJSON: (): unknown => ({ back: node }) };

    expect(renderPayload(node)).toBe(
      '{"name":"a","child":{"back":"[Circular]"}}',
    );
  });

  it('renderPayload_objectWhoseToJsonReturnsItself_isCalledCircular', () => {
    const node: Record<string, unknown> = {};
    node.toJSON = (): unknown => ({ inner: node });

    expect(renderPayload(node)).toBe('{"inner":"[Circular]"}');
  });

  it('renderPayload_diamondUnderAToJson_isNotCalledCircular', () => {
    // The mirror, and the reason the fix is holder-tracking rather than a
    // second `WeakSet`: buying cycle detection by calling a repeat a cycle is
    // the bug this module already fixed once.
    const shared = { id: 'u1' };
    const holder = { toJSON: (): unknown => ({ a: shared, b: shared }) };

    expect(renderPayload(holder)).toBe('{"a":{"id":"u1"},"b":{"id":"u1"}}');
  });

  it('renderPayload_toJsonSiblingFollowedByACycle_stillFindsTheCycle', () => {
    // The regression in its quietest form: the `toJSON` sibling is walked
    // first, clearing the path, and the cycle that follows is then invisible.
    const node: Record<string, unknown> = { at: new Date(0) };
    node.self = node;

    expect(renderPayload(node)).toBe(
      '{"at":"1970-01-01T00:00:00.000Z","self":"[Circular]"}',
    );
  });
});

// ---------------------------------------------------------------------------
// Validation — the single-line promise
// ---------------------------------------------------------------------------

/**
 * `renderPayload` documents itself as rendering "any value as a single-line
 * string", and two callers read that literally: `asResult`'s guard message is a
 * *sentence*, and `renderTypedError` builds a line-structured block whose
 * `details:` and `cause:` lines are one line each. `describe`'s `Error` arm
 * broke both — it interpolates `message`, which is caller-authored text that
 * routinely spans lines (a query, a stack fragment, an aggregated report).
 * `stack` was already left out for exactly this reason; a multi-line `message`
 * is the same hazard arriving through a different field.
 *
 * The backslash is escaped **first and deliberately**: escaping only the
 * newline would make `Error('a\nb')` and `Error('a\\nb')` — two distinguishable
 * payloads — render identically, trading one broken invariant for the other.
 * It also matches how this module already renders a plain string, where
 * `JSON.stringify` doubles a backslash too.
 */
describe('renderPayload — output is always one line', () => {
  it('renderPayload_errorWhoseMessageSpansLines_staysOnOneLine', () => {
    expect(renderPayload(new Error('first\nsecond'))).toBe(
      'Error: first\\nsecond',
    );
  });

  it('renderPayload_errorWithACarriageReturn_escapesItToo', () => {
    // A lone `\r` is worse than a newline in a terminal: it returns the cursor
    // and overwrites the line that was already printed.
    expect(renderPayload(new Error('a\rb'))).toBe('Error: a\\rb');
  });

  it('renderPayload_errorWithALiteralBackslashN_staysDistinctFromARealNewline', () => {
    expect(renderPayload(new Error('a\nb'))).not.toBe(
      renderPayload(new Error('a\\nb')),
    );
  });

  it('renderPayload_symbolWhoseDescriptionSpansLines_staysOnOneLine', () => {
    expect(renderPayload(Symbol('a\nb'))).toBe('Symbol(a\\nb)');
  });

  it('renderPayload_toStringTagSpanningLines_staysOnOneLine', () => {
    // `Object.prototype.toString` interpolates `Symbol.toStringTag`, which is
    // caller-controlled text like every other source of a newline here.
    const tagged = { [Symbol.toStringTag]: 'a\nb' };

    expect(renderPayload(tagged)).toBe('{}');
    expect(renderPayload(new Error('x'))).not.toContain('\n');
  });

  it('renderPayload_typedErrorCauseSpanningLines_doesNotBreakTheBlock', () => {
    // Why the promise is load-bearing rather than tidy: the `cause` line sits
    // inside a line-structured block, so a newline in the underlying error's
    // message forges an extra line in someone else's layout.
    const out = renderDiagnostic('P', {
      type: 'db_failed',
      message: 'Query failed',
      cause: new Error('syntax error\n  ✖ forged: line'),
    });

    expect(out.split('\n')).toHaveLength(3);
    expect(out).toBe(
      'P:\n' +
        '  ✖ db_failed: Query failed\n' +
        '    cause: Error: syntax error\\n  ✖ forged: line',
    );
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

  it('renderDiagnostic_revokedProxy_returnsAStringAnyway', () => {
    // The dispatch reads `type` (a revoked `get`) and the fallback reads the
    // prototype (a revoked `getPrototypeOf`) — two different traps, and both
    // had to be survived for this to come back at all.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(renderDiagnostic('P', proxy)).toBe('P: [unrenderable object]');
  });

  it('renderDiagnostic_typedErrorWhoseCauseIsARevokedProxy_stillShowsTheLine', () => {
    // The valuable half of the diagnostic must survive one hostile sub-payload.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(
      renderDiagnostic('P', { type: 'x', message: 'm', cause: proxy }),
    ).toBe('P:\n  ✖ x: m\n    cause: [unrenderable object]');
  });
});

// ---------------------------------------------------------------------------
// renderDiagnostic — the guard and the renderer must agree
// ---------------------------------------------------------------------------

/**
 * `isTypedError` is the *only* thing deciding whether a payload becomes a block
 * or a line of JSON, so the two must not disagree: a value the guard accepts has
 * to render as a block, and one it rejects has to fall through byte-identically
 * to {@link renderPayload}. Both halves are asserted from the guard's own answer
 * rather than from a hand-written expectation, so a future widening of
 * `isTypedError` (§10.9 already widened it once, to admit a callable) cannot
 * drift the two apart silently.
 */
describe('renderDiagnostic — agreement with isTypedError', () => {
  const shapes: [label: string, make: () => unknown][] = [
    ['a plain typed error', () => ({ type: 't', message: 'm' })],
    // §10.9's callable: a function carrying `type` and `message` is structurally
    // a TypedError and tsc assigns it, so the guard admits it — and the block
    // renderer must cope, since `renderPayload` would have said `[Function: f]`.
    [
      'a callable carrying type and message',
      () => Object.assign(function f() {}, { type: 't', message: 'm' }),
    ],
    // Inherited, not own — the guard reads properties, it does not ask for
    // `hasOwnProperty`, and `JSON.stringify` would have rendered `{}`.
    [
      'a typed error inheriting its fields',
      () => Object.create({ type: 't', message: 'm' }) as unknown,
    ],
    [
      'a null-prototype typed error',
      () =>
        Object.assign(Object.create(null) as object, {
          type: 't',
          message: 'm',
        }),
    ],
    [
      'a typed error behind getters',
      () => ({
        get type(): string {
          return 't';
        },
        get message(): string {
          return 'm';
        },
      }),
    ],
    // Rejected: `type` must be a primitive string, and a boxed String is not.
    ['a boxed-String type', () => ({ type: new String('t'), message: 'm' })],
    ['a Symbol.toPrimitive type', () => ({ type: { [Symbol.toPrimitive]: () => 't' }, message: 'm' })],
    ['a real Error, which carries a message but no type', () => new Error('m')],
  ];

  it.each(shapes)('renderDiagnostic_%s_rendersTheWayTheGuardClassifiesIt', (_l, make) => {
    const value = make();

    if (isTypedError(value)) {
      expect(renderDiagnostic('P', value)).toBe(`P:\n  ${prettifyErrors([value])}`);
    } else {
      expect(renderDiagnostic('P', value)).toBe(`P: ${renderPayload(value)}`);
    }
  });

  // `groupByType` accumulates into a null-prototype object precisely because a
  // `type` is ordinary domain vocabulary and may collide with `Object.prototype`
  // (format.spec.ts pins that). Nothing on this path indexes an object by
  // `type`, so the same names must simply pass through — asserted rather than
  // assumed, because "we don't index by it" is exactly the kind of claim that
  // stops being true.
  const pollutingTypes = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

  it.each(pollutingTypes)(
    'renderDiagnostic_typeNamed_%s_rendersItVerbatim',
    (type) => {
      expect(renderDiagnostic('P', { type, message: 'm' })).toBe(
        `P:\n  ✖ ${type}: m`,
      );
    },
  );

  it('renderDiagnostic_arrayOfPollutingTypes_rendersOneBlockEach', () => {
    const errors = pollutingTypes.map((type) => ({ type, message: 'm' }));

    expect(renderDiagnostic('P', errors)).toBe(
      `P:\n${pollutingTypes.map((t) => `  ✖ ${t}: m`).join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// renderDiagnostic — decided limits, pinned as limits
// ---------------------------------------------------------------------------

/**
 * Two shapes render identically to something distinguishable, and both are
 * pinned here as **decisions** rather than left to be rediscovered as bugs.
 */
describe('renderDiagnostic — known limits', () => {
  it('renderDiagnostic_detailsExplicitlyUndefined_readsTheSameAsAbsent', () => {
    // Correct, not a gap. §3 types `details?:`, and `defineError` omits the key
    // entirely when there is no payload — so `details: undefined` *means*
    // absent, and a presence check (`'details' in error`) would grow an empty
    // `details: undefined` line for a value that carries nothing.
    const absent = renderDiagnostic('P', { type: 't', message: 'm' });
    const explicit = renderDiagnostic('P', {
      type: 't',
      message: 'm',
      details: undefined,
    });

    expect(explicit).toBe(absent);
    expect(explicit).toBe('P:\n  ✖ t: m');
  });

  it('renderDiagnostic_messageContainingAForgedBlockLine_isIndistinguishable', () => {
    // Accepted, and unfixable here. The `✖ type: message` line is §3.4's
    // (`prettifyErrors`), and `message` is caller-authored text that may contain
    // anything — including a newline and another `✖` line. Escaping it would
    // mean this module rewriting §3.4's output, which is the one thing
    // delegating to `prettifyErrors` exists to avoid. The same reasoning
    // `format.ts` already gives for `message` not being a redaction boundary.
    const forged = renderDiagnostic('P', {
      type: 'a',
      message: 'm1\n  ✖ b: m2',
    });
    const genuine = renderDiagnostic('P', [
      { type: 'a', message: 'm1' },
      { type: 'b', message: 'm2' },
    ]);

    expect(forged).toBe(genuine);
  });

  it('renderDiagnostic_arrayWithOneUnreadableElement_fallsBackWholesale', () => {
    // Also accepted: `every(isTypedError)` is all-or-nothing, so one element
    // that throws on read costs the block for the whole array. The invariant
    // that matters — it comes back with a string rather than a crash — holds.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(renderDiagnostic('P', [{ type: 't', message: 'm' }, proxy])).toBe(
      'P: [object Array]',
    );
  });
});

// ---------------------------------------------------------------------------
// Scale — the ancestor path is O(depth) per node
// ---------------------------------------------------------------------------

describe('renderPayload / renderDiagnostic — at scale', () => {
  it('renderDiagnostic_tenThousandTypedErrors_rendersOneBlockEach', () => {
    // `combineWithAllErrors` over a large batch. The block branch is a `map`
    // plus a `join`, so this is linear — pinned so it stays that way.
    const errors = Array.from({ length: 10_000 }, (_, i) => ({
      type: `t${i}`,
      message: 'm',
    }));

    const out = renderDiagnostic('P', errors);

    expect(out.split('\n')).toHaveLength(10_001);
    expect(out.endsWith('  ✖ t9999: m')).toBe(true);
  });

  it('renderPayload_aThousandWideSiblings_areAllRendered', () => {
    // The unwind pops one frame per sibling, so a wide object is the shape that
    // exercises it hardest. Every sibling is a distinct object, and none of them
    // may be mistaken for a cycle.
    const wide = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, i) => [`k${i}`, { i }]),
    );

    expect(renderPayload(wide)).toBe(JSON.stringify(wide));
  });

  it('renderPayload_aVeryLongString_isNotTruncated', () => {
    // No truncation is promised anywhere, so none may quietly appear.
    const huge = 'x'.repeat(100_000);

    expect(renderPayload(huge)).toBe(JSON.stringify(huge));
  });
});
