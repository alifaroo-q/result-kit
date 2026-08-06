/**
 * Experiment 06 — type-level parity. Asserted by `tsc --noEmit` in this spike,
 * not by the runtime run — mirrors the root repo's rule that expectTypeOf is a
 * runtime no-op.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { Effect } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';
import type { Result } from '../../../src/index.ts';

type NotFound = { type: 'not-found'; message: string };
type Forbidden = { type: 'forbidden'; message: string; role: string };

declare const findUser: (id: string) => Result<{ id: string }, NotFound>;
declare const authorize: (u: { id: string }) => Result<'ok', Forbidden>;
declare const stepB: Effect.Effect<number, NotFound>;
declare const stepC: Effect.Effect<number, Forbidden>;

type ErrA = { type: string; message: string };
type ErrB = { type: string; message: string };
declare const fa: () => Result<1, ErrA>;
declare const fb: () => Result<2, ErrB>;
declare const ea: Effect.Effect<1, ErrA>;
declare const eb: Effect.Effect<2, ErrB>;

describe('error-channel accumulation', () => {
  it('ours: unions across yields and the return', () => {
    // Type-only: never invoked at runtime — findUser/authorize are declares.
    const _typeOnly = () => {
      const r = safeTry(function* () {
        const u = yield* safeUnwrap(findUser('1'));
        const a = yield* safeUnwrap(authorize(u));
        if (a !== 'ok') return err({ type: 'invariant', message: 'x' } as const);
        return ok(u.id);
      });
      expectTypeOf(r).toEqualTypeOf<
        Result<string, NotFound | Forbidden | { readonly type: 'invariant'; readonly message: 'x' }>
      >();
    };
    void _typeOnly;
  });

  it('effect: same accumulation through the non-distributive [Eff] trick', () => {
    const _typeOnly = () => {
      const eff = Effect.gen(function* () {
        const b = yield* stepB;
        const c = yield* stepC;
        return b + c;
      });
      expectTypeOf(eff).toEqualTypeOf<Effect.Effect<number, NotFound | Forbidden, never>>();
    };
    void _typeOnly;
  });
});

describe('auto-wrap vs explicit return', () => {
  it('ours: a bare returned value is a type error', () => {
    // @ts-expect-error — a bare number is not a Result; safeTry will not wrap it.
    safeTry(function* () {
      yield* safeUnwrap(ok(1));
      return 2;
    });
  });

  it('effect: the bare value IS the success — auto-wrapped', () => {
    const eff = Effect.gen(function* () {
      yield* Effect.succeed(1);
      return 2;
    });
    expectTypeOf(eff).toEqualTypeOf<Effect.Effect<number, never, never>>();
  });
});

describe('uninhabited channels', () => {
  it('ours: no yields → error channel is never', () => {
    const r = safeTry(function* () {
      return ok(1);
    });
    expectTypeOf(r).toEqualTypeOf<Result<number, never>>();
  });

  it('effect: no yields → E and R are never', () => {
    const eff = Effect.gen(function* () {
      return 1;
    });
    expectTypeOf(eff).toEqualTypeOf<Effect.Effect<number, never, never>>();
  });
});

describe('known limitation parity: structurally identical error types', () => {
  it('ours collapses aliases of the same structure (pinned upstream as a TS limitation) — does Effect too?', () => {
    const _typeOnly = () => {
      const r = safeTry(function* () {
        const a = yield* safeUnwrap(fa());
        const b = yield* safeUnwrap(fb());
        return ok([a, b] as const);
      });
      // Aliases of one structure are one type to tsc — both names refer to it.
      expectTypeOf(r).toEqualTypeOf<Result<readonly [1, 2], ErrA>>();

      const eff = Effect.gen(function* () {
        const a = yield* ea;
        const b = yield* eb;
        return [a, b] as const;
      });
      expectTypeOf(eff).toEqualTypeOf<Effect.Effect<readonly [1, 2], ErrB, never>>();
    };
    void _typeOnly;
  });
});
