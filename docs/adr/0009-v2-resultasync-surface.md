# ADR 0009 — v2 `ResultAsync` surface

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Ali Farooq
- **Ticket:** none — surfaced while consolidating [`docs/spec/v5-core-spec.md`](../spec/v5-core-spec.md), after the map's final ticket closed. See Context.
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifaroo-q/result-kit/issues/8) (complete)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0004 — v2 full API surface / method inventory](./0004-v2-api-surface-method-inventory.md), [ADR 0005 — v2 async strategy](./0005-v2-async-strategy.md), [ADR 0007 — v2 do-notation helper](./0007-v2-do-notation-helper.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md), v1's own [`src/core/pipeline.ts`](../../src/core/pipeline.ts) + [`README.md`](../../README.md)

## Context

[ADR 0005](./0005-v2-async-strategy.md) introduced `ResultAsync` — the awaitable fluent wrapper (`implements PromiseLike<Result<T, E>>`) — and fixed its *placement* (`/fluent` only), its *constructor* (`static from`), and its three *safety properties* (lossless `await`-collapse, never-forced-through-the-thenable, floating caught by stock `no-floating-promises`).

**It never stated `ResultAsync`'s member list.** [ADR 0004 §2](./0004-v2-api-surface-method-inventory.md)'s wrapper table — the only place wrapper members are enumerated — predates ADR 0005 and covers only the synchronous wrapper (`ResultChain`). The gap went unnoticed because no ticket owned it: ADR 0004 was written before `ResultAsync` existed, and ADR 0005 treated it as an async-*strategy* question rather than a surface one.

The gap surfaced only when [`docs/spec/v5-core-spec.md`](../spec/v5-core-spec.md) consolidated all eight ADRs into one buildable surface and found `ResultAsync` had no members to write down.

### The misreading this ADR exists to correct

The spec's first pass **derived** a member list from [ADR 0005 §2](./0005-v2-async-strategy.md)'s sentence *"Terminals stay strictly synchronous — `match`, `unwrapOr`, `unwrapOrElse`, `unwrapOrThrow`, `toNullable`. You `await` before a terminal."* Read in isolation, that forbids terminals on `ResultAsync` entirely, leaving it chaining + `.toResult()` only.

**That reading is wrong, and the section heading says so:** *"§2. **Functional core** — unified *transforms* (byethrow), synchronous terminals."* ADR 0005 §2 is scoped to the free-function core throughout. Its question was *"should the core `match(result, cases)` overload to accept a `Promise<Result>`?"*, and its answer was no — because **overloading** value-or-promise there costs inference for no gain.

That objection does not transfer to `ResultAsync.match()`, which is **not an overload**: it is an unconditionally-async method on a class that already represents an in-flight result. The stated cost — inference complexity from a value-or-promise overload — simply does not arise. ADR 0005 §2 never constrained the wrapper.

A forward note has been added to [ADR 0005](./0005-v2-async-strategy.md) recording this scope clarification, following the [ADR 0001 ← 0006](./0001-v2-core-api-paradigm.md) precedent.

### What the evidence says

- **v1's async hero path ended in a terminal.** [`README.md:114`](../../README.md) — `await ResultKit.pipeAsync(…).andThen(…).map(…).orElse(…).match({ onSuccess, onFailure })`: one `await` at the front, `.match()` at the end. [`src/core/pipeline.ts:212`](../../src/core/pipeline.ts) confirms `async match<U>(…): Promise<U>`. The chaining-only derivation would have deleted this ergonomic outright.
- **v1 shipped only `match` on `AsyncResultPipeline`** — but its **sync** `ResultPipeline` also shipped only `match` ([`pipeline.ts:160`](../../src/core/pipeline.ts)). "Async has fewer terminals" was never v1's position, so the v1 count transfers in neither direction.
- **The research steers to terminals.** [Line 50](../research/api-packaging-landscape.md): naming converges on `match` / `unwrapOr` / `unwrapOrElse`, and **"Ship a `match` (ts-results-es's omission is a gap)."** [Line 31](../research/api-packaging-landscape.md): neverthrow — the incumbent `/fluent` is deliberately shaped for ([ADR 0007 §5](./0007-v2-do-notation-helper.md)) — ships terminals on its `ResultAsync`.

