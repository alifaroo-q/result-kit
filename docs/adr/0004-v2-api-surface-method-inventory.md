# ADR 0004 — v2 full API surface / method inventory

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 full API surface / method inventory](https://github.com/alifarooq-zk/result-kit/issues/13)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0002 — v2 TypedError model](./0002-v2-typederror-model.md), [ADR 0003 — v2 Result type shape](./0003-v2-result-type-shape.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md)

## Context

ADR 0001 fixed the paradigm (modular free-function core over a plain method-less union + opt-in fluent wrapper). ADR 0002 fixed the error value; ADR 0003 fixed the union shape and the root `ok`/`err`/`isOk`/`isErr` constructors and guards. This ADR pins the **operational surface** on top of them: which of v1's ~40 `ResultKit` static methods survive, rename, or are cut, and the exact signature of every surviving free function plus its fluent-wrapper mirror.

v1's baseline is a **static `ResultKit` toolbox of 47 method definitions** (constructors, guards, transforms, terminals, collection combinators, interop constructors, an fp-ts-backed `pipe`/`pipeAsync` fluent mechanism, and an `xAsync` twin for most transforms). ADR 0003 already retires the static toolbox and renames the constructor/guard/type family; this ADR decides the rest.

### Scope seam — sync inventory here, async model in #14

This ADR locks the complete **synchronous** inventory and both surfaces' signatures. It records exactly one async ruling — **the v1 `xAsync` doubles are cut** (`mapAsync`, `mapErrorAsync`, `andThenAsync`, `orElseAsync`, `matchAsync`, `unwrapOrElseAsync`, `tapAsync`, `combineAsync`, `combineWithAllErrorsAsync`, `fromThrowableAsync`) — and hands the **positive async model** (how async is expressed instead, and the fate of `fromPromise`) to the async-strategy ticket ([#14](https://github.com/alifarooq-zk/result-kit/issues/14)). Package layout (root vs `/fluent` entrypoints) is [#15](https://github.com/alifarooq-zk/result-kit/issues/15); the `?`/do-notation helper is [#16](https://github.com/alifarooq-zk/result-kit/issues/16). None of those are decided here.

## Decision

### 1. Core free functions (`@zireal/result-kit`)

**Constructors & guards** *(fixed by prior ADRs; listed for completeness)*

```ts
function ok(): Ok<void>;
function ok<T>(value: T): Ok<T>;
function err<E>(error: E): Err<E>;                                  // ADR 0003
function isOk<T, E>(result: Result<T, E>): result is Ok<T>;         // ADR 0003
function isErr<T, E>(result: Result<T, E>): result is Err<E>;       // ADR 0003
function isTypedError(error: unknown): error is TypedError<string>; // ADR 0002
// defineError(...) — ADR 0002 §4
```

**Transforms** — `andThen` / `orElse` accumulate their error / success union (research takeaway #2; avoids fp-ts's no-auto-union trap):

```ts
function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>;
function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F>;
function andThen<T, U, E, F>(result: Result<T, E>, fn: (value: T) => Result<U, F>): Result<U, E | F>;
function orElse<T, E, U, F>(result: Result<T, E>, fn: (error: E) => Result<U, F>): Result<T | U, F>;
```

**Side-effect tees** — replace v1's combined `tap({ onSuccess, onFailure })` with two focused single-side functions (research takeaway #7; true-myth / Rust naming). Both return the result unchanged:

```ts
function inspect<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E>;
function inspectErr<T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E>;
```

**Terminals** — value-returning `match` object fold with `ok`/`err` keys (both required → exhaustive by construction); the single throwing extractor is honestly named `unwrapOrThrow`:

```ts
function match<T, E, U>(result: Result<T, E>, cases: { ok: (value: T) => U; err: (error: E) => U }): U;
function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T;
function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T;
function unwrapOrThrow<T, E>(result: Result<T, E>, message?: string): T;   // NEW — throws on Err
function toNullable<T, E>(result: Result<T, E>): T | null;
```

**Collections** — `combine` and `combineWithAllErrors` gain tuple preservation (heterogeneous per-position types) with the array form as the homogeneous case; `combine` is fail-fast (first error), `combineWithAllErrors` accumulates every error as the `ZodError.issues[]` analog. `partition` is the best-effort splitter:

```ts
// fail-fast; errors unioned
function combine<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>>;

// accumulate-all; errors collected as a flat array (the issues[] analog)
function combineWithAllErrors<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>[]>;

// best-effort split — always returns the successes that worked and the failures separately
function partition<T, E>(results: Result<T, E>[]): [T[], E[]];
```

**Interop constructors** — `fromThrowable` stays lazy (returns a reusable wrapped function); `fromPredicate` gains a type-guard overload that narrows the success type:

```ts
function fromNullable<T, E>(value: T | null | undefined, error: E): Result<NonNullable<T>, E>;

function fromPredicate<T, S extends T, E>(value: T, predicate: (value: T) => value is S, error: E): Result<S, E>;
function fromPredicate<T, E>(value: T, predicate: (value: T) => boolean, error: E): Result<T, E>;

function fromThrowable<Args extends unknown[], T, E>(
  fn: (...args: Args) => T,
  errorFn: (error: unknown) => E,
): (...args: Args) => Result<T, E>;
```

### 2. Fluent wrapper (`@zireal/result-kit/fluent`)

The wrapper mirrors only the functions that operate on a **single Result instance**, delegating one-to-one to the core. Array- and entry-shaped functions stay free-function-only (re-enter fluent-land with `from(...)`).

| Wrapper member | Kind | Delegates to |
|---|---|---|
| `.map(fn)` `.mapErr(fn)` `.andThen(fn)` `.orElse(fn)` | chaining → wrapper | `map` / `mapErr` / `andThen` / `orElse` |
| `.inspect(fn)` `.inspectErr(fn)` | chaining → wrapper | `inspect` / `inspectErr` |
| `.match({ ok, err })` | terminal → value | `match` |
| `.unwrapOr(d)` `.unwrapOrElse(fn)` `.unwrapOrThrow(msg?)` `.toNullable()` | terminal → value | corresponding core fn |
| `.isOk()` / `.isErr()` | terminal → **boolean** | `isOk` / `isErr` (booleans, not predicates — ADR 0003 §4; narrowing goes through `.match()`) |
| `.toResult()` | exit → plain union | (unwraps) |
| `.toJSON()` | serialization net → plain union | returns `this.toResult()` |

`.toJSON()` is the pit-of-success net ADR 0003 §5 deferred here: an accidental `JSON.stringify(wrapper)` silently emits the correct plain union instead of leaking class internals (the `Date.prototype.toJSON` idiom). The documented serialize path stays `.toResult()` → `JSON.stringify`; `toJSON()` only makes the mistake lossless. The `/fluent` `ok`/`err`/`from` constructors are fixed by ADR 0001 §4.

### 3. Renamed

- `mapError` → **`mapErr`** — aligns with the locked `err` / `isErr` / `Err` family and the genre standard.
- `match` handler keys `onSuccess` / `onFailure` → **`ok` / `err`**.
- *(from prior ADRs: `Success`/`Failure` → `Ok`/`Err`; `success`/`failure`/`fail` → `ok`/`err`; `isSuccess`/`isFailure` → `isOk`/`isErr`.)*

### 4. Cut (10)

| Cut | Reason |
|---|---|
| `bimap` | `mapErr(map(r, onOk), onErr)` — compositional redundancy |
| `flatten` | `andThen(r, x => x)` — compositional redundancy |
| `unwrap` (→ `T \| undefined`) | name is a genre footgun (peers' `unwrap` **throws**); `toNullable` covers value-or-empty |
| `unwrapSuccess` / `unwrapFailure` | redundant with field access after `isOk`/`isErr` narrowing |
| `tap` | replaced by `inspect` / `inspectErr` |
| `filterSuccesses` / `filterFailures` | each is a half of `partition` |
| `pipe` / `pipeAsync` (+ `ResultPipeline` / `AsyncResultPipeline`) | fp-ts-backed fluent mechanism; the `/fluent` wrapper replaces it, and ADR 0001 rejected a data-last `pipe` façade — no `pipe()` free function exists in v2 |

### 5. Added (net-new)

`unwrapOrThrow` · `inspect` · `inspectErr` · wrapper `.toJSON()` · the `fromPredicate` type-guard overload.

## Rejected alternatives

- **Keep `mapError` (long form).** Consistent with v1 — but the lone straggler against the locked `Err` vocabulary. Rejected — `mapErr`.
- **Keep `bimap` / `flatten`.** Convenience aliases — but each is a one-liner over surviving primitives and no genre peer ships them; dilutes a lean surface. Rejected — cut.
- **Monomorphic `andThen` (v1's `Result<U, E>`).** Simpler signature — but forgoes the single most valuable inference behavior and reintroduces fp-ts's `chainW`/`mapLeft` gymnastics. Rejected — accumulate `E | F`.
- **A non-throwing `unwrap` (v1's `T | undefined`).** Familiar from v1 — but the `unwrap` name means "throw" everywhere else in the genre, inviting silent-undefined bugs. Rejected — cut the name; `toNullable` for value-or-empty.
- **No throwing extractor at all.** Purist — but tests/prototypes read far better as `unwrapOrThrow(r)` than a 3-line narrow-or-throw, and the honest `OrThrow` suffix avoids the bare-`unwrap` footgun. Adopted one; **no err-side `unwrapErrOrThrow`** (kept lean, add later if demanded).
- **Combined `tap({ onSuccess, onFailure })`.** One method — but two focused tees compose better in a chain and match the Rust/true-myth naming the research steered to. Rejected — `inspect` / `inspectErr`.
- **Homogeneous-array-only `combine`.** Matches v1 — but collapses heterogeneous tuples to a union array, discarding per-position types. Rejected — tuple-preserving + error-union.
- **Drop `partition` too (maximally lean).** Considered — but `partition` is best-effort (always returns the successes that worked *plus* the failures), a batch-processing capability the all-or-nothing combinators can't express and that is fiddly to hand-roll. Kept `partition`; cut only the two single-side filters.
- **Eager `fromThrowable(() => …)`.** One-shot ergonomics — but the lazy form is strictly more flexible (reusable wrapped fn *and* one-shot via a thunk), preserves the arg list, and matches neverthrow + v1. Rejected — lazy.
- **Ship formatter helpers for accumulated errors (`format`/`flatten`).** Zod-style presentation — but net-new surface against the "lean-down, not feature-expansion" destination; v1 has none, and formatting `TypedError[]` is a userland `.map()`. Rejected for v2, moved to the **post-v2 backlog** ([#18](https://github.com/alifarooq-zk/result-kit/issues/18)).
- **Wrapper mirrors `combine` / `from*` / `isTypedError`.** Symmetry — but those operate on arrays / non-Result inputs, not a single instance; keeping them free-function-only avoids a confused wrapper surface. Rejected — free-function-only, re-enter via `from(...)`.
- **No wrapper `toJSON()` (rely on the `.toResult()`-first rule alone).** Thinnest wrapper — but leaves an accidental `JSON.stringify(wrapper)` broken. Rejected — add the `toJSON()` safety net (§2).

## Consequences

- **The full v1 → v2 method map is now known** — this unblocks the migration & breaking-change story, graduated from map fog into its own ticket ([#19](https://github.com/alifarooq-zk/result-kit/issues/19)), gated on the remaining design tickets ([#14](https://github.com/alifarooq-zk/result-kit/issues/14) / [#15](https://github.com/alifarooq-zk/result-kit/issues/15) / [#16](https://github.com/alifarooq-zk/result-kit/issues/16)).
- **[#14](https://github.com/alifarooq-zk/result-kit/issues/14) (async), [#15](https://github.com/alifarooq-zk/result-kit/issues/15) (package layout), [#16](https://github.com/alifarooq-zk/result-kit/issues/16) (do-notation) are unblocked** — #13 was their blocker. Async inherits the "`xAsync` doubles cut" ruling and owns `fromPromise` + the positive async model. Package layout consumes the root-vs-`/fluent` split. Do-notation layers over the locked core.
- **The #11-deferred accumulation story is fully resolved:** accumulation ships via `combineWithAllErrors` (flat `TypedError[]` = the `issues[]` analog); formatters do **not** ship in v2 core (backlog [#18](https://github.com/alifarooq-zk/result-kit/issues/18)).
- **Net surface vs v1:** 10 methods cut, 1 rename (`mapError` → `mapErr`), 1 key-rename (`match`), 5 net-new members, plus all `xAsync` doubles removed pending #14 — a materially leaner core.
- Implementation (writing the free functions, the delegating wrapper, and removing the static `ResultKit` toolbox + fp-ts pipeline) happens in the **separate execution effort**, not now (map is planning-only). `OkTypeOf` / `ErrTypeOf` are helper type aliases the execution effort defines.
