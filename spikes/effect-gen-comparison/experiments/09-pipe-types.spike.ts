/**
 * Experiment 09 — what the overload tower actually infers.
 *
 * Every assertion here is enforced by the spike's own `tsc --noEmit`, not by
 * vitest: `expectTypeOf` is a runtime no-op under `vitest run`, and
 * `@ts-expect-error` only bites under `tsc` (it reports an *unused* directive
 * when the expected error does not occur, so each one is a two-sided pin).
 *
 * Reference: `effect@4.0.0-beta.104` `packages/effect/src/Function.ts`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  andThen,
  err,
  map,
  ok,
  type Result,
} from '../../../src/index.ts';
import { flow, pipe } from './07-pipe-candidate.spike.ts';

interface BadInput {
  readonly type: 'bad_input';
  readonly message: string;
}
interface OverLimit {
  readonly type: 'over_limit';
  readonly message: string;
}
interface NetworkDown {
  readonly type: 'network_down';
  readonly message: string;
}

const parse = (raw: string): Result<number, BadInput> =>
  Number.isInteger(Number(raw))
    ? ok(Number(raw))
    : err({ type: 'bad_input', message: 'nope' });

const checkLimit = (n: number): Result<number, OverLimit> =>
  n <= 10 ? ok(n) : err({ type: 'over_limit', message: 'nope' });

const reserve = async (n: number): Promise<Result<string, NetworkDown>> =>
  ok(`r-${n}`);

const label = (n: number): string => `#${n}`;

describe('inference through the tower', () => {
  it('threads each step and ACCUMULATES the error union — parity with the shipped surfaces', () => {
    const out = pipe(
      parse('3'),
      (r) => andThen(r, checkLimit),
      (r) => map(r, label),
    );
    expectTypeOf(out).toEqualTypeOf<Result<string, BadInput | OverLimit>>();
  });

  it('infers each lambda parameter with no annotation — the contextual type flows left to right', () => {
    pipe(
      parse('3'),
      (r) => {
        expectTypeOf(r).toEqualTypeOf<Result<number, BadInput>>();
        return andThen(r, checkLimit);
      },
      (r) => {
        expectTypeOf(r).toEqualTypeOf<Result<number, BadInput | OverLimit>>();
        return map(r, label);
      },
    );
  });

  it('carries the sync→async seam in the types: everything after Promise.resolve is a Promise', () => {
    const out = pipe(
      parse('3'),
      (r) => Promise.resolve(r),
      (r) => {
        expectTypeOf(r).toEqualTypeOf<Promise<Result<number, BadInput>>>();
        return andThen(r, reserve);
      },
    );
    expectTypeOf(out).toEqualTypeOf<Promise<Result<string, BadInput | NetworkDown>>>();
  });
});

describe('§10.9 is preserved — pipe does not reopen the seam hole', () => {
  it('rejects a settled Result fed an async callback, exactly as a direct call does', () => {
    // The lambda body IS a direct `andThen` call, so the rule is enforced by
    // `andThen`'s own overloads. `pipe` is a pass-through here: it can neither
    // strengthen nor weaken §10.9, which is the most important safety fact
    // about it.
    pipe(parse('3'), (r) =>
      // @ts-expect-error — settled input + async callback: no overload.
      andThen(r, reserve),
    );

    // @ts-expect-error — and identically, with no pipe involved at all.
    andThen(parse('3'), reserve);
  });
});

describe('the tower has a hard edge, and it is a cliff not a slope', () => {
  it('errors on arity AND drops the overflow lambda to implicit any', () => {
    const step = (r: Result<number, BadInput>) => r;
    pipe(
      parse('3'),
      step, step, step, step, step, step, step, step,
      // @ts-expect-error — 10 arguments: `Expected 1-9 arguments, but got 10`.
      step,
    );

    pipe(
      parse('3'),
      step, step, step, step, step, step, step, step,
      // @ts-expect-error — the SECOND error on the same call: past the last
      // arm there is no contextual type, so an inline lambda's parameter is an
      // implicit `any`. The cliff costs inference, not just arity.
      (r) => r,
    );
  });

  it('the workaround is nesting, which is exactly the shape pipe existed to remove', () => {
    const step = (r: Result<number, BadInput>) => r;
    const out = pipe(
      pipe(parse('3'), step, step, step, step, step, step, step, step),
      step,
    );
    expectTypeOf(out).toEqualTypeOf<Result<number, BadInput>>();
  });
});

describe("flow's fate: a step cannot be factored out without annotating it", () => {
  it('an un-annotated reusable step is an implicit any — there is no contextual type off-site', () => {
    // @ts-expect-error — `r` implicitly has an 'any' type.
    const reusable = (r) => map(r, label);
    void reusable;
  });

  it('an annotated one works, and is as long as the call it replaces', () => {
    // The annotation is the entire cost. `dual` is what makes Effect's
    // `Array.map(double)` both reusable AND short; without it the data-first
    // step must restate its own input type.
    const step = <E>(r: Result<number, E>) => map(r, label);
    const out = pipe(parse('3'), step);
    expectTypeOf(out).toEqualTypeOf<Result<string, BadInput>>();
  });

  it('flow composes the same annotated lambdas — and buys nothing pipe did not already give', () => {
    const toLabel = <E>(r: Result<number, E>) => map(r, label);

    const viaFlow = flow(parse, (r) => andThen(r, checkLimit), toLabel);
    const viaLambda = (raw: string) =>
      pipe(
        parse(raw),
        (r) => andThen(r, checkLimit),
        toLabel,
      );

    expectTypeOf(viaFlow).toEqualTypeOf<
      (raw: string) => Result<string, BadInput | OverLimit>
    >();
    expectTypeOf(viaFlow).toEqualTypeOf<typeof viaLambda>();
  });

  it('flow only ever wins on the FIRST function — the one place pipe cannot start from a function', () => {
    // This is flow's whole remaining claim: `flow(f, g)` vs `(x) => pipe(f(x), g)`.
    // Nine characters, one extra lambda, and one import.
    const viaFlow = flow(parse, (r) => map(r, label));
    const viaPipe = (raw: string) => pipe(parse(raw), (r) => map(r, label));
    expectTypeOf(viaFlow).toEqualTypeOf<typeof viaPipe>();
  });

  it('multi-argument first functions work, which is the only structural thing flow adds', () => {
    const parseWithin = (raw: string, limit: number): Result<number, BadInput> =>
      Number(raw) <= limit ? parse(raw) : err({ type: 'bad_input', message: 'x' });

    const f = flow(parseWithin, (r) => map(r, label));
    expectTypeOf(f).toEqualTypeOf<
      (raw: string, limit: number) => Result<string, BadInput>
    >();
  });
});

describe('diagnostics: pipe is neutral, the noise is the callee overload tower', () => {
  it('the same mistake reports the same (poor) message with and without pipe', () => {
    // Both report: `No overload matches this call. The last overload gave …
    // Argument of type 'Result<number, BadInput>' is not assignable to
    // parameter of type 'PromiseLike<Result<string, never>>'` — a thenable
    // complaint for what is really `number` vs `string`. That message comes
    // from `map`'s own three arms; pipe neither causes nor worsens it.
    pipe(parse('3'), (r) =>
      // @ts-expect-error — `n` is a number, not a string.
      map(r, (n: string) => n.length),
    );

    // @ts-expect-error — identical mistake, identical message, no pipe.
    map(parse('3'), (n: string) => n.length);
  });

  it('a mid-chain mistake is reported AT the offending lambda, not at the whole call', () => {
    // Step 8 of 9 — the error lands on line-of-step-8. The tower does not
    // collapse the diagnostic to the outer `pipe(` the way a single variadic
    // signature would.
    const step = <E>(r: Result<number, E>) => map(r, (n) => n + 1);
    pipe(
      parse('3'),
      step, step, step, step, step, step,
      (r) =>
        // @ts-expect-error — reported here, at step 8.
        map(r, (n: string) => n.length),
    );
  });

  it('BUT a step returning a non-Result is reported one step DOWNSTREAM', () => {
    // The off-by-one: the offending step type-checks fine on its own (a lambda
    // may return anything), so the complaint surfaces at its consumer.
    pipe(
      parse('3'),
      (r) => map(r, label),
      () => 42,
      (r) =>
        // @ts-expect-error — blamed here; the mistake is the line above.
        map(r, label),
    );
  });
});