## Decision

`ResultAsync` **is `ResultChain` lifted** — every value-terminal mirrored with a `Promise`-lifted return — with two deliberate departures (§3, §4).

```ts
export class ResultAsync<T, E> implements PromiseLike<Result<T, E>> {
  static from<T, E>(promise: Promise<Result<T, E>>): ResultAsync<T, E>;   // ADR 0005 §4

  // chaining → ResultAsync
  map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U, E>;
  mapErr<F>(fn: (error: E) => F | Promise<F>): ResultAsync<T, F>;
  andThen<U, F>(fn: (value: T) => Result<U, F> | Promise<Result<U, F>>): ResultAsync<U, E | F>;
  orElse<U, F>(fn: (error: E) => Result<U, F> | Promise<Result<U, F>>): ResultAsync<T | U, F>;
  inspect(fn: (value: T) => void | Promise<void>): ResultAsync<T, E>;
  inspectErr(fn: (error: E) => void | Promise<void>): ResultAsync<T, E>;

  // terminals → Promise-lifted; handlers are SYNC (§2)
  match<U>(cases: { ok: (value: T) => U; err: (error: E) => U }): Promise<U>;
  unwrapOr(defaultValue: T): Promise<T>;
  unwrapOrElse(fn: (error: E) => T): Promise<T>;
  unwrapOrThrow(message?: string): Promise<T>;    // rejects on Err
  toNullable(): Promise<T | null>;

  // exit — ADR 0005 §4/§5
  toResult(): Promise<Result<T, E>>;
  then(...): PromiseLike<...>;                    // await ra ≡ await ra.toResult(), lossless

  // departures
  // NO isOk() / isErr()                          (§3)
  toJSON(): never;                                // throws (§4)
  [Symbol.asyncIterator](): AsyncGenerator<..., T>;  // (§5)
}
```

### 1. Five value-terminals, `Promise`-lifted

`match`, `unwrapOr`, `unwrapOrElse`, `unwrapOrThrow`, `toNullable` all cross over, each returning a `Promise` of what its sync counterpart returns. `unwrapOrThrow` **rejects** the promise on `Err` rather than throwing synchronously — idiomatic in an async context.

The rule is *"`ResultAsync` is `ResultChain`, lifted"* — one sentence a reader can hold. Any subset draws a line that has to be memorized, and *"why can I `await ra.match()` but not `await ra.unwrapOr()`?"* has no principled answer. This restores v1's hero ergonomic:

```ts
const displayName = await ok(token)
  .andThen(requireSession)
  .andThen(findUser)              // → ResultAsync
  .map((user) => user.name)
  .match({ ok: (n) => n, err: () => 'anon' });
```

### 2. Terminal handlers stay synchronous

`.match({ ok, err })` and `.unwrapOrElse(fn)` take **sync** callbacks, exactly as the core's terminals do ([ADR 0004 §1](./0004-v2-api-surface-method-inventory.md)); only the *return* is `Promise`-lifted. Async work belongs upstream in `.andThen()` — which is what the chaining methods exist for.

This is a **deliberate departure from v1**, whose `AsyncResultPipeline.match` accepted `Awaitable<U>` handlers ([`pipeline.ts:212`](../../src/core/pipeline.ts)). Allowing them would drag `Awaited<U>` inference into the terminal's return type and diverge the two surfaces' handler shapes for a saved `.andThen()` hop.

### 3. No `isOk()` / `isErr()` — the "lifted" rule stops at the guards

