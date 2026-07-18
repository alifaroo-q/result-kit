import { safeTry as coreSafeTry } from '../core/do-notation';
import {
  fromPromise as coreFromPromise,
  fromThrowableAsync as coreFromThrowableAsync,
} from '../core/interop';
import {
  err as coreErr,
  ok as coreOk,
  type Err,
  type Ok,
  type Result,
} from '../core/result';
import { isSettledResult } from '../core/thenable';

import { ResultAsync } from './result-async';
import { ResultChain } from './result-chain';

/**
 * The `/fluent` entrypoint (spec §6.3) — the opt-in ergonomic envelope.
 *
 * The root `.` bundle **must never contain this module**. That boundary is
 * ADR 0001's headline differentiator (a tree-shakable core class-only
 * neverthrow structurally cannot offer), and spec §7.3 makes an automated guard
 * mandatory rather than trusting prose: see `test/fluent/boundary.spec.ts`. The
 * rule is one-directional — `/fluent` imports the core functions it delegates
 * to; the root barrel never re-exports the wrapper.
 *
 * **Dual constructors** (spec §4, ADR 0001 §4): `ok` / `err` exist at *both*
 * entrypoints with the **same name** and a surface-appropriate return type — the
 * root's return plain data, these return wrappers. That is the decided design,
 * not a collision.
 */

export type { ResultChain };

/**
 * `ResultAsync` is exported as a **value**, unlike `ResultChain` — ADR 0005 §4
 * specifies the static `ResultAsync.from(promiseOfResult)`, which a type export
 * could not provide. The asymmetry is as-decided (§6.3); do not "fix" it.
 */
export { ResultAsync };

/**
 * Builds a successful {@link ResultChain}.
 *
 * The no-arg overload mirrors the root's, covering the common `void` success:
 * prefer `ok()` over `ok(undefined)`.
 */
export function ok(): ResultChain<void, never>;
export function ok<T>(value: T): ResultChain<T, never>;
export function ok<T>(value?: T): ResultChain<T | void, never> {
  return new ResultChain(
    value === undefined ? coreOk() : coreOk<T | void>(value),
  );
}

/** Builds a failed {@link ResultChain}. */
export function err<E>(error: E): ResultChain<never, E> {
  return new ResultChain(coreErr(error));
}

/**
 * Re-enters fluent-land from a plain {@link Result}.
 *
 * The way back in from everything the wrapper deliberately does not mirror —
 * `combine`, `partition`, the `from*` constructors — all of which stay
 * free-function-only because they operate on arrays and non-`Result` inputs
 * rather than a single instance (spec §6).
 *
 * ```ts
 * from(combine([a, b])).map(sum).unwrapOr(0);
 * ```
 *
 * @remarks
 * A free `from` for sync, a static `ResultAsync.from` for async. The asymmetry
 * is as-decided by [ADR 0005 §4] and recorded in §6.3; do not "fix" it without
 * a new decision.
 */
export function from<T, E>(result: Result<T, E>): ResultChain<T, E> {
  return new ResultChain(result);
}

/**
 * Lifts a raw `Promise<T>` into a {@link ResultAsync}, catching a **rejection**
 * into the `E` channel via `onReject`.
 *
 * ```ts
 * const name = await fromPromise(fetch(url), toNetworkError)
 *   .andThen(parseBody)
 *   .match({ ok: (b) => b.name, err: () => 'anon' });
 * ```
 *
 * @remarks
 * **Not interchangeable with `ResultAsync.from`**, and that is the whole of
 * §10.5's argument. `ResultAsync.from` lifts a `Promise<Result<T, E>>` that is
 * *already* a union; this catches a rejection off a raw `Promise<T>`. §6.3
 * originally listed five values and omitted this — which contradicted §4 and
 * ADR 0005 §4's placement table, and left a `/fluent` user entering from a
 * throwing promise no choice but to import from root. That is exactly the
 * cross-entrypoint dependency ADR 0005 §4 rejected, pointing the other way.
 * §4 wins; §6.3 is amended to seven values.
 */
