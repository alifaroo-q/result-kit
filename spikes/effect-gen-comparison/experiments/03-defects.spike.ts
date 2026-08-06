/**
 * Experiment 03 — defects: what happens when the body itself misbehaves.
 *
 * Effect has a third channel (Die) for thrown exceptions. Our Result has two:
 * a throw is a bug and must propagate loudly — but it must propagate
 * *consistently* (sync body → synchronous throw; async body → rejection), and
 * it must not strand cleanup.
 */
import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';
import { err, ok, safeTry, safeUnwrap } from '../../../src/index.ts';

describe('a throw inside the body', () => {
  it('ours (sync): propagates synchronously, and pending finallys still run', () => {
    let released = false;
    expect(() =>
      safeTry(function* () {
        try {
          yield* safeUnwrap(ok(1));
          throw new Error('bug');
        } finally {
          released = true;
        }
      }),
    ).toThrowError('bug');
    expect(released).toBe(true);
  });

  it('ours (async): rejects the returned promise', async () => {
    await expect(
      safeTry(async function* () {
        yield* safeUnwrap(Promise.resolve(ok(1)));
        throw new Error('bug');
      }),
    ).rejects.toThrowError('bug');
  });

  it('effect: converts the throw to a Die exit (third channel)', () => {
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        yield* Effect.succeed(1);
        throw new Error('bug');
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    console.log('[03] Effect throw-in-body exit:', JSON.stringify(exit, null, 0).slice(0, 200));
  });
});

describe('a rejecting Promise<Result> handed to safeUnwrap', () => {
  it('ours: the rejection propagates as a rejection (not swallowed, not wrapped)', async () => {
    let released = false;
    await expect(
      safeTry(async function* () {
        try {
          yield* safeUnwrap(Promise.reject(new Error('network down')));
          return ok(1);
        } finally {
          released = true;
        }
      }),
    ).rejects.toThrowError('network down');
    expect(released).toBe(true);
  });
});

describe('a throw from a finally during short-circuit close', () => {
  // Native JS: `try { return } finally { throw }` — the finally's throw wins.
  // What does safeTry do when .return() makes the finally throw?
  it('ours (sync): observe — does safeTry throw, or return the Err?', () => {
    let outcome: string;
    try {
      const r = safeTry(function* () {
        try {
          yield* safeUnwrap(err('boom' as const));
          return ok(1);
        } finally {
          // eslint-disable-next-line no-unsafe-finally
          throw new Error('finalizer bug');
        }
      });
      outcome = `returned ${JSON.stringify(r)}`;
    } catch (e) {
      outcome = `threw ${(e as Error).message}`;
    }
    console.log('[03] sync throw-in-finally-on-close:', outcome);
    expect(outcome).toBeDefined();
  });

  it('ours (async): observe — resolve with Err, or reject with the finalizer error?', async () => {
    const p = safeTry(async function* () {
      try {
        yield* safeUnwrap(Promise.resolve(err('boom' as const)));
        return ok(1);
      } finally {
        // eslint-disable-next-line no-unsafe-finally
        throw new Error('finalizer bug');
      }
    });
    const outcome = await p.then(
      (r) => `resolved ${JSON.stringify(r)}`,
      (e) => `rejected ${(e as Error).message}`,
    );
    console.log('[03] async throw-in-finally-on-close:', outcome);
    expect(outcome).toBeDefined();
  });

  it('effect: a throwing finalizer in ensuring', () => {
    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        yield* Effect.fail('boom');
        return 1;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            throw new Error('finalizer bug');
          }),
        ),
      ),
    );
    console.log('[03] Effect throwing finalizer exit:', JSON.stringify(exit).slice(0, 300));
  });
});
