import { describe, expect, expectTypeOf, it } from 'vitest';

import { defineError, err, isTypedError, unwrapOrThrow } from '../../src/index';
import type { TypedError } from '../../src/index';

// The three canonical variants of §3.1, defined once: a payload variant whose
// message derives from the payload, a no-payload variant, and the `.withData`
// escape hatch (payload + static message).
const notFound = defineError(
  'not_found',
  (d: { id: string }) => `User ${d.id} not found`,
);
const forbidden = defineError('forbidden', 'Access denied');
const conflict = defineError.withData<{ id: string }>()(
  'conflict',
  'Already exists',
);

describe('TypedError shape', () => {
  // §3 invariant: a plain structural object, never a class, never an Error.
  it('produces a plain object with no prototype chain to Error', () => {
    const e = notFound({ id: '123' });

    expect(e).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(e)).toBe(Object.prototype);
  });

  // §3 invariant: no eager stack capture. A `stack` here would mean something
  // constructed an Error behind the consumer's back.
  it('captures no stack', () => {
    expect(notFound({ id: '123' })).not.toHaveProperty('stack');
  });

  // §3 invariant: exactly four fields, and only the ones actually populated.
  // A no-payload variant must not carry a `details` key at all.
  it('emits only the populated fields of the four-field shape', () => {
    expect(Object.keys(notFound({ id: '123' })).sort()).toEqual([
      'details',
      'message',
      'type',
    ]);
    expect(Object.keys(forbidden()).sort()).toEqual(['message', 'type']);
  });

  it('nests the payload under details rather than spreading it', () => {
    expect(notFound({ id: '123' })).toEqual({
      type: 'not_found',
      message: 'User 123 not found',
      details: { id: '123' },
    });
  });
});

describe('defineError — payload inference', () => {
  // §3.1 behaviour 1: the message fn's parameter annotation IS the payload
  // declaration — no explicit type argument anywhere in this call.
  it('infers the payload type from the message function parameter', () => {
    expectTypeOf(notFound).parameter(0).toEqualTypeOf<{ id: string }>();
    expectTypeOf<ReturnType<typeof notFound>>().toEqualTypeOf<
      TypedError<'not_found', { id: string }>
    >();
  });

  // §3.1 behaviour 4 + the AC: the factory defaults TData = void, so an
  // absent payload is `never` — the interface's permissive
  // Record<string, unknown> default must not leak in here.
  it('gives a no-payload variant a never payload, not Record<string, unknown>', () => {
    expectTypeOf<ReturnType<typeof forbidden>>().toEqualTypeOf<
      TypedError<'forbidden', never>
    >();
    expectTypeOf<ReturnType<typeof forbidden>>().not.toEqualTypeOf<
      TypedError<'forbidden', Record<string, unknown>>
    >();
  });

  it('rejects a payload on a no-payload variant', () => {
    // @ts-expect-error — a no-payload variant takes no payload object
    forbidden({ id: '1' });
  });

  it('requires the payload on a payload variant, and enforces its shape', () => {
    // Deliberately never invoked. These are compile-time assertions (`pnpm
    // check` is what asserts them); actually calling notFound() with no payload
    // would run the message fn against a missing payload and throw.
    void (() => {
      // @ts-expect-error — details is required
      notFound();
      // @ts-expect-error — details shape is enforced
      notFound({ nope: 1 });
    });
  });

  it('rejects an unannotated message function parameter', () => {
    // @ts-expect-error — the annotation IS the payload declaration
    defineError('bad', (d) => `${d.id}`);
  });

  // §3.1 behaviour 2: the one shape single-call cannot infer — payload plus a
  // static message — without repeating the 'conflict' literal as a type arg.
  it('takes the payload type explicitly via withData, without repeating the type literal', () => {
    expectTypeOf<ReturnType<typeof conflict>>().toEqualTypeOf<
      TypedError<'conflict', { id: string }>
    >();
    expect(conflict({ id: '9' })).toEqual({
      type: 'conflict',
      message: 'Already exists',
      details: { id: '9' },
    });
  });

  it('types the withData message function parameter from the explicit payload', () => {
    const conflict2 = defineError.withData<{ id: string }>()(
      'conflict',
      (d) => `Conflict on ${d.id}`,
    );

    expectTypeOf<ReturnType<typeof conflict2>>().toEqualTypeOf<
      TypedError<'conflict', { id: string }>
    >();
    expect(conflict2({ id: '9' }).message).toBe('Conflict on 9');
  });

  // The runtime reads args by position, decided once at definition time from
  // whether a payload was declared. Sniffing arg *types* instead would read
  // this payload as a message override.
  // A zero-parameter message fn declares no payload, so TData stays void and
  // the sole call argument is a message override — not details. Treating every
  // function message as a payload variant would silently produce
  // `details: 'Custom'` here.
  it('treats a zero-parameter message function as a no-payload variant', () => {
    const timeout = defineError('timeout', () => 'Timed out');

    expectTypeOf<ReturnType<typeof timeout>>().toEqualTypeOf<
      TypedError<'timeout', never>
    >();
    expect(timeout()).toEqual({ type: 'timeout', message: 'Timed out' });
    expect(timeout('Custom')).toEqual({ type: 'timeout', message: 'Custom' });
  });

  it('handles a variant whose payload is itself a string', () => {
    const parseFailed = defineError.withData<string>()('parse_failed', 'Bad input');

    expect(parseFailed('{{')).toEqual({
      type: 'parse_failed',
      message: 'Bad input',
      details: '{{',
    });
    expect(parseFailed('{{', 'Override').message).toBe('Override');
  });
});

