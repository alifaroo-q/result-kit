# ADR 0005 — v2 async strategy (split-async)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 async strategy (split-async)](https://github.com/alifarooq-zk/result-kit/issues/14)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0003 — v2 Result type shape](./0003-v2-result-type-shape.md), [ADR 0004 — v2 full API surface / method inventory](./0004-v2-api-surface-method-inventory.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md), [`@praha/byethrow`](https://github.com/praha-inc/byethrow), [`eslint-plugin-neverthrow`](https://github.com/mdbetancourt/eslint-plugin-neverthrow)

## Context

ADR 0004 locked the complete **synchronous** surface and recorded one async ruling — the v1 `xAsync` doubles (`mapAsync`, `mapErrorAsync`, `andThenAsync`, `orElseAsync`, `matchAsync`, `unwrapOrElseAsync`, `tapAsync`, `combineAsync`, `combineWithAllErrorsAsync`, `fromThrowableAsync`) and the fp-ts-backed `AsyncResultPipeline` class are **cut** — and handed the **positive** async model here. This ADR decides how async is expressed instead.

v1's async surface was a doubled method set plus a separate `AsyncResultPipeline` built on fp-ts `TaskEither` (`src/internal/fp-ts.ts`). Removing fp-ts (a destination constraint) forces a from-scratch async model regardless; the question is its *shape*.

