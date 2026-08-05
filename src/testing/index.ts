/**
 * Vitest matchers for {@link Result} — the `/testing` subpath
 * ([ADR 0011](../../docs/adr/0011-testing-subpath-matchers.md) Option A, unblocked by
 * [ADR 0014](../../docs/adr/0014-peer-dependency-policy-and-lint-package-layout.md)).
 *
 * **This module imports nothing from `vitest` at runtime** — only its types, in
 * `import type` position, erased by `verbatimModuleSyntax`. That is what makes
 * the `vitest` peer genuinely *optional* rather than optional-on-paper: the
 * emitted `dist/testing/index.js` has no `vitest` specifier in it at all, so
 * nothing resolves it unless the consumer's own setup file already imports
 * `expect` — which it must, to call {@link resultMatchers} into `expect.extend`.
 * `test/testing/boundary.spec.ts` asserts that on the built chunk.
 *
 * **Registration is explicit, not a side effect of importing.** The manifest
 * declares `"sideEffects": false` (spec §7.2), so an auto-registering module
 * would be a bundler-droppable import — the failure mode being a matcher that
 * silently is not there. One line in a setup file instead:
 *
 * ```ts
 * // vitest.setup.ts
 * import { expect } from 'vitest';
 * import { resultMatchers } from '@zireal/result-kit/testing';
 *
 * expect.extend(resultMatchers);
 * ```
 *
 * **The matchers do not narrow, and cannot.** A vitest matcher's return type
 * says nothing about its subject, so `expect(r).toBeOk()` leaves `r` a
 * `Result<T, E>`; reading `.value` afterwards still needs {@link expectOk}.
 * That is the division of labour, not a gap: the matchers are for *asserting*,
 * `expectOk` / `expectErr` are for *extracting*, and the matchers delegate to
 * them for every failure message so there is one wording to maintain.
 */

import type { MatcherState } from 'vitest';

import { expectErr, expectOk } from '../core/assertions';
import { isOk } from '../core/result';
import type { Result } from '../core/result';

/**
 * What a matcher hands back.
 *
 * Spelled out here rather than imported: vitest re-exports the *union*
 * (`MatcherResult`, sync-or-async) but not `SyncExpectationResult` itself, and
 * every matcher below is synchronous. This is structurally assignable to what
 * `expect.extend` wants.
 */
type MatcherOutcome = {
  pass: boolean;
  message: () => string;
  actual?: unknown;
  expected?: unknown;
};

/**
 * The message an assertion throws.
 *
 * Callers pass the branch that is **guaranteed** to throw — `expectErr` on a
 * known `Ok`, `expectOk` on a known `Err` — which is what lets every message
 * below be delegated rather than authored. When
 * [#67](https://github.com/alifaroo-q/result-kit/issues/67) enriches
 * `expectOk` / `expectErr` with `prettifyErrors` output, these matchers inherit
 * it with no edit here.
 */
function thrownMessage(assertion: () => unknown): string {
  try {
    assertion();
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }

  // Reachable only when a caller pairs the wrong assertion with the branch it
  // is on — which is not hypothetical: that is exactly the bug `toBeErr`
  // shipped with, and returning `''` here is what made it *silent*. An empty
  // message still satisfies `toThrow()`, so the suite stayed green while every
  // `toBeErr` failure reported nothing. Throwing turns the same mistake into a
  // loud one. Left uncovered on purpose: reaching it means the invariant above
  // is already broken.
  throw new Error(
    'result-kit/testing: internal invariant — a matcher paired a non-throwing ' +
      'assertion with its branch, which would have produced an empty failure message.',
  );
}

/**
 * Structural `Result` check, per spec §2 — the union is brandless, so this is
 * all there is to ask.
 *
 * It does **not** require the `value` / `error` key, deliberately. `ok()`
 * produces `{ ok: true, value: undefined }`, which JSON round-trips to
 * `{ ok: true }` — and §2.1 promises that round-trip yields a usable `Result`.
 * A presence check would reject exactly the value the guarantee is about.
 *
 * A callable is admitted for the same reason §10.9 widened `isTypedError`: a
 * function carrying `ok: true` is structurally an `Ok` and tsc assigns it, so a
 * guard that rejected it would be narrower than the type it gates.
 */
function isResultLike(x: unknown): x is Result<unknown, unknown> {
  return (
    (typeof x === 'object' || typeof x === 'function') &&
    x !== null &&
    typeof (x as { ok?: unknown }).ok === 'boolean'
  );
}

/**
 * **Throws** rather than returning `pass: false` when handed a non-`Result`.
 *
 * "This is not a `Result`" is a usage error, not an assertion outcome, and the
 * distinction is load-bearing under `.not`: a `pass: false` would make
 * `expect(42).not.toBeOk()` *succeed*, quietly reporting green about a subject
 * the matcher never understood. A throw fails in both directions.
 */
function asResult(
  received: unknown,
  matcher: string,
): Result<unknown, unknown> {
  if (!isResultLike(received)) {
    throw new TypeError(
      `${matcher}: expected a Result — an object with a boolean \`ok\` — but received ${render(received)}`,
    );
  }

  return received;
}

/**
 * A rendering of the subject that **cannot itself throw**.
 *
 * `JSON.stringify` throws on two shapes a real caller reaches this guard with:
 * a circular object (a model with back-references, a DOM node) and a `BigInt`
 * id. Both surfaced a raw `TypeError: Converting circular structure to JSON`
 * in place of the guard's own message — the diagnostic replaced by a worse one,
 * at exactly the moment the caller is already confused about what they passed.
 * Found by test, not by review.
 *
 * `undefined` needs the `??` for a different reason: `JSON.stringify` returns
 * `undefined` rather than a string for it, and `"received undefined"` is the
 * useful thing to say.
 *
 * The last resort is `Object.prototype.toString`, not `String`, because
 * `String(Symbol())` throws too — so a `String` fallback would reintroduce the
 * same class of failure one level down.
 */
