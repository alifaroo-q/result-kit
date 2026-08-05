import { describe, expect, it } from 'vitest';

import { defineError, err, ok } from '../../src/index';
import { resultMatchers } from '../../src/testing/index';

expect.extend(resultMatchers);

const notFound = defineError(
  'not_found',
  (d: { id: string }) => `User ${d.id} not found`,
);

describe('toBeOk', () => {
  it('toBeOk_okResult_passes', () => {
    expect(ok(42)).toBeOk();
  });

  it('toBeOk_errResult_failsWithTheExpectOkMessage', () => {
    // The message is *delegated*, not authored in the matcher — this pins that.
    expect(() => expect(err('boom')).toBeOk()).toThrow(
      'Expected Ok, got Err: "boom"',
    );
  });

  it('toBeOk_negatedOnErr_passes', () => {
    expect(err('boom')).not.toBeOk();
  });

  it('toBeOk_negatedOnOk_failsWithTheExpectErrMessage', () => {
    expect(() => expect(ok(42)).not.toBeOk()).toThrow(
      'Expected Err, got Ok: 42',
    );
  });

  it('toBeOk_okVoidRoundTrippedThroughJson_passes', () => {
    // §2.1: `ok()` serializes to `{"ok":true}` — the `value` key is dropped.
    // The structural check must not require it.
    const roundTripped: unknown = JSON.parse(JSON.stringify(ok()));

    expect(roundTripped).toBeOk();
  });
});

describe('toBeErr', () => {
  it('toBeErr_errResult_passes', () => {
    expect(err('boom')).toBeErr();
  });

  it('toBeErr_okResult_failsWithTheExpectErrMessage', () => {
    expect(() => expect(ok(42)).toBeErr()).toThrow('Expected Err, got Ok: 42');
  });

  it('toBeErr_negatedOnOk_passes', () => {
    expect(ok(42)).not.toBeErr();
  });

  it('toBeErr_negatedOnErr_failsWithTheExpectOkMessage', () => {
    expect(() => expect(err('boom')).not.toBeErr()).toThrow(
      'Expected Ok, got Err: "boom"',
    );
  });
});

describe('toBeOkWith', () => {
  it('toBeOkWith_matchingValue_passes', () => {
    expect(ok({ id: 'u1', name: 'Ada' })).toBeOkWith({ id: 'u1', name: 'Ada' });
  });

  it('toBeOkWith_differentValue_failsNamingBothSides', () => {
    expect(() => expect(ok({ id: 'u1' })).toBeOkWith({ id: 'u2' })).toThrow(
      /Expected Ok to equal/,
    );
  });

  it('toBeOkWith_errResult_failsWithTheExpectOkMessage', () => {
    // The wrong-branch failure is the common one, so it gets the rich message
    // rather than a value diff against an error.
    expect(() => expect(err('boom')).toBeOkWith(42)).toThrow(
      'Expected Ok, got Err: "boom"',
    );
  });

  it('toBeOkWith_asymmetricMatcher_passesOnPartialMatch', () => {
    // Subset matching is vitest's job, not a third semantic in the matcher.
    expect(ok({ id: 'u1', name: 'Ada' })).toBeOkWith(
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('toBeOkWith_negatedOnDifferentValue_passes', () => {
    expect(ok(1)).not.toBeOkWith(2);
  });
});

describe('toBeErrWith', () => {
  it('toBeErrWith_matchingError_passes', () => {
    expect(err(notFound({ id: 'u1' }))).toBeErrWith(notFound({ id: 'u1' }));
  });

  it('toBeErrWith_differentError_failsNamingBothSides', () => {
    expect(() =>
      expect(err(notFound({ id: 'u1' }))).toBeErrWith(notFound({ id: 'u2' })),
    ).toThrow(/Expected Err to equal/);
  });

  it('toBeErrWith_okResult_failsWithTheExpectErrMessage', () => {
    expect(() => expect(ok(42)).toBeErrWith('boom')).toThrow(
      'Expected Err, got Ok: 42',
    );
  });

  it('toBeErrWith_asymmetricMatcherOnTag_passesIgnoringPayload', () => {
    expect(err(notFound({ id: 'u1' }))).toBeErrWith(
      expect.objectContaining({ type: 'not_found' }),
    );
  });

  it('toBeErrWith_negatedOnDifferentError_passes', () => {
    expect(err('boom')).not.toBeErrWith('bang');
  });
});

describe('a subject that is not a Result', () => {
  // A usage error, not an assertion outcome. `pass: false` would make the
  // negated form *succeed* on a subject the matcher never understood.
  const notResults: [label: string, subject: unknown][] = [
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', { value: 1 }],
    ['a non-boolean ok', { ok: 'yes', value: 1 }],
    ['an array', [1, 2]],
  ];

  it.each(notResults)('toBeOk_%s_throws', (_label, subject) => {
    expect(() => expect(subject).toBeOk()).toThrow(/expected a Result/);
  });

  it('toBeOk_negatedOnANonResult_stillThrows', () => {
    expect(() => expect(42).not.toBeOk()).toThrow(/expected a Result/);
  });

  it('toBeErrWith_nonResult_throwsNamingTheMatcher', () => {
    expect(() => expect(42).toBeErrWith('boom')).toThrow(/^toBeErrWith:/);
  });
});

describe('the matcher bag', () => {
  it('resultMatchers_exposesExactlyTheFourMatchers', () => {
    expect(Object.keys(resultMatchers).sort()).toEqual([
      'toBeErr',
      'toBeErrWith',
      'toBeOk',
      'toBeOkWith',
    ]);
  });
});