The keystone retro ([#10](https://github.com/alifarooq-zk/result-kit/issues/10) / [ADR 0001](./0001-v2-core-api-paradigm.md)) surfaced the driving footgun: a single unified `ResultAsync` thenable as the **only** async story (neverthrow's model) invites **accidental-`await` collapse**, a floating-thenable lint gap, and sync↔async inference degradation. It handed this ticket a **split-async** fork to confirm or revise.

## Decision

### 1. Two async models, split by surface

Async is a **fork keyed to surface**, mirroring ADR 0001's paradigm split — *not* one mechanism:

- **Functional core** models async as plain **`Promise<Result<T, E>>`**. There is no `ResultAsync` type in the core; async is "just a promise of the interchange union," and `await` yields a `Result` you pattern-match. Nothing to tree-shake, nothing new to learn.
- **Fluent path** additionally offers an awaitable **`ResultAsync`** wrapper (`implements PromiseLike<Result<T, E>>`) so `.map().andThen()` chains survive an async boundary without re-wrapping at each step.

One mechanism per surface, each idiomatic to that surface.

### 2. Functional core — unified *transforms* (byethrow), synchronous terminals

The core transform functions are overloaded so the **input drives the output**: a plain `Result` in yields a `Result` out; a `Promise<Result>` **or** an async callback yields a `Promise<Result>` out. One name, **no `Async` suffix**. This is the [`@praha/byethrow`](https://github.com/praha-inc/byethrow) model, and it is what lets the functional core handle async with neither doubled methods nor the fluent wrapper.

Scope: **transforms only** — `map`, `mapErr`, `andThen`, `orElse`, `inspect`, `inspectErr`.

```ts
// Illustrative overload shape (map; the other transforms mirror it).
function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>;
function map<T, U, E>(result: Result<T, E>, fn: (value: T) => Promise<U>): Promise<Result<U, E>>;
function map<T, U, E>(result: Promise<Result<T, E>>, fn: (value: T) => U | Promise<U>): Promise<Result<U, E>>;
// => andThen(fetchUser(id), validate) "just works" when fetchUser returns Promise<Result>.
```

**Terminals stay strictly synchronous** — `match`, `unwrapOr`, `unwrapOrElse`, `unwrapOrThrow`, `toNullable`. You `await` before a terminal (natural, since a terminal ends the chain), so unifying them buys nothing and only complicates inference.

**Collections stay sync-only** — `combine`, `combineWithAllErrors`, `partition` do not accept promise inputs. The async use case ("array of `Promise<Result>` → one `Result`") is served by idiomatic `await Promise.all([...])` before handing the plain `Result[]` to the combinator. Overloading over *arrays of unions vs. arrays of promises-of-unions* is a combinatorial inference mess for a thin ergonomic gain; declined.

### 3. Async constructors — `fromPromise` (eager) + `fromThrowableAsync` (lazy)

Entering the async-result world from a raw promise or async function (catching rejection into the `E` channel) is a **construction** concern — the unified transforms operate on `Promise<Result>`, not `Promise<T>`, and cannot catch a rejection. Two constructors, mirroring the sync `fromThrowable` (lazy) locked in ADR 0004:

```ts
// eager — the common "promise already in hand" case
function fromPromise<T, E>(promise: Promise<T>, onReject: (error: unknown) => E): Promise<Result<T, E>>;

// lazy — reusable wrapper around an async fn; async twin of ADR 0004's fromThrowable
function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => Promise<Result<T, E>>;
```

Both earn their place: `fromPromise` keeps the overwhelmingly common path a one-liner (vs. `fromThrowableAsync(() => p)()`); `fromThrowableAsync` gives the reusable-wrapper symmetry with sync `fromThrowable`. The **`Async` suffix** (`fromThrowableAsync`, not `fromAsyncThrowable`) reads as "the async variant of `fromThrowable`" and is the one async name v1 users already know.

### 4. Placement — both-mirrored (dual constructors, per ADR 0001)

The async constructors and `ResultAsync` follow ADR 0001's **dual-constructor boundary** exactly — same names, surface-appropriate return types — rather than inventing a new placement rule.

| Entry | `fromPromise` / `fromThrowableAsync` return | `ResultAsync` type |
|---|---|---|
| **Root** `@zireal/result-kit` | plain `Promise<Result<T, E>>` | **does not exist here** |
| **`/fluent`** | a **`ResultAsync`** wrapper | defined here |

- **Root** stays the self-sufficient functional core: async without ever importing the wrapper.
- **`/fluent`** adds `ResultAsync.from(promiseOfResult)` to lift an in-flight union; any fluent transform given an async callback naturally produces a `ResultAsync`; exit via an async `.toResult()` → `Promise<Result>` back to the core, mirroring the sync `.toResult()`.

Putting async constructors *only* at `/fluent` would force functional-core users through the wrapper (breaking core self-sufficiency); putting `ResultAsync` at root would drag the wrapper into the tree-shakable core (violating ADR 0001). Both rejected.

### 5. Safety mitigations for `implements PromiseLike`

- **`await`-collapse is documented as intentional & lossless.** `await someResultAsync` yields the plain `Result` union — **by design**, exactly equivalent to `await ra.toResult()`. Awaiting *is* the sanctioned exit from the fluent async surface, not an accident. Spec'd as a documented guarantee.
- **Never forced through the thenable.** Structural invariant: because the functional core hands you `Promise<Result>` directly (§2/§4), no one ever *has* to touch `ResultAsync` to do async work. The wrapper is pure opt-in ergonomics. No new work — guaranteed by the split.
- **Async floating caught for free.** Because `ResultAsync implements PromiseLike`, a floating (un-`await`ed) `ResultAsync` is already flagged by the stock `@typescript-eslint/no-floating-promises` rule every TS project runs. Implementing `PromiseLike` **closes** the floating-thenable gap that v1's custom thenable left open — called out in the spec as an explicit design payoff.

## Rejected alternatives

- **Single unified `ResultAsync` thenable as the only async story** (neverthrow) — the footgun that spawned this ticket: accidental-`await` collapse, and a functional core that can't do async without the wrapper. Rejected in favour of the surface split.
- **v1's doubled `xAsync` methods + `AsyncResultPipeline`** — already cut by ADR 0004; fp-ts-bound and doubles the surface.
- **Unifying terminals and/or collections** over value-or-promise — inference cost without ergonomic payoff (you `await` before a terminal anyway; `Promise.all` covers collections).
- **A custom must-use ESLint rule shipped as part of v2** — see Out of scope.

## Out of scope

- **A companion `eslint-plugin-result-kit` must-use rule for the *sync* `Result` union.** Stock `no-floating-promises` already covers the async wrapper (§5); the residual case is a dropped *sync* union, which needs a separate eslint-plugin package that lives outside the zero-dependency core by definition. Ruled **out of scope** for this map — lint is left to the user's stock tooling. (Recorded on the map's Out-of-scope section.)

## Consequences

- The v2 async model adds **zero new type names to the functional core** (`Promise<Result>` is stdlib) and exactly **one** to the fluent surface (`ResultAsync`), against v1's ~10 `xAsync` methods + `AsyncResultPipeline`.
- The transform overloads (§2) are the one place conditional/overloaded return types re-enter the "lean" core; scoped to six functions and validated by byethrow's shipping precedent.
- This ADR completes the **positive** async model deferred by ADR 0004. Together with package layout ([#15](https://github.com/alifarooq-zk/result-kit/issues/15)) and the `?`/do-notation helper ([#16](https://github.com/alifarooq-zk/result-kit/issues/16)), it feeds the migration & breaking-change story ([#19](https://github.com/alifarooq-zk/result-kit/issues/19)) — the final decision before the v2 spec is handoff-ready.
- **Planning only** — implementation (overload authoring, `ResultAsync` class, deleting `src/internal/fp-ts.ts` and `AsyncResultPipeline`) is the separate execution effort.