describe('defineError — message', () => {
  // §3.1 behaviour 3: always required at definition, no silent fallback to the
  // type string. This is what keeps §3's guaranteed-message invariant true.
  it('is required at definition', () => {
    // @ts-expect-error — a default message is mandatory
    defineError('timeout');
  });

  it('derives the default from the payload', () => {
    expect(notFound({ id: '123' }).message).toBe('User 123 not found');
  });

  it('is overridden by a per-call argument', () => {
    expect(notFound({ id: '123' }, 'Custom message').message).toBe(
      'Custom message',
    );
    expect(forbidden('You may not').message).toBe('You may not');
  });

  it('falls back to the static default when no override is passed', () => {
    expect(forbidden().message).toBe('Access denied');
  });
});

describe('defineError — guards', () => {
  it('exposes the bound discriminant without constructing a value', () => {
    expectTypeOf(notFound.type).toEqualTypeOf<'not_found'>();
    expect(notFound.type).toBe('not_found');
  });

  it('narrows an error union by tag', () => {
    type ApiError =
      | ReturnType<typeof notFound>
      | ReturnType<typeof forbidden>;

    const handle = (e: ApiError): string => {
      if (notFound.is(e)) {
        expectTypeOf(e).toEqualTypeOf<TypedError<'not_found', { id: string }>>();
        return `404: ${e.details?.id ?? '?'}`;
      }
      expectTypeOf(e).toEqualTypeOf<TypedError<'forbidden', never>>();
      return `403: ${e.message}`;
    };

    expect(handle(notFound({ id: '1' }))).toBe('404: 1');
    expect(handle(forbidden())).toBe('403: Access denied');
  });

  // The documented limit of `.is()`: it is tag-only. Validating the payload
  // needs a schema, which this package does not ship.
  it('checks the tag only, never the payload', () => {
    expect(notFound.is({ type: 'not_found', message: 'x' })).toBe(true);
    expect(
      notFound.is({ type: 'not_found', message: 'x', details: { id: 42 } }),
    ).toBe(true);
    expect(notFound.is(forbidden())).toBe(false);
  });

  it('survives non-objects', () => {
    expect(notFound.is(null)).toBe(false);
    expect(notFound.is(undefined)).toBe(false);
    expect(notFound.is('not_found')).toBe(false);
  });
});

