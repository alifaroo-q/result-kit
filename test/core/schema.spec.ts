import { describe, expect, expectTypeOf, it } from 'vitest';

import { fromSchema, fromSchemaAsync, isErr, isOk } from '../../src/index';
import type {
  FromSchemaOptions,
  Result,
  ValidationFailed,
  ValidationIssue,
} from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * The contract that fails silently at runtime here is `InferOutput`: a
 * `fromSchema` that resolved its output to `unknown` or `any` would behave
 * identically in every assertion below until a consumer dereferenced the value.
 * Only tsc separates them.
 */

/* -------------------------------------------------------------------------- *
 * Hand-built Standard Schema v1 fixtures
 * -------------------------------------------------------------------------- *
 *
 * Deliberately not Zod/Valibot. The spec is types-only and the whole point of
 * the vendored interface is that conformance is *structural*, so the fixtures
 * are the spec's own shape and nothing else — which also lets the hostile cases
 * below exist at all, since no real vendor ships them.
 */

type RawIssue = {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | { readonly key: PropertyKey })[]
    | undefined;
};

type StdResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly RawIssue[] };

interface Schema<Output> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StdResult<Output> | Promise<StdResult<Output>>;
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined;
  };
}

/**
 * A schema whose `validate` is whatever the test needs it to be.
 *
 * The parameter is deliberately `unknown`-returning and cast on the way in: the
 * misbehaving-vendor cases below return shapes the spec forbids, which is the
 * whole point of them, and they cannot be written against the honest type. The
 * cast is confined to this one line so no assertion below has to carry one.
 */
function schemaOf<Output>(
  validate: (value: unknown) => unknown,
  vendor = 'test-vendor',
): Schema<Output> {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate: validate as Schema<Output>['~standard']['validate'],
    },
  };
}

/** Succeeds with `value`, synchronously. */
const syncOk = <Output>(value: Output): Schema<Output> =>
  schemaOf<Output>(() => ({ value }));

/** Fails with `issues`, synchronously. */
const syncFail = <Output>(issues: readonly RawIssue[]): Schema<Output> =>
  schemaOf<Output>(() => ({ issues }));

/** Succeeds with `value`, asynchronously. */
const asyncOk = <Output>(value: Output): Schema<Output> =>
  schemaOf<Output>(async () => ({ value }));

/** Fails with `issues`, asynchronously. */
const asyncFail = <Output>(issues: readonly RawIssue[]): Schema<Output> =>
  schemaOf<Output>(async () => ({ issues }));

/** A realistic-enough sync string schema, for the inference assertions. */
const stringSchema = schemaOf<string>((value) =>
  typeof value === 'string'
    ? { value }
    : { issues: [{ message: 'expected string', path: [] }] },
);

/* -------------------------------------------------------------------------- *
 * The happy paths
 * -------------------------------------------------------------------------- */

describe('fromSchema', () => {
  it('lifts a successful validation into Ok', () => {
    const result = fromSchema(syncOk({ credit: 10 }))(null);

    expect(result).toStrictEqual({ ok: true, value: { credit: 10 } });
  });

  it('is lazy and reusable — one wrap, many calls', () => {
    const calls: unknown[] = [];
    const parse = fromSchema(
      schemaOf<string>((value) => {
        calls.push(value);
        return { value: String(value) };
      }),
    );

    expect(calls).toStrictEqual([]);
    parse('a');
    parse('b');
    expect(calls).toStrictEqual(['a', 'b']);
  });

  it('infers the output type from the schema, not `unknown`', () => {
    const result = fromSchema(stringSchema)('hi');

    expectTypeOf(result).toEqualTypeOf<Result<string, ValidationFailed>>();
  });

  it('routes issues into a single ValidationFailed', () => {
    const result = fromSchema(
      syncFail([{ message: 'too short', path: ['name'] }]),
    )(null);

    expect(result).toStrictEqual({
      ok: false,
      error: {
        type: 'validation_failed',
        message: 'Validation failed (1 issue)',
        details: { issues: [{ message: 'too short', path: ['name'] }] },
      },
    });
  });

  /**
   * ADR 0015 §1. A `TypedError[]` in `E` would force `matchType`, `isTypedError`
   * and `unwrapOrThrow` to special-case an array, and collide with §5.4's own
   * `Result<T[], E[]>`.
   */
  it('produces one error and not an array, however many issues there are', () => {
    const result = fromSchema(
      syncFail([
        { message: 'a', path: ['x'] },
        { message: 'b', path: ['y'] },
      ]),
    )(null);

    if (isOk(result)) throw new Error('expected Err');
    expect(Array.isArray(result.error)).toBe(false);
    expect(result.error.type).toBe('validation_failed');
    expect(result.error.details?.issues).toHaveLength(2);
    expectTypeOf(result.error).toEqualTypeOf<ValidationFailed>();
  });
});

