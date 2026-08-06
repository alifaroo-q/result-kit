import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  err,
  fromPredicate,
  isErr,
  isOk,
  isResult,
  ok,
  parseResult,
} from '../../src/index';
import type {
  MalformedResult,
  MalformedResultReason,
  Result,
} from '../../src/index';

/**
 * REMINDER: every `expectTypeOf` and `@ts-expect-error` below is enforced by
 * `pnpm check`, NOT by `pnpm test` — vitest.config.ts sets no `typecheck`, so
 * these are runtime no-ops under `vitest run`.
 *
 * The contract that fails silently at runtime here is the narrowing itself. An
 * `isResult` typed `(value: unknown) => boolean` — no predicate — would pass
 * every runtime assertion in this file and leave the `as Result<T, E>` cast
 * this module exists to delete exactly where it was. Only tsc separates them.
 */

/** Sends a value through the wire the way §2.1 promises it can go. */
const wire = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value)) as unknown;

/** Asserts a rejection, and reports the reason it actually gave when it differs. */
const expectRejected = (
  value: unknown,
  reason: MalformedResultReason,
): MalformedResult => {
  const parsed = parseResult(value);
  if (isOk(parsed)) {
    throw new Error(`expected a rejection, got Ok — reason expected: ${reason}`);
  }
  expect(parsed.error.details?.reason).toBe(reason);
  return parsed.error;
};

describe('isResult / parseResult — well-formed input', () => {
  it('accepts what the constructors build', () => {
    expect(isResult(ok(1))).toBe(true);
    expect(isResult(err('boom'))).toBe(true);
    expect(isResult(ok(undefined))).toBe(true);
    expect(isResult(err(null))).toBe(true);
  });

  it('accepts them again after a JSON round trip — the whole point', () => {
    expect(isResult(wire(ok({ id: 1 })))).toBe(true);
    expect(isResult(wire(err({ type: 'not_found', message: 'no' })))).toBe(true);
  });

  it('accepts a hand-built envelope, whoever built it (§2 is brandless)', () => {
    expect(isResult({ ok: true, value: 'anything' })).toBe(true);
    expect(isResult({ ok: false, error: 'anything' })).toBe(true);
  });

  it('accepts a null-prototype object', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.ok = true;
    bare.value = 1;
    expect(isResult(bare)).toBe(true);
  });

  it('accepts a Result carrying a Result', () => {
    expect(isResult(ok(err('inner')))).toBe(true);
  });

  it('does not look at the payload halves at all', () => {
    // Whatever `T` and `E` are is the caller's problem, by design — this proves
    // the envelope and nothing else.
    expect(isResult({ ok: true, value: () => {} })).toBe(true);
    expect(isResult({ ok: false, error: Symbol('e') })).toBe(true);
    const cyclic: { ok: true; value: unknown } = { ok: true, value: null };
    cyclic.value = cyclic;
    expect(isResult(cyclic)).toBe(true);
  });
});

describe('parseResult — the returned value', () => {
  it('returns the very same object, not a copy', () => {
    const input = { ok: true as const, value: 1 };
    const parsed = parseResult(input);
    if (isErr(parsed)) throw new Error('expected Ok');
    // Identity, not deep equality: this validates, it never reconstructs.
    expect(parsed.value).toBe(input);
  });

  it('nests, so a malformed envelope stays distinct from a reported failure', () => {
    const reportedFailure = parseResult(wire(err({ type: 'not_found' })));
    const malformedEnvelope = parseResult('not a result at all');

    expect(isOk(reportedFailure)).toBe(true); // it IS a Result…
    if (isErr(reportedFailure)) throw new Error('expected Ok');
    expect(isErr(reportedFailure.value)).toBe(true); // …that reports a failure

    expect(isErr(malformedEnvelope)).toBe(true); // it is not a Result
  });

  it('agrees with isResult on every value in this file', () => {
    const corpus: unknown[] = [
      ok(1),
      err('e'),
      { ok: true },
      { ok: false, error: null },
      { ok: true, value: 1, traceId: 'x' },
      {},
      { ok: 'true' },
      { ok: false },
      [],
      'string',
      null,
      undefined,
      0,
      Symbol('s'),
      new Error('e'),
    ];

    for (const value of corpus) {
      expect(isResult(value)).toBe(isOk(parseResult(value)));
    }
  });
});