`ResultChain.isOk()` / `.isErr()` exist only to avoid a DX cliff, returning **plain booleans that deliberately do not narrow** ([ADR 0003 §4](./0003-v2-result-type-shape.md); narrowing goes through `.match()`). Lifting a non-narrowing boolean onto `ResultAsync` buys nothing:

```ts
if (await ra.isOk()) {
  const r = await ra;   // Result<T,E> — a separate binding, NOT narrowed
  r.value;              // ✗ still an error
}
```

You `await` twice and narrow nothing. The correct code was always `const r = await ra; if (isOk(r)) { r.value }` — which **does** narrow, because `isOk` is a free function with a type predicate over a plain union — and it is shorter.

So the line is **principled, not arbitrary**: *a value-producing terminal is useful lifted* (it saves the intermediate binding and keeps the chain reading left-to-right); *a non-narrowing boolean guard is not*, because the only thing it would buy — narrowing — requires the plain union regardless.

Omitting them also removes a live footgun: `if (ra.isOk())` without `await` is a `Promise<boolean>`, which is **always truthy**. (Stock `@typescript-eslint/no-misused-promises` catches it, but not creating it is better.)

### 4. `toJSON()` throws

`ResultChain.toJSON()` is a pit-of-success net ([ADR 0004 §2](./0004-v2-api-surface-method-inventory.md)): an accidental `JSON.stringify(chain)` silently emits the correct plain union. **That net cannot be built for `ResultAsync`** — `JSON.stringify` is synchronous and the value is not available yet. A `toJSON()` returning a `Promise` serializes to `{}`; *omitting* `toJSON` also serializes to `{}` (the internal promise is a private field, so not enumerable).

The accident is therefore lossy either way, and the real choice is **silent vs. loud**:

```ts
toJSON(): never {
  throw new TypeError(
    'Cannot serialize an in-flight ResultAsync. ' +
    'await it first, then serialize the Result: JSON.stringify(await resultAsync)',
  );
}
```

[ADR 0008 §6](./0008-v2-migration-breaking-change-story.md) already fixed this project's stance on that axis — it singled out the `unwrapOrThrow` collision as *"the migration's only silent breakage… every other break in this migration is loud, which is why it is called out explicitly."* A `JSON.stringify` that silently yields `{}` is precisely the silent failure that stance rejects: a log line that looks fine and contains nothing.

Accepted cost: `JSON.stringify` can now throw, which may surprise a logger. Judged the lesser harm against silent data loss, and the message is directive enough to fix on sight.

### 5. `[Symbol.asyncIterator]`

`ResultAsync` is **async-iterable**, so `yield* someResultAsync` works inside a `/fluent` async `safeTry`.

This is **forced by [ADR 0007 §3](./0007-v2-do-notation-helper.md)**, not chosen. That table exports `safeTry` at `/fluent` but *not* `safeUnwrap`, justified by *"wrapper self-iterable — no `safeUnwrap` needed."* That reasoning only ever covered `ResultChain`: inside an `async function*`, `yield* ra` needs `[Symbol.asyncIterator]` on `ResultAsync` specifically — `ResultChain`'s sync `[Symbol.iterator]` does not cover it. Without this member, ADR 0007 §3's stated rationale is false and `/fluent` would have to re-export `safeUnwrap`.

Iterability on the wrapper does not touch [ADR 0003](./0003-v2-result-type-shape.md)'s plain-union / no-brand / JSON guarantee, which governs only the core union — the same reasoning ADR 0007 §2 applied to `ResultChain`.

## Rejected alternatives

