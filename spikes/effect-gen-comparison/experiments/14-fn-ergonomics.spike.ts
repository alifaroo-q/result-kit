/**
 * Experiment 14 — `Effect.fn`: which of its four jobs transfer? (issue #85)
 *
 * `Effect.fn` bundles four things into one export:
 *
 *   1. a tracing span, when called in the named form `Effect.fn("name")(body)`
 *   2. stack-frame capture at the definition site, for better traces
 *   3. `{ self }` — binding `this` for a generator body that declares one
 *   4. trailing `pipe`-style transforms over the returned Effect
 *
 * (1), (2) and (4) are measured here only to confirm what they need; the live
 * question is (3), because it is the one thing that is about *generator bodies*
 * rather than about the effect runtime. A `function*` cannot be an arrow, so a
 * do-block written inside a class method loses `this` — a real gap that has
 * nothing to do with effects.
 *
 * The question for us: does `safeTry` need a `{ self }` option?
 */
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { ok, safeTry, safeUnwrap } from '../../../src/index.ts';
import type { Err, Result } from '../../../src/index.ts';

interface Row {
  readonly credit: number;
}

describe('A: what Effect.fn does that needs a runtime', () => {
  it('the named form creates a span — which needs a tracer, i.e. a runtime', () => {
    const f = Effect.fn('calculateLength')(function* (value: string) {
      return yield* Effect.succeed(value.length);
    });

    // The span is only observable when the effect is *run* by a runtime that
    // carries a Tracer. There is no equivalent seam in this package: `safeTry`
    // is eager and returns data, so there is nothing between definition and
    // execution for a span to wrap.
    expect(Effect.runSync(f('hello'))).toBe(5);
  });

  it('the transform form is `pipe`, which the spike already declined (F9-F13)', () => {
    const f = Effect.fn('formatLength')(
      function* (value: string) {
        return yield* Effect.succeed(value.length);
      },
      (effect, value) => effect.pipe(Effect.map((n) => `${value}: ${n}`)),
    );

    expect(Effect.runSync(f('hello'))).toBe('hello: 5');
  });
});

describe('B: the `this` gap — does it exist for safeTry, and is it already solved?', () => {
  const load = (id: string): Result<Row, string> =>
    id === 'u1' ? ok({ credit: 10 }) : ok({ credit: 0 });

  it('a bare function* body genuinely loses `this` (the gap is real)', () => {
    class Service {
      readonly bonus = 5;

      total(id: string): Result<number, string> {
        return safeTry(function* (this: unknown) {
          const row = yield* safeUnwrap(load(id));

          // `this` inside a `function*` is not the instance. Reading `.bonus`
          // off it throws in strict mode (ESM is always strict).
          return ok(row.credit + (this as unknown as Service).bonus);
        });
      }
    }

    expect(() => new Service().total('u1')).toThrow(TypeError);
  });

  it('the thunk shape already solves it: an arrow captures `this` lexically', () => {
    class Service {
      readonly bonus = 5;

      total(id: string): Result<number, string> {
        // `safeTry` takes a *thunk*, so the caller writes the enclosing
        // function — and an arrow is a legal thunk even though a generator
        // cannot be an arrow. `this` is lexical before the body is entered.
        return safeTry(() => this.#body(id));
      }

      *#body(id: string): Generator<Err<string>, Result<number, string>> {
        const row = yield* safeUnwrap(load(id));

        return ok(row.credit + this.bonus);
      }
    }

    expect(new Service().total('u1')).toEqual(ok(15));
  });

  it('`.bind(this)` works too, with no helper method', () => {
    class Service {
      readonly bonus = 5;

      total(id: string): Result<number, string> {
        return safeTry(
          function* (this: Service): Generator<Err<string>, Result<number, string>> {
            const row = yield* safeUnwrap(load(id));

            return ok(row.credit + this.bonus);
          }.bind(this),
        );
      }
    }

    expect(new Service().total('u1')).toEqual(ok(15));
  });

  it('so does the plain `const self = this` a JS author already knows', () => {
    class Service {
      readonly bonus = 5;

      total(id: string): Result<number, string> {
        const self = this;

        return safeTry(function* () {
          const row = yield* safeUnwrap(load(id));

          return ok(row.credit + self.bonus);
        });
      }
    }

    expect(new Service().total('u1')).toEqual(ok(15));
  });
});

describe('C: why Effect needs {self} and we do not — the shapes differ', () => {
  it('Effect.fn returns an argument-taking function; safeTry returns the answer', () => {
    // `Effect.fn(body)` builds a *reusable function of the body's arguments*,
    // so the body is handed to the combinator and there is no enclosing
    // caller-authored function for `this` to be lexical in — hence `{ self }`.
    const f = Effect.fn(function* (value: number) {
      return yield* Effect.succeed(value + 1);
    });

    expect(Effect.runSync(f(1))).toBe(2);

    // `safeTry(body)` runs *now* and returns the Result. The caller always
    // writes the enclosing function themselves (the method, the arrow, the
    // exported const), which is exactly where `this` already is.
    const total = safeTry(function* () {
      const one = yield* safeUnwrap(ok(1));

      return ok(one + 1);
    });

    expect(total).toEqual(ok(2));
  });
});