describe('the `ok()` carve-out (spec §10.9) and its error-side counterpart', () => {
  it('accepts a round-tripped `ok()`, whose `value` key is gone', () => {
    const roundTripped = wire(ok()) as Record<string, unknown>;
    expect(roundTripped).toEqual({ ok: true });
    expect('value' in roundTripped).toBe(false);

    // Rejecting this would reject the output of the form §5.1 recommends.
    expect(isResult(roundTripped)).toBe(true);
  });

  it('rejects a bare `{ ok: false }` — the payload was dropped, not absent', () => {
    // Same mechanism, no blessed producer: `err` has no no-arg overload, so
    // this only ever means a non-JSON-serializable error went onto the wire.
    expectRejected(wire(err(undefined)), 'error_dropped');
  });

  it('rejects it for every payload kind JSON.stringify drops', () => {
    expectRejected(wire(err(() => {})), 'error_dropped');
    expectRejected(wire(err(Symbol('boom'))), 'error_dropped');
    expectRejected(
      wire(err({ toJSON: () => undefined })),
      'error_dropped',
    );
  });

  it('accepts the recommended spelling for a detail-free failure', () => {
    // What the `error_dropped` message tells the producer to send instead.
    expect(isResult(wire(err(null)))).toBe(true);
  });

  it('does not demand a `value` on the ok branch', () => {
    expect(isResult({ ok: true })).toBe(true);
  });
});

describe('extra properties ride along', () => {
  it('accepts an envelope a gateway has stamped', () => {
    expect(isResult({ ok: true, value: 1, traceId: 'abc' })).toBe(true);
    expect(isResult({ ok: false, error: 'e', traceId: 'abc', span: 2 })).toBe(
      true,
    );
  });

  it('does not strip them', () => {
    const stamped = { ok: true as const, value: 1, traceId: 'abc' };
    const parsed = parseResult(stamped);
    if (isErr(parsed)) throw new Error('expected Ok');
    // Identity, not structural equality: a copy that happened to keep the extra
    // keys would satisfy `toStrictEqual` and still be a rewrite.
    expect(parsed.value).toBe(stamped);
    expect(Object.keys(parsed.value)).toStrictEqual(['ok', 'value', 'traceId']);
  });
});

describe('rejections, by reason', () => {
  it('rejects primitives as `not_an_object`', () => {
    for (const value of [
      'string',
      '',
      0,
      1,
      true,
      false,
      null,
      undefined,
      123n,
      Symbol('s'),
    ]) {
      expectRejected(value, 'not_an_object');
    }
  });

  it('rejects arrays as `not_an_object`', () => {
    expectRejected([], 'not_an_object');
    expectRejected([1, 2], 'not_an_object');
    // Even one carrying the right properties: JSON.stringify writes only the
    // indices, so `ok` never survives the trip that brought it here.
    const arrayish = [] as unknown as { ok: boolean; value: number };
    arrayish.ok = true;
    arrayish.value = 1;
    expectRejected(arrayish, 'not_an_object');
  });

  it('rejects an object with no discriminant', () => {
    expectRejected({}, 'missing_discriminant');
    expectRejected({ value: 1 }, 'missing_discriminant');
    expectRejected({ error: 'e' }, 'missing_discriminant');
    expectRejected(Object.create(null), 'missing_discriminant');
  });

  it('rejects a non-boolean discriminant — including the JSON-ish lookalikes', () => {
    expectRejected({ ok: 'true', value: 1 }, 'invalid_discriminant');
    expectRejected({ ok: 1, value: 1 }, 'invalid_discriminant');
    expectRejected({ ok: 0, error: 'e' }, 'invalid_discriminant');
    expectRejected({ ok: null, value: 1 }, 'invalid_discriminant');
    expectRejected({ ok: undefined, value: 1 }, 'invalid_discriminant');
    expectRejected({ ok: new Boolean(true), value: 1 }, 'invalid_discriminant');
  });

  it('does not find `ok` on the prototype chain', () => {
    // `in` walks the chain, so an object inheriting `ok` reads as well-formed
    // while `JSON.stringify` — which writes own enumerable properties only —
    // would have dropped it. Both halves of that must agree.
    const parent = { ok: true, value: 1 };
    const child = Object.create(parent) as Record<string, unknown>;

    expect(wire(child)).toStrictEqual({});
    expectRejected(child, 'missing_discriminant');
  });

  it('does not find `ok` on a class prototype', () => {
    class Envelope {
      readonly value = 1;
      get ok(): boolean {
        return true;
      }
    }
    const instance = new Envelope();

    expect(wire(instance)).toStrictEqual({ value: 1 });
    expectRejected(instance, 'missing_discriminant');
  });

  it('does not accept a non-enumerable own discriminant', () => {
    const hidden = { value: 1 };
    Object.defineProperty(hidden, 'ok', { value: true, enumerable: false });

    // Own, but still dropped by JSON.stringify — so still not wire-legal.
    expect(Object.hasOwn(hidden, 'ok')).toBe(true);
    expect(wire(hidden)).toStrictEqual({ value: 1 });
    expectRejected(hidden, 'missing_discriminant');
  });

  it('applies the same rule to an inherited `error`', () => {
    const parent = { error: 'inherited' };
    const child = Object.create(parent) as Record<string, unknown>;
    child.ok = false;

    expect(wire(child)).toStrictEqual({ ok: false });
    expectRejected(child, 'error_dropped');
  });

  it('applies the same rule to a non-enumerable own `error`', () => {
    // The mirror of the `ok` case above. Without this, the `error` probe could
    // be weakened from `propertyIsEnumerable` to `hasOwn` and no test would
    // notice — half the `isWireProperty` contract would be unpinned.
    const hidden = { ok: false };
    Object.defineProperty(hidden, 'error', {
      value: 'hidden',
      enumerable: false,
    });

    expect(Object.hasOwn(hidden, 'error')).toBe(true);
    expect(wire(hidden)).toStrictEqual({ ok: false });
    expectRejected(hidden, 'error_dropped');
  });
});

