import { type } from 'arktype';
import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { fromSchema, fromSchemaAsync, isErr, isOk } from '../../src/index';
import type { Result, ValidationFailed } from '../../src/index';

/**
 * Conformance against the **real** validators — Zod 4, Valibot, ArkType.
 *
 * `schema.spec.ts` proves the adapter against hand-built fixtures of the spec's
 * own shape, which is the right way to test the branches. It cannot prove the
 * thing this file exists for: that a real vendor's schema **satisfies the
 * vendored `StandardSchemaV1` interface** and that its *actual* runtime output
 * lands where the ADR says it should. Standard Schema is types-only, so nothing
 * in `src/` imports these packages; they are devDependencies and the published
 * artifact has neither a dependency nor a peer.
 *
 * Two facts here were discovered by probing the libraries, not by reading the
 * spec, and each has its own pinned test below:
 *
 * 1. **Valibot's FAILURE result also carries `value`** — it returns
 *    `{ value, typed, issues }`, not the bare `{ issues }` the spec's
 *    `FailureResult` describes. `toResult` therefore has to ask
 *    `Array.isArray(issues)` *before* `'value' in outcome`; the other order
 *    turns every Valibot failure into an `Ok` holding the **invalid** input.
 *
 * 2. **ArkType's failure IS an Array** — `ArkErrors extends Array` — and its
 *    `issues[i].path` is a `ReadonlyPath`, an Array subclass carrying a `cache`
 *    property. Both have to normalize to plain, JSON-safe data.
 */

/* -------------------------------------------------------------------------- *
 * Zod 4
 * -------------------------------------------------------------------------- */

describe('Zod 4', () => {
  const UserSchema = z.object({
    email: z.email(),
    tags: z.array(z.string().min(2)),
  });

  it('satisfies the vendored StandardSchemaV1 interface', () => {
    expect(UserSchema['~standard'].version).toBe(1);
    expect(UserSchema['~standard'].vendor).toBe('zod');
  });

  it('lifts a valid input into Ok with the parsed value', () => {
    const result = fromSchema(UserSchema)({
      email: 'a@b.co',
      tags: ['ab'],
    });

    expect(result).toStrictEqual({
      ok: true,
      value: { email: 'a@b.co', tags: ['ab'] },
    });
  });

  it('infers the parsed output type, not unknown', () => {
    const result = fromSchema(UserSchema)({});

    expectTypeOf(result).toEqualTypeOf<
      Result<{ email: string; tags: string[] }, ValidationFailed>
    >();
  });

  it('normalizes a bare PropertyKey path, keeping array indices numeric', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['a'] });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues.map((i) => i.path)).toStrictEqual([
      ['email'],
      ['tags', 0],
    ]);
  });

  it('reports a root-level failure as the empty path', () => {
    const result = fromSchema(z.string())(1);
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path).toStrictEqual([]);
  });

  it('counts every issue in the message', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['a'] });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.message).toBe('Validation failed (2 issues)');
  });

  /**
   * The load-bearing trade, against the vendor that motivated it: Zod attaches
   * `code`, `origin`, `format`, `pattern` — and none reaches `details`.
   */
  it('drops Zod vendor extras from details', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['ab'] });
    if (isOk(result)) throw new Error('expected Err');

    expect(Object.keys(result.error.details!.issues[0]!).sort()).toStrictEqual([
      'message',
      'path',
    ]);
  });

  it('keeps Zod vendor extras reachable under includeCause', () => {
    const result = fromSchema(UserSchema, { includeCause: true })({
      email: 'nope',
      tags: ['ab'],
    });
    if (isOk(result)) throw new Error('expected Err');

    expect((result.error.cause as { code: string }[])[0]!.code).toBe(
      'invalid_format',
    );
  });

  it('routes an async Zod schema through fromSchemaAsync', async () => {
    const schema = z.string().refine(async (s) => s.length > 2, 'too short');

    const bad = await fromSchemaAsync(schema)('a');
    const good = await fromSchemaAsync(schema)('abc');

    expect(isErr(bad)).toBe(true);
    expect(good).toStrictEqual({ ok: true, value: 'abc' });
  });

  it('throws when an async Zod schema is handed to sync fromSchema', () => {
    const schema = z.string().refine(async (s) => s.length > 2, 'too short');

    expect(() => fromSchema(schema)('a')).toThrow(/fromSchemaAsync/);
  });
});

/* -------------------------------------------------------------------------- *
 * Valibot
 * -------------------------------------------------------------------------- */

