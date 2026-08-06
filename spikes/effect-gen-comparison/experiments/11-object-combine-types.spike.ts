/**
 * Experiment 11 — what the tuple+record candidates actually infer.
 *
 * Every assertion here is enforced by the spike's own `tsc --noEmit`, not by
 * vitest: `expectTypeOf` is a runtime no-op under `vitest run`, and
 * `@ts-expect-error` only bites under `tsc` (it reports an *unused* directive
 * when the expected error does not occur, so each one is a two-sided pin).
 *
 * The load-bearing question is **degradation**: §5.4 promises tuple
 * preservation, and the whole point of the ticket is whether a record form can
 * be added without weakening it. So every array-side assertion below is written
 * against the SHIPPED `combine` first, then repeated against each candidate.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { combine, combineWithAllErrors, err, ok, type Result } from '../../../src/index.ts';
import {
  cwaeEntries,
  cwaeFlat,
  cwaeRecord,
  combineOverloaded,
  combineUnified,
  type ResultRecord,
} from './10-object-combine.spike.ts';

interface NotFound {
  readonly type: 'not_found';
  readonly message: string;
}
interface Timeout {
  readonly type: 'timeout';
  readonly message: string;
}

/**
 * Real values, not `declare const`: vitest imports this file and executes it,
 * so an ambient declaration would be a runtime `ReferenceError`.
 *
 * They go through `asResult` rather than a plain annotated `const`, and that is
 * load-bearing for the assertions below. `const r: Result<number, E> = ok(1)`
 * is narrowed by control-flow analysis to `Ok<number>` at every use, so
 * `combine([r, …])` would be measured against an input that can never fail —
 * the `Err` half of every expected type would go missing and the tuple
 * assertions would read as failures for a reason that has nothing to do with
 * `combine`. A function's return type is not narrowed by CFA.
 */
const asResult = <T, E>(r: Result<T, E>): Result<T, E> => r;

const rNum = asResult<number, NotFound>(ok(1));
const rStr = asResult<string, Timeout>(ok('a'));
const rows: Result<number, NotFound>[] = [ok(1), err({ type: 'not_found', message: 'x' })];
const roRows: readonly Result<number, NotFound>[] = rows;
const dyn: Record<string, Result<number, NotFound>> = { a: asResult<number, NotFound>(ok(1)) };
const partial: {
  user: Result<number, NotFound>;
  posts?: Result<string, Timeout>;
} = { user: rNum };

/* -------------------------------------------------------------------------- */

describe('baseline — what the shipped combine promises', () => {
  it('preserves the tuple, unions the errors', () => {
    expectTypeOf(combine([rNum, rStr])).toEqualTypeOf<
      Result<[number, string], NotFound | Timeout>
    >();
  });

  it('collapses a homogeneous array to an array', () => {
    expectTypeOf(combine(rows)).toEqualTypeOf<Result<number[], NotFound>>();
  });

  it('empty tuple is Result<[], never>', () => {
    expectTypeOf(combine([])).toEqualTypeOf<Result<[], never>>();
  });
});

describe('candidate 1 (two overloads, tuple first) — array side is NOT degraded', () => {
  it('tuple preservation survives the added overload', () => {
    expectTypeOf(combineOverloaded([rNum, rStr])).toEqualTypeOf<
      Result<[number, string], NotFound | Timeout>
    >();
  });

  it('homogeneous array survives', () => {
    expectTypeOf(combineOverloaded(rows)).toEqualTypeOf<Result<number[], NotFound>>();
  });

  it('empty ARRAY still picks the array overload, not the record one', () => {
    expectTypeOf(combineOverloaded([])).toEqualTypeOf<Result<[], never>>();
  });

  it('an array is not accidentally a Record<string, Result> — the overloads cannot collide', () => {
    // Direct proof, independent of overload order: the array type does not
    // satisfy the record constraint at all, because `length`/`push`/… are not
    // `Result`s. So the record overload is unreachable for an array input.
    // @ts-expect-error - Result<number, NotFound>[] is not Record<string, Result>
    const _unreachable: ResultRecord = rows;
    void _unreachable;
  });
});

