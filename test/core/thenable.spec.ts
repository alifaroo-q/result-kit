import { describe, expect, it } from 'vitest';

import { isThenable } from '../../src/core/thenable';

/**
 * `isThenable` is internal — not in §5.9's export list and never re-exported
 * from the barrel — so this imports the module directly rather than the index.
 *
 * §10.6 made *the check itself* the decision, which is why it has exactly one
 * definition and its own suite. What follows pins both halves of that decision:
 * the cross-realm hole it closes, and the non-promise-thenable price it
 * knowingly pays (§10.7).
 */
describe('isThenable', () => {
  it('accepts a native promise', () => {
    expect(isThenable(Promise.resolve(1))).toBe(true);
  });

  it('rejects a plain object with no then', () => {
    expect(isThenable({ ok: true, value: 1 })).toBe(false);
  });

  it('rejects null without throwing on the property read', () => {
    expect(isThenable(null)).toBe(false);
  });

  it('rejects a then that is present but not callable', () => {
    expect(isThenable({ then: 'not a function' })).toBe(false);
  });

  it('accepts a hand-written PromiseLike, which a native brand check would reject', () => {
    // ResultAsync (§6.2) is exactly this shape: a class implementing
    // PromiseLike, not a native promise. It is the reason the check cannot be
    // narrowed to a native-promise brand — see the note on isThenable.
    const promiseLike: PromiseLike<number> = {
      then: (onFulfilled) => Promise.resolve(1).then(onFulfilled),
    };

    expect(isThenable(promiseLike)).toBe(true);
  });

  /**
   * A **callable** thenable — a function carrying a `then`. §10.6's check tested
   * `typeof x === 'object'` and so disowned it, which is the same failure that
   * section was written to eliminate: the value takes the plain-`Result` path
   * and the caller gets a `Result<string>` actually holding a function.
   *
   * The language assimilates it (`await` unwraps it), and the Promises/A+
   * resolution procedure says "if `x` is an object **or function**". Rare, but
   * curried/deferred builders and some RPC proxies are exactly this shape.
   */
  it('accepts a callable thenable, which the language assimilates', () => {
    const callable = Object.assign(function deferred() {}, {
      then(resolve: (v: string) => void) {
        resolve('from-callable');
      },
    });

    expect(isThenable(callable)).toBe(true);
  });

  it('rejects an ordinary function with no then', () => {
    expect(isThenable(() => 'plain')).toBe(false);
  });

  /**
   * KNOWN LIMITATION, pinned deliberately (§10.7). This asserts the *decision*,
   * not the deadlock: a test that waited on the hang could only ever observe a
   * timeout, and a timeout cannot distinguish "never settles" from "slow" —
   * which is the same undecidability that makes the bug unfixable.
   */
  it('accepts a non-promise object with a callable then, as the language does', () => {
    const builder = {
      tag: 'builder',
      then(_next: unknown) {
        return this;
      },
    };

    // Promise.resolve would assimilate this and never settle, because its `then`
    // never invokes the callback. `await builder` hangs identically with no
    // library involved: PromiseResolveThenableJob branches only on
    // IsCallable(then). Narrowing this to exclude it would also exclude the
    // PromiseLike case above.
    expect(isThenable(builder)).toBe(true);
  });
});