describe('Valibot', () => {
  const UserSchema = v.object({
    email: v.pipe(v.string(), v.email()),
    tags: v.array(v.pipe(v.string(), v.minLength(2))),
  });

  it('satisfies the vendored StandardSchemaV1 interface', () => {
    expect(UserSchema['~standard'].version).toBe(1);
    expect(UserSchema['~standard'].vendor).toBe('valibot');
  });

  it('lifts a valid input into Ok with the parsed value', () => {
    const result = fromSchema(UserSchema)({ email: 'a@b.co', tags: ['ab'] });

    expect(result).toStrictEqual({
      ok: true,
      value: { email: 'a@b.co', tags: ['ab'] },
    });
  });

  /**
   * THE ORDERING REGRESSION. Valibot's failure result is
   * `{ value, typed, issues }` — it carries `value` on the FAILURE branch. Ask
   * `'value' in outcome` before `Array.isArray(issues)` and this returns `Ok`
   * holding the invalid input, silently, for every Valibot user. Goes red under
   * the flipped order.
   */
  it('treats a failure carrying a `value` key as an Err, not an Ok', () => {
    const raw = UserSchema['~standard'].validate({
      email: 'nope',
      tags: ['ab'],
    });

    // The premise this test defends — if Valibot ever drops `value` from its
    // failure result, the assertion below stops proving anything.
    expect('value' in raw).toBe(true);

    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['ab'] });
    expect(isErr(result)).toBe(true);
  });

  it('never leaks the invalid input into the Ok channel', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['ab'] });

    expect(isOk(result)).toBe(false);
  });

  /** Valibot spells its path as `PathSegment` objects, so `.key` is unwrapped. */
  it('unwraps Valibot PathSegment objects to their keys', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['a'] });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues.map((i) => i.path)).toStrictEqual([
      ['email'],
      ['tags', 0],
    ]);
  });

  /**
   * Valibot's PathSegment carries `input` (the whole parent object) and `value`
   * (the rejected field) on every segment. ADR 0015's PII concern is not
   * hypothetical, and unwrapping to `key` is what leaves that structure behind.
   */
  it('drops the object graph Valibot hangs off each path segment', () => {
    const raw = UserSchema['~standard'].validate({
      email: 'leaky-secret',
      tags: ['ab'],
    }) as unknown as { issues: { path?: unknown[] }[] };

    // Premise: the raw segment really does carry the rejected input.
    expect(raw.issues[0]!.path![0]).toHaveProperty('input');
    expect(JSON.stringify(raw.issues[0]!.path![0])).toContain('leaky-secret');

    const result = fromSchema(UserSchema)({
      email: 'leaky-secret',
      tags: ['ab'],
    });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path).toStrictEqual(['email']);
  });

  /**
   * The limit of that claim, stated honestly rather than left to be discovered.
   *
   * Valibot's own issue message is `Invalid email: Received "leaky-secret"` — it
   * **embeds the rejected value**. ADR 0015 §2 passes the vendor's `message`
   * through untouched, so a caller who logs `details.issues[].message` is
   * logging vendor-authored text that may contain user input. That is §3.4's
   * recorded trap and it is precisely why the adapter's OWN `message` carries a
   * count and nothing else: the one field this package authors cannot leak.
   */
  it('passes the vendor message through even when it embeds the input', () => {
    const result = fromSchema(UserSchema)({
      email: 'leaky-secret',
      tags: ['ab'],
    });
    if (isOk(result)) throw new Error('expected Err');

    // The vendor's text is passed through, verbatim, input and all.
    expect(result.error.details!.issues[0]!.message).toContain('leaky-secret');

    // The field this package authors is a count, and cannot carry payload.
    expect(result.error.message).toBe('Validation failed (1 issue)');
  });

  it('routes an async Valibot schema through fromSchemaAsync', async () => {
    const schema = v.pipeAsync(
      v.string(),
      v.checkAsync(async (s) => s.length > 2, 'too short'),
    );

    const bad = await fromSchemaAsync(schema)('a');
    const good = await fromSchemaAsync(schema)('abc');

    expect(isErr(bad)).toBe(true);
    expect(good).toStrictEqual({ ok: true, value: 'abc' });
  });

  it('throws when an async Valibot schema is handed to sync fromSchema', () => {
    const schema = v.pipeAsync(
      v.string(),
      v.checkAsync(async (s) => s.length > 2, 'too short'),
    );

    expect(() => fromSchema(schema)('a')).toThrow(/fromSchemaAsync/);
  });
});

/* -------------------------------------------------------------------------- *
 * ArkType
 * -------------------------------------------------------------------------- */