/* -------------------------------------------------------------------------- *
 * ADR 0015 §3 — path normalization
 * -------------------------------------------------------------------------- */

describe('path normalization (ADR 0015 §3)', () => {
  const pathOf = (issue: RawIssue): readonly (string | number)[] => {
    const result = fromSchema(syncFail([issue]))(null);
    if (isOk(result)) throw new Error('expected Err');
    return result.error.details!.issues[0]!.path;
  };

  it('passes string and number segments through, keeping indices numeric', () => {
    expect(pathOf({ message: 'm', path: ['items', 0, 'name'] })).toStrictEqual([
      'items',
      0,
      'name',
    ]);
  });

  it('unwraps a PathSegment to its key', () => {
    expect(
      pathOf({ message: 'm', path: [{ key: 'user' }, { key: 2 }] }),
    ).toStrictEqual(['user', 2]);
  });

  it('handles a path that mixes both forms, which the spec permits', () => {
    expect(
      pathOf({ message: 'm', path: ['a', { key: 'b' }, 3] }),
    ).toStrictEqual(['a', 'b', 3]);
  });

  /**
   * The §2.1 collision in its sharpest form. `JSON.stringify` drops a symbol
   * SILENTLY, which is the disappearing-value class #67 closed three holes over;
   * coercion is the only option that keeps the round-trip true with no fourth
   * carve-out. Both spellings — bare and wrapped — must coerce.
   */
  it('coerces a symbol segment with String(), rather than letting JSON drop it', () => {
    expect(
      pathOf({ message: 'm', path: [Symbol('id'), { key: Symbol('inner') }] }),
    ).toStrictEqual(['Symbol(id)', 'Symbol(inner)']);
  });

  it('keeps a symbol-bearing path JSON round-trippable', () => {
    const result = fromSchema(syncFail([{ message: 'm', path: [Symbol('id')] }]))(
      null,
    );
    if (isOk(result)) throw new Error('expected Err');

    const roundTripped = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(roundTripped).toStrictEqual(result);
  });

  it('collapses an absent path to []', () => {
    expect(pathOf({ message: 'm' })).toStrictEqual([]);
  });

  it('collapses an explicitly-undefined path to []', () => {
    expect(pathOf({ message: 'm', path: undefined })).toStrictEqual([]);
  });

  it('leaves an already-empty path as []', () => {
    expect(pathOf({ message: 'm', path: [] })).toStrictEqual([]);
  });

  it('types the normalized path as string | number only', () => {
    expectTypeOf<ValidationIssue['path']>().toEqualTypeOf<
      readonly (string | number)[]
    >();
  });
});

/* -------------------------------------------------------------------------- *
 * ADR 0015 §6 — the message
 * -------------------------------------------------------------------------- */

describe('message (ADR 0015 §6)', () => {
  const messageFor = (count: number): string => {
    const issues = Array.from({ length: count }, (_, i) => ({
      message: `issue ${i}`,
    }));
    const result = fromSchema(syncFail(issues))(null);
    if (isOk(result)) throw new Error('expected Err');
    return result.error.message;
  };

  it('is singular at one issue', () => {
    expect(messageFor(1)).toBe('Validation failed (1 issue)');
  });

  it('is plural above one', () => {
    expect(messageFor(3)).toBe('Validation failed (3 issues)');
  });

  /** Never `Validation failed (0 issues)` — a sentence that reads as a bug. */
  it('drops the count clause entirely when there are no issues', () => {
    expect(messageFor(0)).toBe('Validation failed');
  });

  /**
   * §3.4's recorded trap: a message can carry payload before any formatter runs,
   * and no formatter can undo it. The count is an integer and cannot leak.
   */
  it('never interpolates vendor-authored issue text', () => {
    const secret = 'user@example.com';
    const result = fromSchema(
      syncFail([{ message: `expected email, received ${secret}` }]),
    )(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.message).toBe('Validation failed (1 issue)');
    expect(result.error.message).not.toContain(secret);
    // The vendor's own text is still reachable — just not in `message`.
    expect(result.error.details!.issues[0]!.message).toContain(secret);
  });
});