- **Chaining + `.toResult()` only (no terminals).** The spec's first-pass derivation, and the reason this ADR exists. Thinnest wrapper, and *"`await` is the sanctioned exit"* stays a single story — but it rests on a misreading of ADR 0005 §2 (Context), deletes v1's `await chain.….match({…})` hero ergonomic, makes the async hero path clumsier than the sync one (`match(await ra, {…})`), and contradicts the research's *"ship a `match`"*. Rejected.
- **Only `.match()`** (exactly v1's `AsyncResultPipeline`). `match` is complete — every other terminal is expressible through it — and it is the one users actually reach for. But the v1 signal does not transfer (v1's *sync* pipeline also had only `match`, while v2's `ResultChain` has five), and it is the sharpest asymmetry with `ResultChain` for the least reason. Rejected.
- **`.match()` + `.unwrapOr()` only.** The two the research names as genre-converged. Leaner, and consistent with the map's aggressive cutting — but the line is arbitrary, and `await ra.unwrapOrThrow()` is a natural thing to want. Rejected — all five (§1).
- **Full symmetry including `isOk()` / `isErr()`.** One rule with no exceptions, and the always-truthy footgun is lint-caught — the same "stock lint covers it" argument [ADR 0005 §5](./0005-v2-async-strategy.md) made for `PromiseLike`. But lifted guards are *strictly worse than awaiting first* (§3): they cannot narrow, so they buy nothing at all. Rejected — the exception is principled.
- **Async terminal handlers (v1 parity).** `Awaitable<U>` handlers, as v1's `AsyncResultPipeline.match` had — saves an `.andThen()` hop. But it drags `Awaited<U>` into the return type and diverges the handler shape from the core's `match`. Rejected — sync handlers (§2).
- **No `toJSON()` on `ResultAsync`.** Leanest; never surprises a logger with a throw. But `JSON.stringify(ra)` then yields `{}` **silently** — the failure mode ADR 0008 treats as the worst kind. Rejected (§4).
- **`toJSON()` returning a pending marker** (e.g. `{ __pending: 'ResultAsync' }`). Visible in output, non-fatal, logger-safe — but invents a wire shape no consumer knows, and a marker in a payload can still slip through unnoticed. Rejected (§4).
- **Rename `ResultAsync` → `ResultChainAsync` for symmetry** with the spec's `ResultChain`. Considered and rejected while naming the sync wrapper: `ResultAsync` is locked by an accepted ADR, and amending it for cosmetics is not worth it. The asymmetric pair `ResultChain` / `ResultAsync` is accepted. (Recorded in [spec §10.1](../spec/v5-core-spec.md).)

## Consequences

- **`ResultAsync`'s surface is now fully specified** — the last open question on the v2 spec. [`docs/spec/v5-core-spec.md`](../spec/v5-core-spec.md) §6.2 carries the decided member list; its §10.4 ("needs confirmation") is resolved and points here.
- **[ADR 0005](./0005-v2-async-strategy.md) gains a forward note**, not an amendment. Its §2 stands exactly as accepted — the note only records that §2 is scoped to the functional core and never constrained the wrapper. Not a reversal; same pattern as [ADR 0006 → ADR 0001](./0001-v2-core-api-paradigm.md).
- **ADR 0005's three safety properties are unaffected.** Lossless `await`-collapse, never-forced-through-the-thenable, and floating-caught-by-`no-floating-promises` all still hold: terminals are additive, and none of them touches `then`.
- **`/fluent`'s export list is unchanged** — `ResultAsync` was already exported as a value for its `static from`. §5 confirms `safeUnwrap` stays out of `/fluent`, as ADR 0007 §3 says.
- **Two new test obligations** for the execution effort, beyond the spec's existing list: `toJSON()` throws with an actionable message, and `yield* resultAsync` works inside a `/fluent` async `safeTry`.
- **The map ([#8](https://github.com/alifaroo-q/result-kit/issues/8)) declared the fog fully cleared, and it was not.** This is the second decision found after the map closed (the first — naming the fluent wrapper `ResultChain` — is recorded in [spec §10.1](../spec/v5-core-spec.md)). Both were surfaced by consolidating the ADRs into a single spec, which is exactly the pressure that finds gaps eight separate documents hide. Neither invalidates any prior ADR.
- **Planning only** — implementation is the separate execution effort.