describe('isTypedError', () => {
  it('narrows an unknown to the base TypedError shape', () => {
    const caught: unknown = notFound({ id: '1' });

    if (isTypedError(caught)) {
      expectTypeOf(caught).toEqualTypeOf<TypedError>();
      expect(caught.type).toBe('not_found');
    } else {
      throw new Error('unreachable');
    }
  });

  // Structural, per §2's no-brand invariant: a hand-built or JSON-revived
  // object that no constructor produced still passes.
  it('accepts a hand-built object of the right shape', () => {
    expect(isTypedError({ type: 'not_found', message: 'User 1 not found' })).toBe(
      true,
    );
  });

  it('rejects anything missing a string type or message', () => {
    expect(isTypedError(null)).toBe(false);
    expect(isTypedError('not_found')).toBe(false);
    expect(isTypedError({ type: 'not_found' })).toBe(false);
    expect(isTypedError({ message: 'boom' })).toBe(false);
    expect(isTypedError({ type: 1, message: 'boom' })).toBe(false);
    expect(isTypedError(new Error('boom'))).toBe(false);
  });

  it('accepts an absent details', () => {
    expect(isTypedError(forbidden())).toBe(true);
  });

  // The guard narrows to the base TypedError, whose TData defaults to
  // Record<string, unknown>. A null or array details would make that a lie.
  it('rejects a details that is not a Record', () => {
    expect(isTypedError({ type: 'x', message: 'boom', details: null })).toBe(
      false,
    );
    expect(isTypedError({ type: 'x', message: 'boom', details: [1, 2] })).toBe(
      false,
    );
    expect(isTypedError({ type: 'x', message: 'boom', details: 'raw' })).toBe(
      false,
    );
  });
});

describe('the cut v1 helpers', () => {
  it('does not export TypedErrorOf or TypedErrorUnion', async () => {
    const surface = await import('../../src/index');

    expect(Object.keys(surface)).not.toContain('TypedErrorOf');
    expect(Object.keys(surface)).not.toContain('TypedErrorUnion');
  });
});

describe('serialization', () => {
  // §2.1: a TypedError in the error channel round-trips as a value, with no
  // re-wrapping on the far side.
  it('round-trips a produced error through JSON inside a Result', () => {
    const before = err(notFound({ id: '123' }));
    const after = JSON.parse(JSON.stringify(before)) as typeof before;

    expect(after).toEqual(before);
    expect(after.error.details?.id).toBe('123');
  });

  // §2.1 carve-out: `cause` is outside the guarantee, and stripping it is the
  // caller's call. The core must not quietly do it for them — that would drop
  // data the caller deliberately attached.
  it('never auto-strips cause from error data', () => {
    const cause = new Error('socket hang up');
    const withCause: TypedError<'not_found', { id: string }> = {
      ...notFound({ id: '123' }),
      cause,
    };

    const result = err(withCause);
    expect(result.error.cause).toBe(cause);
  });
});

/**
 * §10.9. Two guards were narrower or broader than the type they publish — the
 * same invariant §10.8 derived for `isThenable`, found in a pre-freeze retro.
 */
describe('the guards against the shapes their own types admit (#36 retro)', () => {
  it('isTypedError accepts a callable TypedError, which the type admits', () => {
    // A function carrying `type` and `message` is a structurally valid
    // TypedError — tsc assigns it without complaint — but `typeof x !== 'object'`
    // rejected it, and unwrapOrThrow then discarded its real message.
    const callable = Object.assign((n: number) => n + 1, {
      type: 'rate_limited',
      message: 'slow down, please',
    });

    expect(isTypedError(callable)).toBe(true);
  });

  it('isTypedError still rejects a function with no type or message', () => {
    expect(isTypedError(() => 'plain')).toBe(false);
  });

  it('unwrapOrThrow surfaces a callable TypedError message rather than the fallback', () => {
    const callable = Object.assign((n: number) => n + 1, {
      type: 'rate_limited',
      message: 'slow down, please',
    });

    expect(() => unwrapOrThrow(err(callable))).toThrow('slow down, please');
  });

  it('ErrorCtor.is rejects a tag-only object, whose message the predicate guarantees', () => {
    // `.is()` narrows to TypedError, whose `message: string` is required. A
    // tag-only object passed, so `e.message` was `undefined` under a guard
    // promising a string.
    const notFound = defineError('not_found', 'not found');

    expect(notFound.is({ type: 'not_found' })).toBe(false);
  });

  it('ErrorCtor.is accepts a callable variant, matching isTypedError', () => {
    // `.is()` got two changes and only the `message` half was pinned; reverting
    // the function-admit left the whole suite green.
    const rateLimited = defineError('rate_limited', 'slow down');
    const callable = Object.assign((n: number) => n + 1, {
      type: 'rate_limited',
      message: 'slow down, please',
    });

    expect(rateLimited.is(callable)).toBe(true);
  });

  it('ErrorCtor.is still accepts a well-formed variant', () => {
    const notFound = defineError('not_found', 'not found');

    expect(notFound.is(notFound())).toBe(true);
  });
});