describe('what the probe deliberately does not answer', () => {
  it('accepts an object whose `toJSON` replaces the whole envelope', () => {
    // `propertyIsEnumerable` is the own-enumerable question, not an oracle for
    // "would a round trip reproduce this". A `toJSON` bypasses property
    // serialization entirely, so `ok` is own-enumerable yet never written.
    const disguised = {
      ok: true as const,
      value: 1,
      toJSON: () => 'not a result at all',
    };

    expect(JSON.stringify(disguised)).toBe('"not a result at all"');
    // Accepted, because it *is* a usable Result right now…
    expect(isResult(disguised)).toBe(true);
    // …and it cannot reach a wire boundary: JSON.parse never produces a toJSON.
    expect(isResult(wire(disguised))).toBe(false);
  });

  it('accepts a pre-wire `err(undefined)`, whose `error` key is present', () => {
    // The counterpart of the rejected `{ ok: false }`, and not an
    // inconsistency: `err(undefined)` is constructible, so rejecting it would
    // reject `err`'s own output the way rejecting `{ ok: true }` would reject
    // `ok()`'s. The envelope is intact; only the payload is odd, and judging
    // payloads is not this function's job.
    const preWire = err(undefined);

    expect(Object.hasOwn(preWire, 'error')).toBe(true);
    expect(isResult(preWire)).toBe(true);
    // The same value after a round trip has genuinely lost the key.
    expect(isResult(wire(preWire))).toBe(false);
  });

  it('is a pure function, not a promise of idempotence over a mutating input', () => {
    // `isResult` and `parseResult` share one `classify`, so they cannot
    // disagree about the same observation — but an input that changes as it is
    // read is a different value on each call, and no pure function can help.
    let reads = 0;
    const mutating = {
      get ok(): boolean {
        reads += 1;
        return reads === 1;
      },
      value: 1,
    };

    expect(isResult(mutating)).toBe(true); // reads once: ok === true
    expect(isOk(parseResult(mutating))).toBe(false); // reads again: ok === false,
    expect(reads).toBe(2); //                           and no `error` key
  });
});

