# ADR 0007 — v2 `?`/do-notation helper (`safeTry` / `safeUnwrap`)

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 ?/do-notation helper (gen/safeTry)](https://github.com/alifarooq-zk/result-kit/issues/16)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0003 — v2 Result type shape](./0003-v2-result-type-shape.md), [ADR 0004 — v2 full API surface / method inventory](./0004-v2-api-surface-method-inventory.md), [ADR 0005 — v2 async strategy](./0005-v2-async-strategy.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md) (genre takeaway #8: the `?`/do-notation is the highest-ROI ergonomic)

## Context

Research ([#9](https://github.com/alifarooq-zk/result-kit/issues/9)) crowned the Rust `?`-operator analog — a **generator-based do-notation** for early-return unwrap (`neverthrow`'s `safeTry`, `Effect`'s `gen`) — the **single highest-ROI ergonomic** for the genre, explicitly framed as *optional sugar over the explicit core*. This ADR decides whether v2 ships it, its shape, its surfaces, its async behavior, its names, and its type contract.

It builds on a fully locked core: the paradigm (ADR 0001 — free-function core + opt-in fluent wrapper as the hero), the **plain method-less union with a no-brand / JSON round-trip guarantee** (ADR 0003), the operational surface with `andThen` accumulating `E | F` (ADR 0004), and split-async (ADR 0005 — core is `Promise<Result>`, `/fluent` adds `ResultAsync implements PromiseLike`, transforms follow the byethrow "one name, input drives output, no `Async` suffix" model). This is the **last design ticket** on the map; its outcome feeds the migration story ([#19](https://github.com/alifarooq-zk/result-kit/issues/19)).

The central tension: the map's destination is a *deliberately lean* core that has cut aggressively (10 methods removed, formatters declined to backlog [#18](https://github.com/alifarooq-zk/result-kit/issues/18), no `pipe`). Do-notation is additive and tree-shakable, so — like category subpaths (ADR 0006) — it *could* ship as a later non-breaking minor. It is decided here to ship it in 2.0.0 anyway.

## Decision

### 1. Ship in v2.0.0 (not deferred)

The do-notation helper ships **with the v2.0.0 core**, not as a later additive-minor. Although shipping it later would be a non-breaking minor (it is purely additive — one runner + one adapter, tree-shakable, touching neither the union nor any existing signature — the same logic that deferred formatters #18 and category subpaths), it is the ergonomic the research says most closes the gap to Rust's `?`, and the whole v2 thesis is "lean core **and** genuinely ergonomic." Deferring the promised centerpiece to a "someday minor" would undercut the launch narrative in a way deferring presentation helpers (#18) does not. It is already researched and HITL-decided, so the marginal cost of specifying it now is low.

### 2. Mechanism — `yield*` delegation via an adapter; the core union stays plain

The genre-standard ergonomic is **`yield*` delegation**, which is effectively *required* for good typing: delegation lets each yielded `Result` carry its own unwrapped type, so successive `yield*`s bind distinct types. Bare `yield` forces one monomorphic next-type across all yields and is unusable heterogeneously.

`yield*` requires the yielded thing to be **iterable**. Rather than make the core union iterable — which would add `[Symbol.iterator]` to what `ok()`/`err()` produce and **reopen ADR 0003's "plain data, no brand" guarantee** (the keystone that underwrites serializability and "async is just a promise of the interchange union") — iterability lives in a small **adapter**, `safeUnwrap`, not in the data. The plain union is untouched.

```ts
import { safeTry, safeUnwrap, ok } from '@zireal/result-kit'

const total = safeTry(function* () {
  const user  = yield* safeUnwrap(findUser(id))     // Err short-circuits, becomes safeTry's result
  const order = yield* safeUnwrap(loadOrder(user))  // each yield* binds its own T
  return ok(user.credit + order.total)              // explicit Ok
})
```

On `/fluent`, the wrapper is already a class, so it **implements `[Symbol.iterator]` itself** — there the pristine `yield* wrappedResult` works directly, no adapter call. (Adding an iterator to the *wrapper* does not touch ADR 0003, which governs only the core union.)

### 3. Both surfaces, mirrored (like the constructors)

`safeTry` is a top-level runner, not an instance method, so it is placed deliberately — following ADR 0001's **dual-constructor rule** and its ADR 0005 async application (same name, surface-appropriate return type), not a new placement rule.

| Entry | Exports | `safeTry` returns |
| --- | --- | --- |
| **`.` (root)** | `safeTry` **+** `safeUnwrap` | plain `Result` (sync) / `Promise<Result>` (async) |
| **`/fluent`** | `safeTry` (wrapper self-iterable — no `safeUnwrap` needed) | wrapper (sync) / `ResultAsync` (async) |

The root surface is **self-sufficient** — a functional-core user gets a complete do-notation story without importing `/fluent`, honoring ADR 0005's rejection of forcing core users through the wrapper. The `/fluent` `safeTry` returns a wrapper so the chain continues (`safeTry(fn).map(…).unwrapOr(d)`). Net new public surface: **`safeTry` + `safeUnwrap` at root, `safeTry` at `/fluent`** — all additive and tree-shakable.

### 4. Async — one overloaded `safeTry`, no `safeTryAsync`

Async ships in 2.0.0 (the realistic call sites — `findUser`, `loadOrder` — are almost always `Promise<Result>`; a sync-only helper would be a hollow win). It reuses the **same `safeTry` name**, overloaded on the generator kind — no `safeTryAsync` double, honoring ADR 0004's "all `xAsync` doubles cut" and ADR 0005's "one name, input drives output":

- a **sync** generator (`function*`) → `Result` (root) / wrapper (`/fluent`);
- an **async** generator (`async function*`) → `Promise<Result>` (root) / `ResultAsync` (`/fluent`).

`safeUnwrap` **overloads value-or-promise** (the byethrow model the transforms already committed to), so inside an async generator a `Promise<Result>` / `ResultAsync` is unwrapped with **zero `await` ceremony** — reading exactly like Rust's `?` in an `async fn`:

```ts
const total = await safeTry(async function* () {
  const user  = yield* safeUnwrap(findUser(id))     // findUser: Promise<Result> — no await
  const order = yield* safeUnwrap(loadOrder(user))
  return ok(order.total)
})
```

### 5. Names — `safeTry` + `safeUnwrap`

Both names are taken from **neverthrow** (~1.67M downloads/wk — the dominant incumbent per research), where they are *the* established pair for this pattern, making the highest-value migration path zero-surprise. The `safeUnwrap` adapter is deliberately **not** bare `unwrap` (ADR 0004 cut that token because "unwrap = throws" across the genre); `safeUnwrap` is unambiguous, says exactly what it does at the call site, and only ever appears inside a `safeTry` block.

> **Amendment (2026-07-16, during [#23](https://github.com/alifarooq-zk/result-kit/issues/23)).** Half of this rationale has since expired, and a later reader should not cite it as written. `safeTry` is still current in neverthrow, but **`safeUnwrap` was deprecated in neverthrow 8.1.0** (`@deprecated will be removed in 9.0.0`): they moved iterability onto `Ok`/`Err` via `Symbol.iterator`, so their consumers now write `yield* result` with no adapter call. A migrating user therefore meets `safeUnwrap` here as a required free function, having just been told upstream to stop calling it as a method — same token, different status, different shape. "Zero-surprise" now overstates it.
>
> **The decision stands, on §2's reasoning rather than this section's.** The name is kept: it is self-describing, §5's ban on bare `unwrap` is untouched, and renaming after 5.0.0 would be breaking. Note this does **not** reopen §2 — neverthrow can put `Symbol.iterator` on its data because its data is already a class; ours is a plain union whose no-brand / JSON guarantee (ADR 0003) is the keystone the adapter exists to protect. Their convergence on iterable data is a consequence of their shape, not evidence against ours.

### 6. Type contract — explicit `Result` return, union-accumulated error channel

- The generator **returns a `Result` explicitly** (`return ok(value)` / early `return err(e)`); `safeTry` returns that `Result` directly rather than auto-wrapping a bare value. This matches the explicit-core ethos and neverthrow's contract, and permits a deliberate early `return err(...)`.
- The error channel is a **union, accumulated**: `safeTry` yields `Result<TReturn, E₁ | E₂ | … | Eₙ | Eᵣ>` — every `safeUnwrap`'d error type plus the returned `err`'s type. This is the **same rule `andThen` uses** (ADR 0004; do-notation is `andThen` chaining with nicer syntax). TypeScript has no `From` trait, so there is **no Rust-style error coercion** — coercion would reintroduce the fp-ts `chainW`/`mapLeft` gymnastics the map rejected.

## Alternatives considered

- **Defer to a v2.x additive-minor.** Safe and non-breaking (as with #18 / subpaths) — but it withholds the crown-jewel ergonomic the "lean *and* ergonomic" positioning promises at launch. Rejected — ship in 2.0.0 (§1).
- **Make the core union iterable (`yield* result` everywhere).** Cleanest possible call-site — but `ok()`/`err()` would stop producing plain data, reopening ADR 0003's no-brand / JSON guarantee for the sake of *optional sugar*. Rejected in favor of the `safeUnwrap` adapter (§2).
- **Bare `yield` instead of `yield*`.** No iterable needed — but forces one monomorphic next-type across all yields, breaking heterogeneous unwrap typing. Rejected (§2).
- **Core-only (no `/fluent` `safeTry`).** Smaller surface — but makes the fluent surface asymmetric with every other constructor and loses chain-continuation on the "documented hero" path. Rejected — mirror both (§3).
- **Fluent-only.** Rejected — repeats the footgun ADR 0005 named (forcing core users through the wrapper) (§3).
- **A separate `safeTryAsync`.** Familiar shape — but a brand-new `xAsync` double, exactly what ADR 0004 cut and ADR 0005's "one name" model exists to avoid. Rejected — overload the single `safeTry` (§4).
- **`safeUnwrap` stays sync; `await` before it.** Simpler adapter (no overload), consistent with ADR 0005's "terminals stay sync, await before" — but `safeUnwrap` is an unwrap-in-scope, not a terminal, and manual `await`s reintroduce exactly the ceremony do-notation exists to kill. Rejected — overload value-or-promise (§4).
- **Names `gen` / `bind`.** `gen` (Effect) is terser but cryptic to non-Effect users; `bind` keeps the `unwrap` token fully banished and is monadically exact but is FP jargon on a lib whose thesis is approachability. Rejected in favor of the neverthrow-familiar `safeTry` + `safeUnwrap` (§5).
- **Rust-style `From` error coercion.** Matches Rust's `?` exactly — but TypeScript has no `From`; emulating it needs the fp-ts `chainW`/`mapLeft` gymnastics the map rejected. Rejected — accumulate the union (§6).

## Consequences

- The functional core gains **two** new tree-shakable free functions (`safeTry`, `safeUnwrap`); `/fluent` gains **one** (`safeTry`) plus a `[Symbol.iterator]` on the existing wrapper class. All additive; none touch an existing signature.
- ADR 0003's plain-union / no-brand / JSON round-trip guarantee is **preserved** — iterability is confined to the `safeUnwrap` adapter and the (already classful) fluent wrapper.
- The async model adds **zero** new type names beyond what ADR 0005 already introduced — async do-notation returns stdlib `Promise<Result>` (root) or the existing `ResultAsync` (`/fluent`).
- **Unblocks the migration story ([#19](https://github.com/alifarooq-zk/result-kit/issues/19))** — the last design blocker. `safeTry`/`safeUnwrap` are net-*new* additions (no v1 equivalent), so they enter #19's guide as an "additions" note, not a rename/cut row.
- **Planning only** — implementation (the `safeTry` runner + overloads, the `safeUnwrap` adapter + value-or-promise overload, the wrapper's `[Symbol.iterator]`, and the fluent-boundary bundle guard from ADR 0006 extended to cover them) is the separate execution effort. The changeset is added at implementation time.