export function fromPromise<T, E>(
  promise: PromiseLike<T>,
  onReject: (error: unknown) => E,
): ResultAsync<T, E> {
  return ResultAsync.from(coreFromPromise(promise, onReject));
}

/**
 * Wraps an async throwing function into one returning a {@link ResultAsync},
 * catching rejections through `onReject`.
 *
 * The wrapper-returning twin of {@link fromPromise}, and a **dual constructor**
 * (§4): same name as the root's, wrapper return type. Lazy and reusable, with
 * the wrapped function's argument list preserved — all of which comes from the
 * core original this delegates to.
 */
export function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => ResultAsync<T, E> {
  const wrapped = coreFromThrowableAsync(fn, onReject);

  return (...args: Args) => ResultAsync.from(wrapped(...args));
}

/**
 * What a `/fluent` do-notation body may `return` — **either half of the dual
 * constructor**, and admitting both is an amendment to §6.3 (§10.13).
 *
 * §6.3 sketched the body as `() => Generator<…, Result<T, E>>`, which reads
 * naturally until you notice which `ok` is in scope. At `/fluent`, `ok` / `err`
 * are the dual constructors (§4) and return **wrappers**, so the obvious
 * `return ok(v)` produces a `ResultChain`, not a `Result` — and the literal
 * signature rejects it. The two ways out are both things this project has
 * already decided against: `return ok(v).toResult()` reintroduces exactly the
 * ceremony do-notation exists to kill, and importing root's `ok` into a
 * `/fluent` block is the cross-entrypoint dependency ADR 0005 §4 rejected.
 *
 * A plain `Result` stays accepted, because it genuinely occurs — a body mixing
 * in root's `safeUnwrap` over a plain union (§6.3's own mixed case) may well
 * have a plain `Result` in hand at the exit.
 *
 * `ResultAsync` needs **no arm here**, and that is a consequence rather than a
 * restriction (§10.13). It `implements PromiseLike`, and an async generator's
 * `TReturn` is awaited by tsc and the runtime alike — so `return someResultAsync`
 * types as the plain `Result` this alias already admits, and resolves to it.
 *
 * Which makes the `ResultChain` arm exactly the **non-thenable** case: neither
 * side awaits a `ResultChain`, so it reaches the return slot as a wrapper and has
 * to be decomposed. The two halves of the dual constructor need opposite
 * treatment for the single reason that one is thenable and the other is not.
 */
type BodyReturn = Result<unknown, unknown> | ResultChain<unknown, unknown>;

/**
 * The value channel of a body return, over **both** shapes {@link BodyReturn}
 * admits. The core's `ValueOf` handles the plain half only.
 *
 * The two arms cannot collide: `ResultChain` carries a native-private field, so
 * it never matches `Ok<…>` structurally, and the plain union has no `#result`,
 * so it never matches `ResultChain<…>`.
 */
type ValueOf<R> =
  R extends ResultChain<infer T, infer _F>
    ? T
    : R extends Ok<infer T>
      ? T
      : never;

/**
 * The error channel of a body return **or of a yielded `Err`** — one alias
 * covering both slots, which is why it takes the `Err` arm as well.
 *
 * Distributive over a union, which is the whole reason `Y` and `R` below are
 * naked type parameters. See the note on the signatures.
 */
type ErrorOf<R> =
  R extends ResultChain<infer _T, infer F>
    ? F
    : R extends Err<infer F>
      ? F
      : never;

/**
 * Whether a body return has already settled — the fluent counterpart of
 * `isSettledResult`, and it exists for §10.11's reason, not for tidiness.
 *
 * `isThenable` alone cannot make this call. §2's union is brandless, so a
 * structurally valid `{ ok: true, value }` may also carry a `then`; asking "is
 * this thenable?" first assimilates it, and a synchronous body's result comes
 * back as a `ResultAsync` the signature says is a `ResultChain`. So the settled
 * shapes are recognised **first** — a `ResultChain` by `instanceof`, a plain
 * `Result` by its boolean `ok`, neither of which a promise of one has.
 */
function isSettledBody(
  out: BodyReturn | PromiseLike<BodyReturn>,
): out is BodyReturn {
  return (
    out instanceof ResultChain ||
    isSettledResult(
      out as Result<unknown, unknown> | PromiseLike<Result<unknown, unknown>>,
    )
  );
}

