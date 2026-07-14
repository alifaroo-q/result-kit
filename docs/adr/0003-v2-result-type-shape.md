# ADR 0003 — v2 Result type shape

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 Result type shape](https://github.com/alifarooq-zk/result-kit/issues/12)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0002 — v2 TypedError model](./0002-v2-typederror-model.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md)

## Context

[ADR 0001](./0001-v2-core-api-paradigm.md) fixed `Result<T, E>` as a **plain, method-less discriminated union** `{ ok: true, value } | { ok: false, error }` — the serializable source of truth, with a data-first free-function core and an opt-in fluent wrapper delegating to it. [ADR 0002](./0002-v2-typederror-model.md) fixed the error *value*. This ADR pins the **exact shape** of the union itself: its identity model, encoding, immutability contract, guards, serialization guarantee, and root constructor signatures. It feeds the API surface / method inventory ([#13](https://github.com/alifarooq-zk/result-kit/issues/13)) and package layout ([#15](https://github.com/alifarooq-zk/result-kit/issues/15)) tickets.

v1's baseline: two exported interfaces `Success<T>` / `Failure<E>` with `readonly ok/value/error`, no brand, no opposite-field `never`, and static `ResultKit.success`/`failure`/`fail` constructors.

## Decision

```ts
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function isOk<T, E>(result: Result<T, E>): result is Ok<T>;
export function isErr<T, E>(result: Result<T, E>): result is Err<E>;

export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function err<E>(error: E): Err<E>;
```

### 1. Purely structural — no brand, no nominal tag

`Result` carries **no** hidden brand, symbol, or nominal marker. Any object of shape `{ ok: true, value }` **is** an `Ok<T>`; any `{ ok: false, error }` **is** an `Err<E>`, regardless of who constructed it. Identity is 100% structural and `switch (r.ok)`-narrowable.

Rationale: a brand directly contradicts ADR 0001's interchange thesis. A branded union would make `JSON.parse(JSON.stringify(result))` *no longer a valid `Result`*, and a union arriving over the wire from another service would need re-wrapping before use — the exact `instanceof` dual-package hazard, reintroduced at the type level. The research favors "stay structural + `switch`-narrowable." The apparent cost (a hand-authored `{ ok: true, value }` type-checks as a `Result`) is a **feature**: it is what lets a deserialized or cross-boundary object flow straight in (§5).

### 2. Encoding — named `Ok<T>` / `Err<E>` halves, exported; no opposite-field `never`

- **The two halves are named, exported interfaces** — renamed from v1's `Success<T>` / `Failure<E>` to **`Ok<T>` / `Err<E>`** to match the `ok` / `err` / `isOk` / `isErr` family (CONTEXT.md retired the constructor names `success`/`failure`; the type names follow). They are genuine public types: a function that only ever succeeds annotates `Ok<T>`, and they are the narrowing targets `isOk` / `isErr` point at (§4). Type and value namespaces are separate, so the `Ok<T>` **type** and the `ok` **constructor** coexist without collision.
- **No opposite-field `never`.** We do *not* add `error?: never` to `Ok` or `value?: never` to `Err`. The `ok` boolean is already a complete discriminant (`switch (r.ok)` / `if (r.ok)` narrows fully), so field-presence narrowing is redundant; and a `?: never` field muddies the serialization shape (invites "must `error` be materially absent?" confusion) for no gain. Each half stays exactly two fields.

### 3. Immutability — shallow `readonly`, no deep-readonly, no runtime freeze

- **Shallow `readonly`** on `ok`, `value`, and `error` (as v1). The `Result` is a control-flow envelope, not a mutable container; reassigning `r.ok` (turning a success into a failure in place) is nonsense the type should forbid. Costs nothing, documents intent.
- **No deep immutability.** `value` / `error` are **not** wrapped in `DeepReadonly<T>`. That would force consumers to deal with a deeply-frozen contained value they cannot mutate for legitimate local reasons, complicate every generic signature in the core, and buy nothing for interchange (it is compile-time only, erased on serialization). The contained value's mutability is the value's own business.
- **No runtime `Object.freeze`.** Constructors do not freeze the objects they return — a per-call runtime cost for a guarantee the `readonly` types already express at compile time.

### 4. Guards — `isOk` / `isErr` free functions with type predicates; fluent mirrors as booleans

- **`isOk(result)` / `isErr(result)` are data-first free functions** in the core, matching the `ok` / `err` constructors and the `isTypedError` guard kept by ADR 0002.
- **They emit type predicates** — `result is Ok<T>` / `result is Err<E>` — so `if (isOk(r)) { r.value }` narrows `r` to the success half (and forbids `.error`). This is why the `Ok<T>` / `Err<E>` halves stay exported (§2): they are the narrowing targets.
- **The fluent wrapper mirrors `.isOk()` / `.isErr()` as plain-boolean convenience checks** (one-line delegation to the free function over the underlying union), so a hero-path user reaching for `if (result.isOk())` does not hit a DX cliff. But *type-safe narrowing* on the fluent side goes through `.match()` / terminals: a method cannot emit a predicate that narrows the wrapper's own generics the way the free function narrows the plain union. (Exact wrapper surface is [#13](https://github.com/alifarooq-zk/result-kit/issues/13)'s to ratify; recorded here as the guard-family interaction.)

### 5. Serialization — published JSON round-trip guarantee, scoped `cause` carve-out

- **Public guarantee:** if `T` and `E` are JSON-serializable, then `JSON.parse(JSON.stringify(result))` is a valid, structurally-identical `Result<T, E>`, consumable with **no** re-wrapping. This is provable given no brand (§1) and no methods on the union (ADR 0001), and is a genuine differentiator — a `Result` can be an HTTP response body, a queue message, or a `postMessage` payload.
- **`cause` carve-out (coordination with ADR 0002 §3).** The guarantee covers the union's own fields (`ok`, `value` / `error`). When `error` is a `TypedError`, `{ type, message, details }` is JSON-safe but a populated `cause?: unknown` may not be. The contract cross-references ADR 0002: a `TypedError` with a non-serializable `cause` must have it sanitized/dropped **by the caller** before serializing. The core never silently mutates error data to auto-strip `cause`.
- **`.toResult()`-before-serialize rule (fluent wrapper).** You never `JSON.stringify` a wrapper instance — it is a class instance whose serialization would leak private internals or fail to deserialize back to a wrapper, and hits the dual-package `instanceof` hazard. Exit to the plain union with `.toResult()` first, then serialize that. Whether the wrapper additionally defends this with a `toJSON()` that returns the underlying union (pit of success) is **wrapper API surface deferred to [#13](https://github.com/alifarooq-zk/result-kit/issues/13) / execution**, not mandated here.

### 6. Root constructor signatures — narrow returns, `ok()` void overload

```ts
function ok(): Ok<void>;
function ok<T>(value: T): Ok<T>;
function err<E>(error: E): Err<E>;
```

- **`err<E>(error: E): Err<E>`** — one required arg (a failure carrying no error is meaningless), returns the narrow `Err<E>`. `err` is the *single* generic failure constructor; ADR 0002 collapsed v1's `fail` / `failure` split — the typed convention is expressed by *what you pass* (`err(notFound({ id }))`), not a second constructor.
- **`ok(): Ok<void>` overload** for the common `Result<void, E>` success — `return ok()` reads better than the otherwise-forced `ok(undefined)`.
- **`ok<T>(value: T): Ok<T>`** — the general case.
- **Narrow return types** (`Ok<T>` / `Err<E>`, not `Result<T, never>` / `Result<never, E>`). Narrow is strictly more precise: it still assigns cleanly into any `Result<T, E>` annotation (widening is free) while preserving full `.value` / `.error` access for code holding a known half. The wide form discards information for no benefit.
- These are the **root** `@zireal/result-kit` plain-union constructors. The `@zireal/result-kit/fluent` entrypoint's wrapping `ok` / `err` (returning the wrapper) are [#15](https://github.com/alifarooq-zk/result-kit/issues/15) / [#13](https://github.com/alifarooq-zk/result-kit/issues/13)'s concern.

## Rejected alternatives

- **Branded / nominal `Result`.** Buys nominal safety (a hand-typed `{ ok: true, value }` would not type-check; `isOk` could verify provenance) — but breaks the serialization round-trip, forces re-wrapping of cross-boundary unions, and reintroduces the `instanceof` dual-package hazard at the type level. Rejected — purely structural (§1).
- **Inline anonymous halves / unexported `Success`/`Failure`.** Smaller surface — but loses genuinely useful public annotation types and the `isOk`/`isErr` narrowing targets. Rejected — named, exported `Ok<T>`/`Err<E>` (§2).
- **Keep the `Success<T>` / `Failure<E>` names.** Consistent with v1 — but drifts from the `ok`/`err`/`isOk`/`isErr` vocabulary the constructors and guards standardize on. Rejected — renamed to `Ok`/`Err` (§2).
- **Opposite-field `never` (`error?: never` / `value?: never`).** Enables field-presence narrowing and friendlier malformed-object errors — but is redundant with the complete `ok` discriminant and muddies the serialization shape. Rejected (§2).
- **Deep immutability (`DeepReadonly<T>` on `value`/`error`).** Freezes the whole contained graph at the type level — but is invasive, surprising to consumers, complicates every generic signature, and is erased on serialization. Rejected — shallow `readonly` (§3).
- **Drop `readonly` entirely.** Simpler types — but permits nonsensical in-place mutation of a control-flow envelope. Rejected — keep shallow `readonly` (§3).
- **Runtime `Object.freeze` in constructors.** Enforces immutability at runtime — but a per-call cost for what `readonly` already expresses at compile time. Rejected (§3).
- **Guards as plain-boolean predicates (no `is`).** Simpler signatures — but defeat the entire purpose: `if (isOk(r))` would not narrow `r` to `Ok<T>`, leaving `.value` unreachable. Rejected — type predicates (§4).
- **Bare fluent wrapper with no `.isOk()`/`.isErr()` (narrow only via `.toResult()`).** Thinnest possible envelope — but a jarring DX cliff on the hero path (`if (result.isOk())` hitting nothing). Rejected — mirror as plain-boolean conveniences, narrow via `.match()` (§4).
- **Wide constructor return types (`Result<T, never>`).** Symmetric with the `Result` alias — but discards the known-half information the narrow return preserves, for no benefit. Rejected — narrow returns (§6).
- **`ok` strictly single-arg (`ok(undefined)` for void).** One fewer overload — but a worse read for the frequent `Result<void, E>` success. Rejected — add the `ok(): Ok<void>` overload (§6).

## Consequences

- **v1 → v2 type renames:** `Success<T>` → `Ok<T>`, `Failure<E>` → `Err<E>` (both still exported). A breaking change captured in the v2 migration story (still fog, gated on #13).
- **v1 → v2 constructor changes:** `ResultKit.success` / `failure` / `fail` → root free functions `ok` / `err` (single generic `err`, per ADR 0002); `ok()` gains a void overload. Migration-story material.
- **`isOk` / `isErr` are new public free functions** joining `isTypedError` (ADR 0002) in the guard family; the fluent wrapper gains boolean `.isOk()`/`.isErr()` (surface ratified by #13).
- **The JSON round-trip guarantee is now a documented public contract** (§5), with the `cause` carve-out cross-referenced to ADR 0002 and the `.toResult()`-before-serialize rule for the wrapper.
- **[#13](https://github.com/alifarooq-zk/result-kit/issues/13) is now unblocked** — the API surface / method inventory can lock every function signature against this concrete union shape. **[#15](https://github.com/alifarooq-zk/result-kit/issues/15)** (package layout) consumes the root-vs-`/fluent` constructor split.
- Implementation (renaming the interfaces, adding `isOk`/`isErr` and the free-function constructors, removing the static `ResultKit` toolbox) happens in the **separate execution effort**, not now (map is planning-only).
```