describe('ArkType', () => {
  const UserSchema = type({ email: 'string.email', tags: 'string[]' });

  it('satisfies the vendored StandardSchemaV1 interface', () => {
    expect(UserSchema['~standard'].version).toBe(1);
    expect(UserSchema['~standard'].vendor).toBe('arktype');
  });

  it('lifts a valid input into Ok with the parsed value', () => {
    const result = fromSchema(UserSchema)({ email: 'a@b.co', tags: ['ab'] });

    expect(result).toStrictEqual({
      ok: true,
      value: { email: 'a@b.co', tags: ['ab'] },
    });
  });

  /**
   * ArkType's failure result is an **Array** (`ArkErrors extends Array`), not
   * the plain `{ issues }` object the spec describes. The `typeof === 'object'`
   * guard admits it and `Array.isArray(outcome.issues)` still finds the list, so
   * it lands on the Err branch like any other vendor.
   */
  it('handles a failure result that is itself an Array', () => {
    const raw = UserSchema['~standard'].validate({ email: 'nope', tags: 'x' });

    // Premise: the outcome really is an Array, not a plain object.
    expect(Array.isArray(raw)).toBe(true);

    const result = fromSchema(UserSchema)({ email: 'nope', tags: 'x' });
    expect(isErr(result)).toBe(true);
  });

  it('normalizes ArkType paths to plain arrays', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: 'x' });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues.map((i) => i.path)).toStrictEqual([
      ['email'],
      ['tags'],
    ]);
  });

  /**
   * ArkType's `path` is a `ReadonlyPath` — an Array subclass carrying a `cache`
   * property. Normalization must yield a plain array, or that internal cache
   * rides along into a payload §2.1 promises is JSON-safe.
   */
  it('strips the ReadonlyPath subclass down to a plain array', () => {
    const raw = UserSchema['~standard'].validate({
      email: 'nope',
      tags: 'x',
    }) as unknown as { issues: { path?: unknown }[] };

    // Premise: the raw path is not a plain array.
    expect(Object.getPrototypeOf(raw.issues[0]!.path)).not.toBe(
      Array.prototype,
    );
    expect(raw.issues[0]!.path).toHaveProperty('cache');

    const result = fromSchema(UserSchema)({ email: 'nope', tags: 'x' });
    if (isOk(result)) throw new Error('expected Err');

    const path = result.error.details!.issues[0]!.path;
    expect(Object.getPrototypeOf(path)).toBe(Array.prototype);
    expect(path).not.toHaveProperty('cache');
  });

  it('drops ArkType vendor extras from details', () => {
    const result = fromSchema(UserSchema)({ email: 'nope', tags: ['ab'] });
    if (isOk(result)) throw new Error('expected Err');

    expect(Object.keys(result.error.details!.issues[0]!).sort()).toStrictEqual([
      'message',
      'path',
    ]);
  });
});

/* -------------------------------------------------------------------------- *
 * Cross-vendor invariants — the claim the adapter actually sells
 * -------------------------------------------------------------------------- */