/** Normalizes either admitted shape to the plain union the wrapper holds. */
function toPlain(out: BodyReturn): Result<unknown, unknown> {
  return out instanceof ResultChain ? out.toResult() : out;
}

/**
 * Re-typed without the core's `R extends Result<unknown, unknown>` bound, for
 * the same mechanical reason `result-chain.ts`'s four `*Unguarded` aliases
 * exist: the bound is right for the core's callers and wrong for this one, which
 * deliberately admits a wrapper return. The core's *implementation* signature is
 * already loose enough — it reads `.value` off the iterator result and returns
 * it untouched, whatever shape it is — so this states what the code does rather
 * than changing it.
 */
const safeTryUnguarded = coreSafeTry as unknown as (
  body: () =>
    | Generator<Err<unknown>, BodyReturn>
    | AsyncGenerator<Err<unknown>, BodyReturn>,
) => BodyReturn | Promise<BodyReturn>;

/**
 * Runs a do-notation block on the fluent surface, returning a **wrapper** so the
 * chain continues: `safeTry(fn).map(…).unwrapOr(d)` (spec §6.3, ADR 0007 §3).
 *
 * A `/fluent` user `yield*`s wrappers **directly** — there is no `safeUnwrap`
 * here, and its absence is asserted rather than assumed. `ResultChain` and
 * `ResultAsync` are self-iterable, which is the whole of ADR 0007 §3's promise:
 *
 * ```ts
 * import { safeTry, ok } from '@zireal/result-kit/fluent';
 *
 * const total = safeTry(function* () {
 *   const user  = yield* findUser(id);     // ResultChain — Err short-circuits
 *   const order = yield* loadOrder(user);  // binds its own type
 *   return ok(user.credit + order.total);
 * });
 * ```
 *
 * **The dual-constructor rule, applied to the runner** (§4): same name as root's,
 * surface-appropriate return type. A `function*` gives a {@link ResultChain}, an
 * `async function*` gives a {@link ResultAsync} — one overloaded runner, no
 * `safeTryAsync` (ADR 0007 §4).
 *
 * Short-circuit and error accumulation are **not reimplemented here**: this
 * delegates to the core runner, so the union-accumulated channel, the explicit
 * `Result` return, and the `.return()` that closes a short-circuited generator
 * so its `finally` blocks run (§10.9) all hold identically, by construction
 * rather than by parallel maintenance.
 *
 * Root's `safeUnwrap` still works inside one of these blocks, for unwrapping a
 * **plain** union — the mixed case §6.3 calls out, and it accumulates into the
 * same channel.
 *
 * @remarks
 * `Y` and `R` are both **naked** type parameters, carrying §5.7's implementation
 * notes 1 and 2 wholesale. Spelling either slot concretely makes TypeScript keep
 * only the *first* inference candidate of a yielded or returned union — silently
 * collapsing `NotFound | Forbidden` for `Y`, and failing to resolve the call at
 * all for `R` on the two-`return err(…)` shape ADR 0007 §6 blesses. The core
 * paid for both lessons; this signature inherits them rather than rediscovering
 * them.
 *
 * §5.7's caveat on TypeScript's subtype-reduction across `yield*`
 * ([microsoft/TypeScript#57625]) applies here unchanged — it happens in the
 * generator expression, upstream of any signature.
 */
export function safeTry<Y extends Err<unknown>, R extends BodyReturn>(
  body: () => Generator<Y, R>,
): ResultChain<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>;
export function safeTry<Y extends Err<unknown>, R extends BodyReturn>(
  body: () => AsyncGenerator<Y, R>,
): ResultAsync<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>;

export function safeTry(
  body: () =>
    | Generator<Err<unknown>, BodyReturn>
    | AsyncGenerator<Err<unknown>, BodyReturn>,
): ResultChain<unknown, unknown> | ResultAsync<unknown, unknown> {
  const settled = safeTryUnguarded(body);

  return isSettledBody(settled)
    ? new ResultChain(toPlain(settled))
    : ResultAsync.from(Promise.resolve(settled).then(toPlain));
}