/* -------------------------------------------------------------------------- *
 * ADR 0015 §4, §5 — details and cause
 * -------------------------------------------------------------------------- */

describe('details and cause (ADR 0015 §4, §5)', () => {
  const zodish: readonly RawIssue[] = [
    // The shape Zod actually emits: spec'd fields plus vendor extras.
    {
      message: 'invalid',
      path: ['email'],
      ...{ code: 'invalid_string', expected: 'email', input: 'not-an-email' },
    },
  ];

  it('drops vendor extras from details, keeping only message and path', () => {
    const result = fromSchema(syncFail(zodish))(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]).toStrictEqual({
      message: 'invalid',
      path: ['email'],
    });
  });

  it('puts nothing but issues in details — not even vendor', () => {
    const result = fromSchema(syncFail([{ message: 'm' }]), )(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(Object.keys(result.error.details!)).toStrictEqual(['issues']);
  });

  /**
   * The default is the decision: an always-on `cause` retains Zod's rejected
   * `input` — PII and memory — inside a value people log by reflex.
   */
  it('omits cause by default, as a key and not merely as undefined', () => {
    const result = fromSchema(syncFail(zodish))(null);
    if (isOk(result)) throw new Error('expected Err');

    expect('cause' in result.error).toBe(false);
  });

  it('attaches the raw issue array, untouched, under includeCause', () => {
    const result = fromSchema(syncFail(zodish), { includeCause: true })(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.cause).toBe(zodish);
    expect(result.error.cause).toStrictEqual([
      {
        message: 'invalid',
        path: ['email'],
        code: 'invalid_string',
        expected: 'email',
        input: 'not-an-email',
      },
    ]);
  });

  it('attaches the raw array and not the whole FailureResult', () => {
    const result = fromSchema(syncFail(zodish), { includeCause: true })(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(Array.isArray(result.error.cause)).toBe(true);
  });

  /** `cause?: unknown` is already optional, so the flag never reaches the type. */
  it('does not change the return type when set', () => {
    const off = fromSchema(stringSchema)('x');
    const on = fromSchema(stringSchema, { includeCause: true })('x');

    expectTypeOf(on).toEqualTypeOf<typeof off>();
  });

  it('treats an explicit `includeCause: false` as off', () => {
    const result = fromSchema(syncFail(zodish), { includeCause: false })(null);
    if (isOk(result)) throw new Error('expected Err');

    expect('cause' in result.error).toBe(false);
  });

  /**
   * The division of labour §2.1 promises: `details` stays serializable no matter
   * what the vendor attached, and the unsafe half is quarantined in `cause`,
   * which the guarantee already carves out.
   */
  it('keeps details serializable even when the raw issues are not', () => {
    const cyclic: RawIssue & { self?: unknown } = { message: 'm', path: ['a'] };
    cyclic.self = cyclic;

    const result = fromSchema(syncFail([cyclic]), { includeCause: true })(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(() => JSON.stringify(result.error.details)).not.toThrow();
    expect(() => JSON.stringify(result.error.cause)).toThrow();
  });
});

/* -------------------------------------------------------------------------- *
 * ADR 0015 §7, §8 — the tag, and the empty issue list
 * -------------------------------------------------------------------------- */

describe('tag and empty issues (ADR 0015 §7, §8)', () => {
  it('uses the fixed literal tag', () => {
    expectTypeOf<ValidationFailed['type']>().toEqualTypeOf<'validation_failed'>();
  });

  it('offers no way to override the tag', () => {
    // @ts-expect-error — `type` is not a member of the options bag.
    fromSchema(stringSchema, { type: 'my_error' });
    // `includeCause` is deliberately the only member.
    expectTypeOf<keyof FromSchemaOptions>().toEqualTypeOf<'includeCause'>();
  });

  /** A vendor that said "failure" never becomes Ok. */
  it('keeps an empty issue list an Err', () => {
    const result = fromSchema(syncFail([]))(null);

    expect(isErr(result)).toBe(true);
    if (isOk(result)) throw new Error('expected Err');
    expect(result.error.details!.issues).toStrictEqual([]);
    expect(result.error.message).toBe('Validation failed');
  });
});

/* -------------------------------------------------------------------------- *
 * The sync/async split
 * -------------------------------------------------------------------------- */

describe('fromSchema throws on an async schema', () => {
  it('throws a TypeError rather than returning a promise typed as a Result', () => {
    const parse = fromSchema(asyncOk('x'));

    expect(() => parse(null)).toThrow(TypeError);
  });

  it('names fromSchemaAsync in the message, so the fix is in the error', () => {
    const parse = fromSchema(asyncOk('x'), );

    expect(() => parse(null)).toThrow(/fromSchemaAsync/);
  });

  it('names the vendor, so the offending schema is identifiable', () => {
    const parse = fromSchema(schemaOf<string>(async () => ({ value: 'x' }), 'valibot'));

    expect(() => parse(null)).toThrow(/valibot/);
  });

  it('throws on an async failure too, not only an async success', () => {
    const parse = fromSchema(asyncFail([{ message: 'm' }]));

    expect(() => parse(null)).toThrow(TypeError);
  });

  /**
   * The thrown TypeError must not be laundered into the Err channel: the whole
   * point is that it is loud. A silent `validation_failed` here would claim an
   * issue list that does not exist.
   */
  it('does not return an Err for an async schema', () => {
    const parse = fromSchema(asyncOk('x'));
    let returned: unknown = 'never assigned';

    try {
      returned = parse(null);
    } catch {
      /* expected */
    }
    expect(returned).toBe('never assigned');
  });
});

describe('fromSchemaAsync', () => {
  it('lifts an async success into Ok', async () => {
    const result = await fromSchemaAsync(asyncOk({ credit: 10 }))(null);

    expect(result).toStrictEqual({ ok: true, value: { credit: 10 } });
  });

  it('routes async issues into a ValidationFailed', async () => {
    const result = await fromSchemaAsync(
      asyncFail([{ message: 'too short', path: ['name'] }]),
    )(null);

    expect(result).toStrictEqual({
      ok: false,
      error: {
        type: 'validation_failed',
        message: 'Validation failed (1 issue)',
        details: { issues: [{ message: 'too short', path: ['name'] }] },
      },
    });
  });

  /**
   * The deliberate asymmetry: this direction costs a microtask, the other
   * cannot be served at all. It is why this is the safe default when the kind of
   * schema is not known statically.
   */
  it('accepts a synchronous schema as well', async () => {
    const result = await fromSchemaAsync(syncOk('x'))(null);

    expect(result).toStrictEqual({ ok: true, value: 'x' });
  });

  it('accepts a synchronous failure as well', async () => {
    const result = await fromSchemaAsync(syncFail([{ message: 'm' }]))(null);

    expect(isErr(result)).toBe(true);
  });

  it('returns a plain Promise<Result>, not a wrapper', async () => {
    const promise = fromSchemaAsync(stringSchema)('x');

    expect(promise).toBeInstanceOf(Promise);
    expectTypeOf(promise).toEqualTypeOf<
      Promise<Result<string, ValidationFailed>>
    >();
  });

  it('honours includeCause', async () => {
    const issues: readonly RawIssue[] = [{ message: 'm' }];
    const result = await fromSchemaAsync(asyncFail(issues), {
      includeCause: true,
    })(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.cause).toBe(issues);
  });

  it('is lazy and reusable', async () => {
    const calls: unknown[] = [];
    const parse = fromSchemaAsync(
      schemaOf<string>(async (value) => {
        calls.push(value);
        return { value: String(value) };
      }),
    );

    expect(calls).toStrictEqual([]);
    await parse('a');
    await parse('b');
    expect(calls).toStrictEqual(['a', 'b']);
  });
});

/* -------------------------------------------------------------------------- *
 * A thrown schema is not a validation failure
 * -------------------------------------------------------------------------- */

describe('a schema that crashes propagates', () => {
  it('lets a synchronous throw out of fromSchema', () => {
    const parse = fromSchema(
      schemaOf<string>(() => {
        throw new RangeError('schema bug');
      }),
    );

    expect(() => parse(null)).toThrow(RangeError);
  });

  it('lets a rejection out of fromSchemaAsync', async () => {
    const parse = fromSchemaAsync(
      schemaOf<string>(() => Promise.reject(new RangeError('schema bug'))),
    );

    await expect(parse(null)).rejects.toThrow(RangeError);
  });
});

/* -------------------------------------------------------------------------- *
 * §10.11's ordering lesson, applied here
 * -------------------------------------------------------------------------- */

describe('a settled outcome is recognised before a thenable one (§10.11)', () => {
  /**
   * §2's lesson on a second surface: a settled outcome carrying a `then` is
   * assimilated by a thenable-first check, and `fromSchema` would throw its
   * "use fromSchemaAsync" TypeError at a schema that is perfectly synchronous.
   * Goes red under the thenable-first ordering.
   */
  it('does not mistake a thenable success for an async schema', () => {
    const parse = fromSchema(
      schemaOf<string>(() => ({ value: 'x', then: () => {} })),
    );

    expect(parse(null)).toStrictEqual({ ok: true, value: 'x' });
  });

  it('does not mistake a thenable failure for an async schema', () => {
    const parse = fromSchema(
      schemaOf<string>(() => ({ issues: [{ message: 'm' }], then: () => {} })),
    );

    expect(isErr(parse(null))).toBe(true);
  });

  it('still awaits a genuine promise, which has neither value nor issues', () => {
    const parse = fromSchema(asyncOk('x'));

    expect(() => parse(null)).toThrow(/fromSchemaAsync/);
  });
});

/* -------------------------------------------------------------------------- *
 * Misbehaving vendors
 * -------------------------------------------------------------------------- */

describe('a misbehaving vendor never crashes the adapter', () => {
  it('throws a named TypeError when validate returns neither shape', () => {
    const parse = fromSchema(schemaOf<string>(() => ({})));

    expect(() => parse(null)).toThrow(TypeError);
    expect(() => parse(null)).toThrow(/neither a value nor an issue list/);
  });

  it('throws rather than silently succeeding when validate returns null', () => {
    const parse = fromSchema(schemaOf<string>(() => null));

    expect(() => parse(null)).toThrow(TypeError);
  });

  /**
   * `{ issues: null }` is neither spec'd shape. `ok(undefined)` would report a
   * success the vendor never claimed and an empty `validation_failed` would
   * claim an issue list that does not exist — both silent, so it throws.
   */
  it('throws on a non-array issues field rather than inventing an answer', () => {
    const parse = fromSchema(schemaOf<string>(() => ({ issues: null })));

    expect(() => parse(null)).toThrow(/neither a value nor an issue list/);
  });

  /**
   * The pair must agree on a malformed outcome. This went red while the sync
   * half decided the shape during its promise check and the async half never
   * did: `fromSchema` threw where `fromSchemaAsync` returned an Err with no
   * issues, for the same input.
   */
  it.each([
    ['a non-array issues field', { issues: null }],
    ['neither field', {}],
    ['a bare string', 'nope'],
  ])('rejects %s in fromSchemaAsync exactly as fromSchema does', async (_, bad) => {
    const parseSync = fromSchema(schemaOf<string>(() => bad));
    const parseAsync = fromSchemaAsync(schemaOf<string>(async () => bad));

    expect(() => parseSync(null)).toThrow(/neither a value nor an issue list/);
    await expect(parseAsync(null)).rejects.toThrow(
      /neither a value nor an issue list/,
    );
  });

  it('reads ~standard once, at wrap time, not per call', () => {
    let reads = 0;
    const schema = {
      get '~standard'() {
        reads += 1;
        return {
          version: 1 as const,
          vendor: 'v',
          validate: () => ({ value: 'x' }),
        };
      },
    } as unknown as Schema<string>;

    const parse = fromSchema(schema);
    parse(null);
    parse(null);
    expect(reads).toBe(1);
  });
});

/* -------------------------------------------------------------------------- *
 * The §2.1 round-trip, end to end
 * -------------------------------------------------------------------------- */

describe('the §2.1 round trip holds for the whole payload', () => {
  it('survives JSON.stringify/parse with every path form present', () => {
    const result = fromSchema(
      syncFail([
        { message: 'root' },
        { message: 'nested', path: ['a', { key: 'b' }, 3] },
        { message: 'symbolic', path: [Symbol('id')] },
      ]),
    )(null);

    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('is a plain object with no prototype surprises', () => {
    const result = fromSchema(syncFail([{ message: 'm' }]))(null);
    if (isOk(result)) throw new Error('expected Err');

    expect(Object.getPrototypeOf(result.error)).toBe(Object.prototype);
  });
});

/* -------------------------------------------------------------------------- *
 * Adversarial pass — every case below is a defect that shipped and was fixed
 * -------------------------------------------------------------------------- *
 *
 * Found by a review briefed to REFUTE rather than confirm, which is the pass
 * §10.11 credits for the four defects it corrected. None was caught by the
 * tests above, and none by reading the code.
 */

describe('path normalization is total (ADR 0015 §3, the claim taken literally)', () => {
  const pathOf = (path: unknown): readonly (string | number)[] => {
    const result = fromSchema(
      schemaOf<string>(() => ({ issues: [{ message: 'm', path }] })),
    )(null);
    if (isOk(result)) throw new Error('expected Err');
    return result.error.details!.issues[0]!.path;
  };

  const errFor = (path: unknown) => {
    const result = fromSchema(
      schemaOf<string>(() => ({ issues: [{ message: 'm', path }] })),
    )(null);
    if (isOk(result)) throw new Error('expected Err');
    return result;
  };

  /**
   * §3 argued the `symbol` case and concluded coercion "keeps §2.1 true
   * UNCONDITIONALLY, with no fourth carve-out". Handling only `symbol` made
   * that false: Valibot's path items include a Map key (any value at all) and a
   * Set key (`null`).
   */
  it('coerces a BigInt key rather than letting JSON.stringify throw', () => {
    expect(pathOf([10n])).toStrictEqual(['10']);
    expect(() => JSON.stringify(errFor([10n]))).not.toThrow();
  });

  it('does not retain an object key by identity', () => {
    const key = { secret: 'pii' };

    expect(pathOf([{ key }])).toStrictEqual(['[object Object]']);
    expect(pathOf([{ key }])[0]).not.toBe(key);
  });

  /** An object key carrying a cycle must not make the whole Result unserializable. */
  it('survives a cyclic object key', () => {
    const key: Record<string, unknown> = { a: 1 };
    key.self = key;

    expect(() => JSON.stringify(errFor([{ key }]))).not.toThrow();
  });

  it('coerces a null key, which is how Valibot spells a Set member', () => {
    expect(pathOf([{ key: null }])).toStrictEqual(['null']);
  });

  it('coerces a bare null segment', () => {
    expect(pathOf([null])).toStrictEqual(['null']);
  });

  it('coerces an undefined key', () => {
    expect(pathOf([{}])).toStrictEqual(['undefined']);
  });

  /** `JSON.stringify` writes NaN and ±Infinity as `null`, breaking the round trip. */
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('stringifies a non-finite %s key so the round trip holds', (label, key) => {
    expect(pathOf([key])).toStrictEqual([label]);

    const error = errFor([key]);
    expect(JSON.parse(JSON.stringify(error))).toStrictEqual(error);
  });

  /** `JSON.stringify(-0)` is `"0"`, so -0 would not survive the round trip. */
  it('normalizes -0 to 0', () => {
    expect(Object.is(pathOf([-0])[0], 0)).toBe(true);

    const error = errFor([-0]);
    expect(JSON.parse(JSON.stringify(error))).toStrictEqual(error);
  });

  it('keeps ordinary numeric indices as numbers', () => {
    expect(pathOf([0, 1, 42])).toStrictEqual([0, 1, 42]);
  });

  it('answers a key whose toString throws, rather than throwing', () => {
    const key = {
      toString() {
        throw new Error('hostile');
      },
    };

    expect(pathOf([{ key }])).toStrictEqual(['[unrenderable key]']);
  });

  it('answers a key that is a revoked Proxy, rather than throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(pathOf([{ key: proxy }])).toStrictEqual(['[unrenderable key]']);
  });

  it('tolerates a segment whose key getter throws', () => {
    const segment = {
      get key(): unknown {
        throw new Error('hostile');
      },
    };

    expect(pathOf([segment])).toStrictEqual(['undefined']);
  });

  it('tolerates a segment that is a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(pathOf([proxy])).toStrictEqual(['undefined']);
  });

  /**
   * A dotted string is the most plausible non-conformant spelling — §3 spends a
   * paragraph rejecting it as an OUTPUT, which is exactly why it arrives as an
   * input. Iterating it yielded one segment per character: a confidently wrong
   * path rather than a missing one.
   */
  it('collapses a dotted-string path to [] instead of splitting it per character', () => {
    expect(pathOf('user.email')).toStrictEqual([]);
  });

  it.each([
    ['a number', 123],
    ['an array-like object', { length: 1, 0: 'a' }],
    ['a Set', new Set(['a'])],
    ['null', null],
  ])('collapses %s path to [] instead of throwing', (_, path) => {
    expect(pathOf(path)).toStrictEqual([]);
  });

  it('always yields a plain array, whatever the vendor passed', () => {
    class WeirdPath extends Array {}
    const path = WeirdPath.from(['a']);

    expect(Object.getPrototypeOf(pathOf(path))).toBe(Array.prototype);
    expect(pathOf(path)).toStrictEqual(['a']);
  });
});

describe('a malformed issue is coerced, never thrown on', () => {
  const issuesOf = (issues: unknown) => {
    const result = fromSchema(
      schemaOf<string>(() => ({ issues })),
    )(null);
    if (isOk(result)) throw new Error('expected Err');
    return result;
  };

  /**
   * The asymmetry with a malformed OUTCOME (which throws) is deliberate: a
   * vendor that returned a genuine failure containing one junk entry still said
   * the input is invalid, and throwing would convert that answer into a crash.
   */
  it('keeps a null issue an Err rather than crashing on `.message`', () => {
    const result = issuesOf([null]);

    expect(result.error.details!.issues).toStrictEqual([
      { message: 'null', path: [] },
    ]);
  });

  it('keeps a primitive issue an Err, preserving its text', () => {
    expect(issuesOf(['oops']).error.details!.issues[0]!.message).toBe('oops');
  });

  it('coerces a non-string message so details stays serializable', () => {
    const result = issuesOf([{ message: 42 }]);

    expect(result.error.details!.issues[0]!.message).toBe('42');
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  /**
   * `message: undefined` is not even round-trippable — `JSON.stringify` drops
   * the key entirely, so the parsed issue is missing a field §2.1 promises.
   */
  it('never emits an undefined message', () => {
    const result = issuesOf([{ path: ['a'] }]);

    expect(result.error.details!.issues[0]!.message).toBe('undefined');
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('tolerates an issue whose message getter throws', () => {
    const issue = {
      get message(): string {
        throw new Error('hostile');
      },
    };

    expect(issuesOf([issue]).error.details!.issues[0]!.message).toBe('undefined');
  });

  it('answers a message whose toString throws, rather than throwing', () => {
    const message = {
      toString() {
        throw new Error('hostile');
      },
    };

    const result = issuesOf([{ message }]);

    expect(result.error.details!.issues[0]!.message).toBe(
      '[unrenderable message]',
    );
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('tolerates an issue that is a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => issuesOf([proxy])).not.toThrow();
  });

  /** `Array.prototype.map` preserves holes; `JSON.stringify` writes them `null`. */
  it('fills the holes in a sparse issues array', () => {
    const sparse = new Array(2);
    sparse[0] = { message: 'first' };

    const result = issuesOf(sparse);
    expect(result.error.details!.issues).toStrictEqual([
      { message: 'first', path: [] },
      { message: 'undefined', path: [] },
    ]);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('counts a malformed issue in the message like any other', () => {
    expect(issuesOf([null, 'x']).error.message).toBe('Validation failed (2 issues)');
  });
});

describe('a hostile outcome answers with the diagnostic, not with its own crash', () => {
  it('reports a revoked Proxy outcome as malformed', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => fromSchema(schemaOf<string>(() => proxy))(null)).toThrow(
      /neither a value nor an issue list/,
    );
  });

  it('reports an outcome whose issues getter throws as malformed', () => {
    const outcome = {
      get issues(): unknown {
        throw new Error('hostile');
      },
    };

    expect(() => fromSchema(schemaOf<string>(() => outcome))(null)).toThrow(
      /neither a value nor an issue list/,
    );
  });

  /**
   * Surviving mutant: nothing paired a non-array `issues` with a `value`.
   * Dropping the `issues === undefined` clause reports `Ok(1)` for an outcome
   * that named neither shape.
   */
  it('does not report Ok for `{ issues: null, value: 1 }`', () => {
    expect(() =>
      fromSchema(schemaOf<number>(() => ({ issues: null, value: 1 })))(null),
    ).toThrow(/neither a value nor an issue list/);
  });
});

describe('fromSchemaAsync applies the settled-first ordering too (§10.11)', () => {
  /**
   * A bare `await` looks like it makes the question moot; it does the opposite.
   * §2's union is brandless, so a settled outcome may also carry a `then`, and
   * `await` hands the value to it — this returned `Ok('LEAKED')` for a vendor
   * that reported a failure, while the sync half rejected the same input.
   */
  it('does not let a thenable failure resolve into Ok', async () => {
    const validate = () => ({
      issues: [{ message: 'm' }],
      then: (resolve: (v: unknown) => void) => resolve({ value: 'LEAKED' }),
    });

    const result = await fromSchemaAsync(schemaOf<string>(validate))(null);

    expect(isErr(result)).toBe(true);
  });

  it('does not hang on a thenable failure whose then never calls back', async () => {
    const validate = () => ({ issues: [{ message: 'm' }], then: () => {} });

    const result = await fromSchemaAsync(schemaOf<string>(validate))(null);

    expect(isErr(result)).toBe(true);
  });

  it('agrees with fromSchema on a thenable settled outcome', async () => {
    const validate = () => ({
      issues: [{ message: 'm' }],
      then: (resolve: (v: unknown) => void) => resolve({ value: 'LEAKED' }),
    });

    const sync = fromSchema(schemaOf<string>(validate))(null);
    const async = await fromSchemaAsync(schemaOf<string>(validate))(null);

    expect(async).toStrictEqual(sync);
  });

  it('still awaits a genuine promise', async () => {
    const result = await fromSchemaAsync(asyncOk('x'))(null);

    expect(result).toStrictEqual({ ok: true, value: 'x' });
  });

  /** Surviving mutant: the sync half pinned this, the async half did not. */
  it('reads ~standard once, at wrap time, not per call', async () => {
    let reads = 0;
    const schema = {
      get '~standard'() {
        reads += 1;
        return {
          version: 1 as const,
          vendor: 'v',
          validate: async () => ({ value: 'x' }),
        };
      },
    } as unknown as Schema<string>;

    const parse = fromSchemaAsync(schema);
    await parse(null);
    await parse(null);
    expect(reads).toBe(1);
  });
});

describe('fromSchema defuses the promise it abandons', () => {
  /**
   * The TypeError told the caller to use fromSchemaAsync — and then the
   * abandoned promise raised an unhandled rejection a tick later, which under
   * Node's default `--unhandled-rejections=throw` kills the process even though
   * the caller had already caught it. The diagnostic became a fatal error.
   */
  it('does not leave an unhandled rejection behind', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const schema = schemaOf<string>(() =>
        Promise.reject(new Error('rejected')),
      );

      expect(() => fromSchema(schema)(null)).toThrow(/fromSchemaAsync/);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(seen).toStrictEqual([]);
  });

  it('still throws the diagnostic when the thenable itself is hostile', () => {
    const schema = schemaOf<string>(() => ({
      then: () => {
        throw new Error('hostile then');
      },
    }));

    expect(() => fromSchema(schema)(null)).toThrow(/fromSchemaAsync/);
  });
});
