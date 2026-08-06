/**
 * Experiment 04 — hostile and pathological edges.
 *
 * Cases the type system can't forbid (or a caller can force with `any`), where
 * "defect-free" means: no silent wrong value, no stranded generator, no hang.
 *
 *  A. a `finally` that itself `yield*`s during close (second short-circuit)
 *  B. a `finally` with a bare `return` during close (tries to override)
 *  C. an Err that carries a callable `then` (§2's union is brandless!) —
 *     sync body vs async body
 *  D. a body whose *return* Result carries a `then`, async body
 */
import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';
import type { Err, Result } from '../../../src/index.ts';

describe('A: finally yields during close', () => {
  it('ours (sync): what is returned, and does the generator actually finish?', () => {
    const order: string[] = [];
    let outerFinally = false;
    const r = safeTry(function* (): Generator<Err<string>, Result<number, string>> {
      try {
        try {
          yield* safeUnwrap(err('first'));
          return ok(1);
        } finally {
          order.push('inner-finally');
          // Pathological: a second fallible step inside cleanup.
          yield* safeUnwrap(err('second'));
          order.push('after-second-yield');
        }
      } finally {
        outerFinally = true;
        order.push('outer-finally');
      }
    });
    console.log('[04A] result:', JSON.stringify(r), 'order:', order, 'outer finally ran:', outerFinally);
    expect(r).toEqual(err('first'));
    // Pre-fix this stranded the generator: order was ['inner-finally'] and the
    // outer finally never ran. `release` now drives `.return()` until done.
    expect(order).toEqual(['inner-finally', 'outer-finally']);
    expect(outerFinally).toBe(true);
  });

  it('effect: a finalizer that fails', () => {
    // ensuring's types forbid a failing finalizer (Effect<void, never>) — the
    // cast is deliberate, to observe the runtime's answer anyway.
    const failingFinalizer = Effect.fail('second') as unknown as Effect.Effect<void>;
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        yield* Effect.fail('first');
        return 1;
      }).pipe(Effect.ensuring(failingFinalizer)),
    );
    console.log('[04A] Effect failing finalizer exit:', JSON.stringify(exit).slice(0, 300));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('B: finally with a bare return during close', () => {
  it('ours (sync): can a finally override the short-circuit Err?', () => {
    const r = safeTry(function* (): Generator<Err<string>, Result<number, string>> {
      try {
        yield* safeUnwrap(err('boom'));
        return ok(1);
      } finally {
        // eslint-disable-next-line no-unsafe-finally
        return ok(999); // native JS lets a finally override a return — do we?
      }
    });
    console.log('[04B] finally-return override — safeTry returned:', JSON.stringify(r));
  });
});

describe('C: an Err carrying a callable then (brandless union)', () => {
  const makeThenableErr = () => {
    const hijacked = { hijack: true };
    let thenCalls = 0;
    const e = {
      ok: false as const,
      error: 'real-error',
      then(resolve: (v: unknown) => void) {
        thenCalls += 1;
        resolve(hijacked);
      },
    };
    return { e: e as unknown as Result<number, string>, calls: () => thenCalls };
  };

  it('ours (sync body): delivered intact — sync path never awaits', () => {
    const { e, calls } = makeThenableErr();
    const r = safeTry(function* () {
      yield* safeUnwrap(e);
      return ok(1);
    });
    console.log('[04C] sync body, thenable Err — then called', calls(), 'times; result.ok =', (r as { ok: boolean }).ok);
    expect(r).toBe(e); // intact, identity-preserved
    expect(calls()).toBe(0);
  });

  it('ours (async body): observe — does async generator machinery assimilate it?', async () => {
    const { e, calls } = makeThenableErr();
    const p = safeTry(async function* () {
      yield* safeUnwrap(e);
      return ok(1);
    });
    const settled = await Promise.race([
      p.then((r) => ({ kind: 'resolved' as const, r })),
      new Promise<{ kind: 'timeout' }>((res) => setTimeout(() => res({ kind: 'timeout' }), 50)),
    ]);
    console.log('[04C] async body, thenable Err —', settled.kind, 'value:', JSON.stringify((settled as { r?: unknown }).r), 'then calls:', calls());
  });

  it('effect: effects are branded, a thenable cannot impersonate one (control)', () => {
    // Effect's yield* only accepts Effect-branded values; a thenable object is
    // not one, so this whole class is unrepresentable there. Recorded as the
    // structural-vs-branded trade: we bought §2.1's JSON round-trip with it.
    const exit = Effect.runSyncExit(Effect.gen(function* () {
      return yield* Effect.succeed(1);
    }));
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe('D: the returned Result carries a then, async body', () => {
  it('ours: observe — can an async safeTry ever deliver it?', async () => {
    let thenCalls = 0;
    const trojanOk = {
      ok: true as const,
      value: 42,
      then(resolve: (v: unknown) => void) {
        thenCalls += 1;
        resolve({ hijacked: true });
      },
    };
    const p = safeTry(async function* (): AsyncGenerator<Err<never>, Result<number, never>> {
      return trojanOk as unknown as Result<number, never>;
    });
    const settled = await Promise.race([
      p.then((r) => ({ kind: 'resolved' as const, r })),
      new Promise<{ kind: 'timeout' }>((res) => setTimeout(() => res({ kind: 'timeout' }), 50)),
    ]);
    console.log('[04D] async return of thenable Ok —', settled.kind, 'value:', JSON.stringify((settled as { r?: unknown }).r), 'then calls:', thenCalls);
  });

  it('ours (sync body, control): delivered intact', () => {
    const trojanOk = {
      ok: true as const,
      value: 42,
      then(resolve: (v: unknown) => void) {
        resolve({ hijacked: true });
      },
    };
    const r = safeTry(function* (): Generator<Err<never>, Result<number, never>> {
      return trojanOk as unknown as Result<number, never>;
    });
    expect(r).toBe(trojanOk);
  });
});