describe('never throws — hostile input', () => {
  it('survives a revoked Proxy (`Array.isArray` itself throws on one)', () => {
    const { proxy, revoke } = Proxy.revocable({ ok: true, value: 1 }, {});
    revoke();

    expect(() => isResult(proxy)).not.toThrow();
    expect(isResult(proxy)).toBe(false);
    expectRejected(proxy, 'unreadable');
  });

  it('survives a `getOwnPropertyDescriptor` trap that throws', () => {
    // The trap `propertyIsEnumerable` goes through, so this is the one the
    // discriminant probe actually reaches.
    const hostile = new Proxy(
      { ok: true, value: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error('gopd trap');
        },
      },
    );
    expectRejected(hostile, 'unreadable');
  });

  it('survives a `get` trap that throws', () => {
    const hostile = new Proxy(
      { ok: true, value: 1 },
      {
        get(_target, key) {
          if (key === 'ok') throw new Error('get trap');
          return undefined;
        },
      },
    );
    expectRejected(hostile, 'unreadable');
  });

  it('survives an `ok` accessor that throws', () => {
    const hostile = {
      get ok(): boolean {
        throw new Error('accessor');
      },
    };
    expectRejected(hostile, 'unreadable');
  });

  it('never throws across a hostile corpus, whatever the verdict', () => {
    const revoked = Proxy.revocable({ ok: true, value: 1 }, {});
    revoked.revoke();
    const traps = [
      'get',
      'has',
      'getOwnPropertyDescriptor',
      'ownKeys',
      'getPrototypeOf',
      'defineProperty',
      'deleteProperty',
    ] as const;

    const corpus: unknown[] = [
      revoked.proxy,
      ...traps.map((trap) =>
        new Proxy(
          { ok: false, error: 'e' },
          {
            [trap]: () => {
              throw new Error(trap);
            },
          },
        ),
      ),
      { get ok(): never { throw new Error('ok accessor'); } },
      { ok: false, get error(): never { throw new Error('error accessor'); } },
      { ok: true, value: 1, [Symbol.toPrimitive]: () => { throw new Error('tp'); } },
      Object.freeze({ ok: true, value: 1 }),
      Object.seal({ ok: false, error: 'e' }),
      Object.create(null),
      new Proxy({}, { ownKeys: () => { throw new Error('ownKeys'); } }),
    ];

    for (const value of corpus) {
      expect(() => isResult(value)).not.toThrow();
      expect(() => parseResult(value)).not.toThrow();
      // And the two still agree — none of these mutates as it is read.
      expect(isResult(value)).toBe(isOk(parseResult(value)));
    }
  });

  it('survives a descriptor trap that throws only for `ok`', () => {
    const hostile = new Proxy(
      { ok: true, value: 1 },
      {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'ok') throw new Error('selective trap');
          return Object.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expectRejected(hostile, 'unreadable');
  });

  it('survives a `getPrototypeOf` trap that throws', () => {
    const hostile = new Proxy(
      { ok: true, value: 1 },
      {
        getPrototypeOf() {
          throw new Error('proto trap');
        },
      },
    );
    expect(() => isResult(hostile)).not.toThrow();
  });

  it('survives a hostile probe on the second property it reads', () => {
    // Reaches the `error` check — i.e. past the discriminant — and throws
    // there, proving the guard covers the whole walk and not just its start.
    const hostile = new Proxy(
      { ok: false, error: 'e' },
      {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'error') throw new Error('gopd trap');
          return Object.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expectRejected(hostile, 'unreadable');
  });
});

describe('the failure payload itself (§2.1, §3)', () => {
  it('is a TypedError with the fixed tag and a `{ reason }` details', () => {
    const error = expectRejected('nope', 'not_an_object');

    expect(error.type).toBe('malformed_result');
    expect(typeof error.message).toBe('string');
    expect(Object.keys(error.details ?? {})).toStrictEqual(['reason']);
  });

  it('round-trips through JSON, like any Result this package builds', () => {
    const parsed = parseResult('nope');
    expect(wire(parsed)).toStrictEqual(parsed);
  });

  it('never carries the rejected value — not in details, not in cause', () => {
    const secret = { ssn: '000-00-0000' };
    const error = expectRejected(
      { ok: 'yes', value: secret },
      'invalid_discriminant',
    );

    expect('cause' in error).toBe(false);
    // Exhaustive, not a string search: a needle test would pass against a
    // `details` that carried the object under some other serialization.
    expect(Object.keys(error).sort()).toStrictEqual([
      'details',
      'message',
      'type',
    ]);
    expect(error.details).toStrictEqual({ reason: 'invalid_discriminant' });
    expect(JSON.stringify(error)).not.toContain('000-00-0000');
  });

  it('never interpolates the input into `message` (§3.4)', () => {
    // Two structurally different rejections with the same reason must produce
    // byte-identical messages, or something from the payload got in.
    const a = expectRejected({ ok: 'leak-me' }, 'invalid_discriminant');
    const b = expectRejected({ ok: 42 }, 'invalid_discriminant');
    expect(a.message).toBe(b.message);
  });

  it('gives a distinct message per reason, bound to that reason', () => {
    // Paired, not zipped by index: two parallel arrays let either be reordered
    // without failing, which would leave the reason-to-message binding — the
    // thing under test — unpinned.
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const cases: readonly (readonly [MalformedResultReason, unknown])[] = [
      ['not_an_object', 'primitive'],
      ['unreadable', proxy],
      ['missing_discriminant', {}],
      ['invalid_discriminant', { ok: 1 }],
      ['error_dropped', { ok: false }],
    ];

    const byReason = new Map<MalformedResultReason, string>();
    for (const [reason, sample] of cases) {
      byReason.set(reason, expectRejected(sample, reason).message);
    }

    // Every reason produced a message, and no two share one.
    expect(byReason.size).toBe(cases.length);
    expect(new Set(byReason.values()).size).toBe(cases.length);
    // And each is the message for *its* reason, not merely some unique string.
    expect(byReason.get('error_dropped')).toContain('`error`');
    expect(byReason.get('missing_discriminant')).toContain('`ok`');
    expect(byReason.get('not_an_object')).toContain('object');
    expect(byReason.get('unreadable')).toContain('could not be read');
  });

  it('tells the producer what to do about a dropped error', () => {
    const error = expectRejected({ ok: false }, 'error_dropped');
    expect(error.message).toContain('JSON.stringify');
    expect(error.message).toContain('null');
  });
});

describe('composition', () => {
  it('feeds fromPredicate for a caller-chosen error', () => {
    const parse = (input: unknown): Result<Result<unknown, unknown>, 'BAD'> =>
      fromPredicate(input, isResult, 'BAD' as const);

    expect(parse(ok(1))).toStrictEqual(ok(ok(1)));
    expect(parse('nope')).toStrictEqual(err('BAD'));
  });

  it('completes the wire round trip end to end', () => {
    const sent = err({ type: 'not_found', message: 'no such user' });
    const received = parseResult(wire(sent));

    if (isErr(received)) throw new Error('expected a well-formed envelope');
    expect(isErr(received.value)).toBe(true);
    expect(received.value).toStrictEqual(sent);
  });
});

describe('types', () => {
  it('narrows an unknown to Result<unknown, unknown>', () => {
    const value: unknown = ok(1);

    if (isResult(value)) {
      expectTypeOf(value).toEqualTypeOf<Result<unknown, unknown>>();
      if (isOk(value)) expectTypeOf(value.value).toEqualTypeOf<unknown>();
      else expectTypeOf(value.error).toEqualTypeOf<unknown>();
    }
  });

  it('keeps a narrower Result narrow', () => {
    // Taken as a parameter, not a local: an initializer would let control-flow
    // analysis narrow to `Ok<number>` before the guard is ever consulted, and
    // the assertion would prove nothing about the guard.
    const check = (value: Result<number, string>): void => {
      if (isResult(value)) {
        expectTypeOf(value).toEqualTypeOf<Result<number, string>>();
      }
    };
    check(ok(1));
  });

  it('returns a nested Result with a MalformedResult error', () => {
    const parsed = parseResult(null as unknown);
    expectTypeOf(parsed).toEqualTypeOf<
      Result<Result<unknown, unknown>, MalformedResult>
    >();

    if (isErr(parsed)) {
      expectTypeOf(parsed.error.type).toEqualTypeOf<'malformed_result'>();
      expectTypeOf(parsed.error.details).toEqualTypeOf<
        { readonly reason: MalformedResultReason } | undefined
      >();
    }
  });

  it('takes no generic parameter — that would be the `as` cast again', () => {
    // The payload halves stay `unknown` by construction. If this ever starts
    // compiling, the module has grown back the lie it exists to delete.
    // @ts-expect-error - parseResult is not generic
    parseResult<number, string>(ok(1));
  });

  it('does not accept a Result as proof of its own payload types', () => {
    const parsed = parseResult(wire(ok(1)));
    if (isErr(parsed)) return;
    // @ts-expect-error - the inner value is `unknown`, not `number`
    const n: number = isOk(parsed.value) ? parsed.value.value : 0;
    void n;
  });
});