describe('candidate 1 — record side', () => {
  it('collects per-key success types and unions the errors', () => {
    expectTypeOf(combineOverloaded({ user: rNum, posts: rStr })).toEqualTypeOf<
      Result<{ user: number; posts: string }, NotFound | Timeout>
    >();
  });

  it('empty OBJECT is Result<{}, never>', () => {
    expectTypeOf(combineOverloaded({})).toEqualTypeOf<Result<{}, never>>();
  });

  it('a non-Result in the bag is a compile error, not a silent pass', () => {
    // @ts-expect-error - `count: number` satisfies neither overload
    combineOverloaded({ user: rNum, count: 3 });
  });

  it('a bare Result is not a bag of Results — `ok: true` is not a Result', () => {
    // @ts-expect-error - Ok<number> is not Record<string, Result>
    combineOverloaded(ok(1));
  });

  it('an index-signature record widens to an index-signature success — keys are not invented', () => {
    expectTypeOf(combineOverloaded(dyn)).toEqualTypeOf<
      Result<Record<string, number>, NotFound>
    >();
  });

  it('an OPTIONAL key is ACCEPTED and maps through, keeping its optionality', () => {
    // Predicted to be rejected; it is not. `Result<string, Timeout> | undefined`
    // still matches `T extends ResultRecord` (the constraint is checked against
    // the property type, and an optional property is not required to be
    // present), and the homomorphic mapped type carries `?` to the output.
    expectTypeOf(combineOverloaded(partial)).toEqualTypeOf<
      Result<{ user: number; posts?: string | undefined }, NotFound | Timeout>
    >();
  });

  it('…and that is exactly where it breaks: a PRESENT key holding `undefined` type-checks and throws', () => {
    // `partial` may be `{ user, posts: undefined }` — an own enumerable key
    // whose value is not a `Result`. `Object.keys` sees it, the loop reads
    // `.ok` off `undefined`, and the combinator crashes. The optional-key hole
    // is a runtime one, not a type one; pinned in `10-object-combine.spike.ts`.
    expectTypeOf(partial.posts).toEqualTypeOf<Result<string, Timeout> | undefined>();
  });
});

describe('candidate 2 (one signature, Effect-style conditional) — where it breaks', () => {
  it('tuple preservation works, via `const T`', () => {
    expectTypeOf(combineUnified([rNum, rStr])).toEqualTypeOf<
      Result<readonly [number, string], NotFound | Timeout>
    >();
  });

  it('…but `const` makes the tuple READONLY, which is a signature change §5.4 did not ask for', () => {
    expectTypeOf(combineUnified([rNum, rStr])).not.toEqualTypeOf<
      Result<[number, string], NotFound | Timeout>
    >();
  });

  it('record side infers per-key', () => {
    expectTypeOf(combineUnified({ user: rNum, posts: rStr })).toEqualTypeOf<
      Result<{ user: number; posts: string }, NotFound | Timeout>
    >();
  });

  it('the deferred conditional is NOT the problem it was predicted to be — `.ok` still narrows', () => {
    // Predicted to repeat §10.9's `SettledOr` failure and §3.5's `Arms<E>` one.
    // It does not: `CombineReturn<T>` stays deferred, but its *constraint* is
    // the union of both branches — every one of which is a `Result` — so the
    // discriminant is readable and narrowing works inside a generic wrapper.
    // The unified form's cost is elsewhere (the `readonly` leak, below).
    function wrapper<T extends ResultRecord>(bag: T) {
      const out = combineUnified(bag);
      return out.ok ? out.value : out.error;
    }
    void wrapper;
  });

  it('THE REAL COST: `const T` leaks `readonly` into the SUCCESS VALUE for a plain array input', () => {
    // The shipped `combine` accepts a `readonly Result[]` and returns a
    // *mutable* `number[]`. The unified form returns `readonly number[]` — a
    // visible change to an already-shipped signature, on a call-site that has
    // nothing to do with the record feature. That is the degradation §5.4's
    // tuple-preservation promise was being protected from.
    expectTypeOf(combine(roRows)).toEqualTypeOf<Result<number[], NotFound>>();
    expectTypeOf(combineOverloaded(roRows)).toEqualTypeOf<Result<number[], NotFound>>();
    expectTypeOf(combineUnified(roRows)).toEqualTypeOf<Result<readonly number[], NotFound>>();
  });
});

