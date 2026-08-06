/**
 * Experiment 07 — the `pipe` / `flow` candidate itself.
 *
 * A root `pipe` for this package cannot be Effect's `pipe`, and the difference
 * is the whole ticket. Effect's works because every combinator ships a
 * data-last double built by `dual` — `Array.map(double)` IS a unary function,
 * so it drops into a pipeline naked. `dual` is ruled out of scope on the map
 * (it would unteach the data-first rule the llms briefs teach as the package's
 * identity), so every step in OUR pipeline has to be a bare lambda:
 *
 *   Effect:  pipe(xs, Array.map(double), Array.filter(gt4))
 *   Ours:    pipe(r,  (r) => map(r, double), (r) => andThen(r, gt4))
 *
 * This file holds the candidate implementation plus its own mechanics tests.
 * The call-site comparison the ADR reacts to is experiment 08; the type-level
 * assertions are experiment 09.
 *
 * Prior art read at `effect@4.0.0-beta.104`: `packages/effect/src/Function.ts`
 * — `pipe` (a 20-arity overload tower over a `pipeArguments` dispatcher) and
 * `dual` (the runtime arity-detection hack behind the data-last doubles).
 *
 * Two deliberate divergences from their implementation:
 *
 * 1. **No `Pipeable` protocol.** Effect's `pipe(a, ...)` delegates to
 *    `pipeArguments`, which also powers `a.pipe(...)` on every Effect value.
 *    §2 forbids methods on the union, so the method form cannot exist here and
 *    the dispatcher has nothing else to do. A plain left fold is the whole
 *    runtime.
 * 2. **Tower depth 9, not 20.** Depth is a pure cost/benefit dial: each arm is
 *    ~10 lines of generics, and every call site pays the cost of TypeScript
 *    walking the tower to find its arm. Whether 9 is right is an ADR question;
 *    what this file establishes is that the mechanism does not change with
 *    depth, and experiment 09 measures what happens when a call *overflows*
 *    the tower.
 */
import { describe, expect, it } from 'vitest';

/* ------------------------------------------------------------------ *
 * pipe — variadic left-to-right application
 * ------------------------------------------------------------------ */

export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
): I;
export function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>) {
  let out = a;
  for (const fn of fns) out = fn(out);
  return out;
}

/* ------------------------------------------------------------------ *
 * flow — left-to-right composition (the point-free sibling)
 * ------------------------------------------------------------------ */

export function flow<Args extends unknown[], A>(
  ab: (...args: Args) => A,
): (...args: Args) => A;
export function flow<Args extends unknown[], A, B>(
  ab: (...args: Args) => A,
  bc: (a: A) => B,
): (...args: Args) => B;
export function flow<Args extends unknown[], A, B, C>(
  ab: (...args: Args) => A,
  bc: (a: A) => B,
  cd: (b: B) => C,
): (...args: Args) => C;
export function flow<Args extends unknown[], A, B, C, D>(
  ab: (...args: Args) => A,
  bc: (a: A) => B,
  cd: (b: B) => C,
  de: (c: C) => D,
): (...args: Args) => D;
export function flow<Args extends unknown[], A, B, C, D, E>(
  ab: (...args: Args) => A,
  bc: (a: A) => B,
  cd: (b: B) => C,
  de: (c: C) => D,
  ef: (d: D) => E,
): (...args: Args) => E;
export function flow(
  ab: (...args: unknown[]) => unknown,
  ...fns: Array<(x: unknown) => unknown>
) {
  return (...args: unknown[]) => {
    let out = ab(...args);
    for (const fn of fns) out = fn(out);
    return out;
  };
}

/* ------------------------------------------------------------------ *
 * Mechanics
 * ------------------------------------------------------------------ */

describe('pipe mechanics', () => {
  it('applies left to right', () => {
    expect(
      pipe(
        2,
        (n) => n + 1,
        (n) => n * 10,
      ),
    ).toBe(30);
  });

  it('is identity with no steps', () => {
    const subject = { a: 1 };
    expect(pipe(subject)).toBe(subject);
  });

  it('is eager and total — every step runs, in order, exactly once', () => {
    const seen: string[] = [];
    pipe(
      0,
      (n) => {
        seen.push('a');
        return n;
      },
      (n) => {
        seen.push('b');
        return n;
      },
    );
    expect(seen).toEqual(['a', 'b']);
  });

  it('does NOT short-circuit — a throwing step propagates, like a call would', () => {
    expect(() =>
      pipe(
        1,
        () => {
          throw new Error('boom');
        },
        (n) => n,
      ),
    ).toThrow('boom');
  });

  it('runs past the typed tower at runtime — the fold is arity-blind', () => {
    // The 9-arm tower is a TYPE-level limit only. A 12-step call still
    // computes correctly; what it loses is inference (experiment 09).
    const steps = Array.from({ length: 12 }, () => (n: number) => n + 1);
    // @ts-expect-error — 13 arguments overflows the 9-arm tower.
    expect(pipe(0, ...steps)).toBe(12);
  });
});

describe('flow mechanics', () => {
  it('composes left to right, first function keeps its arity', () => {
    const f = flow(
      (a: number, b: number) => a + b,
      (n) => n * 2,
    );
    expect(f(1, 2)).toBe(6);
  });

  it('is a lambda factory, nothing more — flow(f)(x) === pipe(x, f)', () => {
    const double = (n: number) => n * 2;
    expect(flow(double)(21)).toBe(pipe(21, double));
  });
});