function render(received: unknown): string {
  try {
    return JSON.stringify(received) ?? String(received);
  } catch {
    return Object.prototype.toString.call(received);
  }
}

/**
 * The branch matchers, `toBeOk` / `toBeErr`.
 *
 * `message()` is called on a plain failure **and** on a `.not` failure, and the
 * two wordings are exactly what `expectOk` and `expectErr` already throw — so
 * the pair is chosen by which side passed, and neither string is written here.
 * It stays lazy because the delegated messages `JSON.stringify` their payload,
 * which must not be paid by every passing assertion.
 */
function branch(
  received: unknown,
  matcher: 'toBeOk' | 'toBeErr',
): MatcherOutcome {
  const result = asResult(received, matcher);
  const wantOk = matcher === 'toBeOk';
  const pass = isOk(result) === wantOk;

  // On a plain failure the wanted assertion is the one that throws; on a `.not`
  // failure it is the opposite. Picking by `pass` alone was wrong for `toBeErr`
  // in both directions — it produced an empty message, caught by
  // `toBeErr_okResult_failsWithTheExpectErrMessage`.
  const wanted = wantOk ? expectOk : expectErr;
  const opposite = wantOk ? expectErr : expectOk;

  return {
    pass,
    message: () => thrownMessage(() => (pass ? opposite : wanted)(result)),
  };
}

/**
 * The payload matchers, `toBeOkWith` / `toBeErrWith`.
 *
 * Both are **deep equality**, not subset matching, and symmetric on purpose:
 * one semantic to remember rather than two. Partial matching is vitest's own
 * job — `this.equals` resolves asymmetric matchers, so
 * `toBeErrWith(expect.objectContaining({ type: 'not_found' }))` works without a
 * third semantic in this file.
 *
 * On the **wrong branch** the message delegates to `expectOk`/`expectErr` — the
 * rich one, and the common failure. Only the right-branch-wrong-payload case
 * gets a message authored here, and it hands `actual`/`expected` back so vitest
 * renders its own diff.
 */
function payload(
  this: MatcherState,
  received: unknown,
  expected: unknown,
  matcher: 'toBeOkWith' | 'toBeErrWith',
): MatcherOutcome {
  const result = asResult(received, matcher);
  const wantOk = matcher === 'toBeOkWith';
  const onBranch = isOk(result) === wantOk;

  if (!onBranch) {
    return {
      pass: false,
      message: () => thrownMessage(() => (wantOk ? expectOk : expectErr)(result)),
    };
  }

  const actual = isOk(result) ? result.value : result.error;
  const pass = this.equals(actual, expected, [
    ...this.customTesters,
    this.utils.iterableEquality,
  ]);
  const half = wantOk ? 'Ok' : 'Err';

  return {
    pass,
    actual,
    expected,
    message: () =>
      `${this.utils.matcherHint(matcher, 'result', 'expected', { isNot: this.isNot })}\n\n` +
      `Expected ${half}${this.isNot ? ' not' : ''} to equal:\n` +
      `  ${this.utils.printExpected(expected)}\n` +
      `Received ${half}:\n` +
      `  ${this.utils.printReceived(actual)}`,
  };
}

/**
 * The matcher bag to hand to `expect.extend`.
 *
 * ```ts
 * import { expect } from 'vitest';
 * import { resultMatchers } from '@zireal/result-kit/testing';
 *
 * expect.extend(resultMatchers);
 *
 * expect(await findUser('u1')).toBeOk();
 * expect(await findUser('u1')).toBeOkWith({ id: 'u1', name: 'Ada' });
 * expect(await findUser('nope')).toBeErr();
 * expect(await findUser('nope')).toBeErrWith(notFound({ id: 'nope' }));
 * expect(await findUser('nope')).toBeErrWith(
 *   expect.objectContaining({ type: 'not_found' }),
 * );
 * ```
 */
export const resultMatchers = {
  /** Asserts the subject is an `Ok`, whatever it carries. */
  toBeOk(this: MatcherState, received: unknown): MatcherOutcome {
    return branch(received, 'toBeOk');
  },

  /** Asserts the subject is an `Ok` whose `value` deep-equals `expected`. */
  toBeOkWith(
    this: MatcherState,
    received: unknown,
    expected: unknown,
  ): MatcherOutcome {
    return payload.call(this, received, expected, 'toBeOkWith');
  },

  /** Asserts the subject is an `Err`, whatever it carries. */
  toBeErr(this: MatcherState, received: unknown): MatcherOutcome {
    return branch(received, 'toBeErr');
  },

  /** Asserts the subject is an `Err` whose `error` deep-equals `expected`. */
  toBeErrWith(
    this: MatcherState,
    received: unknown,
    expected: unknown,
  ): MatcherOutcome {
    return payload.call(this, received, expected, 'toBeErrWith');
  },
};

/**
 * The ambient half of the subpath.
 *
 * Augmenting `vitest`'s `Matchers<T>` is what puts `toBeOk` on `expect(...)`
 * for the type checker; without it the runtime matcher exists and the call does
 * not compile. It rides along with any import from this module, so a consumer
 * who imports {@link resultMatchers} in their setup file needs no `/// <reference>`.
 *
 * The type parameter list must repeat vitest's own — same name, same `any`
 * default — or the interfaces do not merge.
 */
declare module 'vitest' {
  interface Matchers<T = any> {
    toBeOk(): void;
    toBeOkWith(expected: unknown): void;
    toBeErr(): void;
    toBeErrWith(expected: unknown): void;
  }
}