describe('cross-vendor invariants', () => {
  /**
   * Three libraries, three wire formats — one payload shape. This is the whole
   * proposition, so it is asserted directly rather than inferred from the
   * per-vendor blocks above.
   */
  const schemas = [
    ['zod', z.object({ email: z.email() })],
    ['valibot', v.object({ email: v.pipe(v.string(), v.email()) })],
    ['arktype', type({ email: 'string.email' })],
  ] as const;

  it.each(schemas)('%s produces an identical payload shape', (_, schema) => {
    const result = fromSchema(schema)({ email: 'nope' });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.type).toBe('validation_failed');
    expect(result.error.message).toBe('Validation failed (1 issue)');
    expect(Object.keys(result.error).sort()).toStrictEqual([
      'details',
      'message',
      'type',
    ]);
    expect(Object.keys(result.error.details!)).toStrictEqual(['issues']);
    expect(result.error.details!.issues[0]!.path).toStrictEqual(['email']);
    expect(typeof result.error.details!.issues[0]!.message).toBe('string');
  });

  it.each(schemas)('%s produces a JSON round-trippable Err', (_, schema) => {
    const result = fromSchema(schema)({ email: 'nope' });

    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it.each(schemas)('%s produces a JSON round-trippable Ok', (_, schema) => {
    const result = fromSchema(schema)({ email: 'a@b.co' });

    expect(isOk(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  /** The `cause` carve-out is the only place vendor-shaped data survives. */
  it.each(schemas)('%s keeps details serializable regardless of cause', (_, schema) => {
    const result = fromSchema(schema, { includeCause: true })({ email: 'nope' });
    if (isOk(result)) throw new Error('expected Err');

    expect(() => JSON.stringify(result.error.details)).not.toThrow();
    expect(result.error.cause).toBeDefined();
  });

  it.each(schemas)('%s omits cause entirely by default', (_, schema) => {
    const result = fromSchema(schema)({ email: 'nope' });
    if (isOk(result)) throw new Error('expected Err');

    expect('cause' in result.error).toBe(false);
  });

  it.each(schemas)('%s is accepted by fromSchemaAsync too', async (_, schema) => {
    const result = await fromSchemaAsync(schema)({ email: 'a@b.co' });

    expect(isOk(result)).toBe(true);
  });

  /** Dirty real-world input: nothing here may crash the adapter. */
  const hostileInputs: readonly [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['NaN', NaN],
    ['a bare string', 'nope'],
    ['an array', []],
    ['an empty object', {}],
    ['a Date', new Date(0)],
    ['a prototype-less object', Object.create(null)],
    ['unicode', { email: '📧@例え.テスト' }],
    ['whitespace only', { email: '   ' }],
    ['a very long string', { email: `${'a'.repeat(50_000)}@b.co` }],
  ];

  it.each(hostileInputs)(
    'survives %s across every vendor, returning a Result either way',
    (_, input) => {
      for (const [, schema] of schemas) {
        const result = fromSchema(schema)(input);

        expect(typeof result.ok).toBe('boolean');
        expect(() => JSON.stringify(result)).not.toThrow();
      }
    },
  );

  it('handles an input carrying a circular reference', () => {
    const cyclic: Record<string, unknown> = { email: 'nope' };
    cyclic.self = cyclic;

    for (const [, schema] of schemas) {
      const result = fromSchema(schema)(cyclic);

      expect(isErr(result)).toBe(true);
      // The cycle came in through the *input*; `details` must not have carried
      // it out, which is exactly what dropping vendor extras buys.
      expect(() => JSON.stringify(result)).not.toThrow();
    }
  });

  it('scales to many issues without truncating the count', () => {
    const schema = z.array(z.string().min(2));
    const result = fromSchema(schema)(Array.from({ length: 500 }, () => 'a'));
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues).toHaveLength(500);
    expect(result.error.message).toBe('Validation failed (500 issues)');
  });

  it('normalizes deeply nested paths in full', () => {
    const schema = z.object({
      a: z.object({ b: z.object({ c: z.array(z.object({ d: z.string() })) }) }),
    });
    const result = fromSchema(schema)({ a: { b: { c: [{ d: 1 }] } } });
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path).toStrictEqual([
      'a',
      'b',
      'c',
      0,
      'd',
    ]);
  });

  /** Calling the same wrapped parser twice must not accumulate or mutate. */
  it.each(schemas)('%s parser is idempotent across repeated calls', (_, schema) => {
    const parse = fromSchema(schema);

    const first = parse({ email: 'nope' });
    const second = parse({ email: 'nope' });

    expect(first).toStrictEqual(second);
  });
});

/* -------------------------------------------------------------------------- *
 * The vendor inputs that made the path normalizer's totality claim false
 * -------------------------------------------------------------------------- *
 *
 * ADR 0015 §3 argued the `symbol` case and concluded coercion "keeps §2.1 true
 * unconditionally, with no fourth carve-out". Handling only `symbol` made that
 * false, and not hypothetically: Valibot's path items include a Map key — which
 * is `unknown`, i.e. any value at all — and a Set key, which is `null`. Neither
 * is reachable from `v.object` / `v.array`, which is why the suite above missed
 * it and a hand-built fixture never would have found it.
 */

describe('Valibot Map and Set paths (the §2.1 totality regression)', () => {
  it('coerces a BigInt Map key instead of making JSON.stringify throw', () => {
    const schema = v.map(v.bigint(), v.pipe(v.string(), v.minLength(2)));

    const result = fromSchema(schema)(new Map([[1n, 'a']]));
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path).toStrictEqual(['1']);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  /**
   * The retention cost ADR 0015 §5 rejected always-on `cause` to avoid, arriving
   * through `path` instead — with `includeCause` OFF.
   */
  it('does not retain a caller object used as a Map key', () => {
    const schema = v.map(v.unknown(), v.pipe(v.string(), v.minLength(2)));
    const key: Record<string, unknown> = { secret: 'pii' };
    key.self = key;

    const result = fromSchema(schema)(new Map([[key, 'a']]));
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path[0]).not.toBe(key);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result.error.details)).not.toContain('pii');
  });

  it('coerces Valibot’s null Set key', () => {
    const schema = v.set(v.pipe(v.string(), v.minLength(2)));

    const result = fromSchema(schema)(new Set(['a']));
    if (isOk(result)) throw new Error('expected Err');

    expect(result.error.details!.issues[0]!.path).toStrictEqual(['null']);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it.each([
    ['a Map', v.map(v.bigint(), v.pipe(v.string(), v.minLength(2))), new Map([[1n, 'a']])],
    ['a Set', v.set(v.pipe(v.string(), v.minLength(2))), new Set(['a'])],
  ])('%s failure still round-trips through JSON', (_, schema, input) => {
    const result = fromSchema(schema)(input);

    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });
});