describe('candidate 1 under a generic wrapper — the overloads DO reduce', () => {
  it('a wrapper over a record parameter resolves the record overload', () => {
    function wrapper<T extends ResultRecord>(bag: T) {
      return combineOverloaded(bag);
    }
    expectTypeOf(wrapper({ user: rNum })).toEqualTypeOf<Result<{ user: number }, NotFound>>();
  });
});

/* -------------------------------------------------------------------------- */
/* Key attribution                                                             */
/* -------------------------------------------------------------------------- */

const bag: {
  user: Result<number, NotFound>;
  posts: Result<string, Timeout>;
} = { user: rNum, posts: rStr };

describe('combineWithAllErrors — the three error shapes, typed', () => {
  it('baseline: the shipped array form accumulates flat', () => {
    expectTypeOf(combineWithAllErrors([rNum, rStr])).toEqualTypeOf<
      Result<[number, string], (NotFound | Timeout)[]>
    >();
  });

  it('A (flat) — consistent with the array form; the key is gone from the TYPE too', () => {
    expectTypeOf(cwaeFlat(bag)).toEqualTypeOf<
      Result<{ user: number; posts: string }, (NotFound | Timeout)[]>
    >();
  });

  it('B (partial record) — each key keeps its OWN narrowed error type', () => {
    expectTypeOf(cwaeRecord(bag)).toEqualTypeOf<
      Result<{ user: number; posts: string }, { user?: NotFound; posts?: Timeout }>
    >();
  });

  it('B is `Partial`, so reading a key gives `E | undefined` — §10.6’s failure mode, deliberately', () => {
    const out = cwaeRecord(bag);
    if (!out.ok) expectTypeOf(out.error.user).toEqualTypeOf<NotFound | undefined>();
  });

  it('B cannot express "at least one key is present", so `{}` type-checks as an error value', () => {
    // The type says a failure may carry no errors at all — a shape the runtime
    // never produces. The flat array has the same hole (`[]`), so this is not a
    // point of difference; recorded so nobody claims it is.
    const empty: { user?: NotFound; posts?: Timeout } = {};
    void empty;
  });

  it('C (tagged entries) — key and error stay CORRELATED, per entry', () => {
    expectTypeOf(cwaeEntries(bag)).toEqualTypeOf<
      Result<
        { user: number; posts: string },
        ({ readonly key: 'user'; readonly error: NotFound }
          | { readonly key: 'posts'; readonly error: Timeout })[]
      >
    >();
  });

  it('C narrows: switching on `key` narrows `error` to that key’s variant', () => {
    const out = cwaeEntries(bag);
    if (!out.ok) {
      for (const entry of out.error) {
        if (entry.key === 'user') expectTypeOf(entry.error).toEqualTypeOf<NotFound>();
        else expectTypeOf(entry.error).toEqualTypeOf<Timeout>();
      }
    }
  });

  it('C over an index-signature record degenerates to `string` keys, as it must', () => {
    expectTypeOf(cwaeEntries(dyn)).toEqualTypeOf<
      Result<Record<string, number>, { readonly key: string; readonly error: NotFound }[]>
    >();
  });

  it('A over an index-signature record is identical to the array form’s error type', () => {
    expectTypeOf(cwaeFlat(dyn)).toEqualTypeOf<Result<Record<string, number>, NotFound[]>>();
  });
});

describe('the asymmetry question: may the two combinators disagree on shape?', () => {
  it('C is the only candidate whose error stays an ARRAY, keeping §5.4’s "flat array in input order" sentence true', () => {
    const out = cwaeEntries(bag);
    if (!out.ok) expectTypeOf(out.error).toExtend<readonly unknown[]>();
  });

  it('B is not an array, so a caller who wrote `errors.map(...)` against the array form breaks on migration', () => {
    const out = cwaeRecord(bag);
    // @ts-expect-error - a partial record has no `.map`
    if (!out.ok) out.error.map((e) => e);
  });
});
