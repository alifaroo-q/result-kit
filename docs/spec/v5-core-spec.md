# `@zireal/result-kit` 5.0.0 — implementation spec

- **Status:** Handoff-ready
- **Date:** 2026-07-15
- **Author:** Ali Farooq
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8) (complete)
- **Decisions:** [ADR 0001](../adr/0001-v2-core-api-paradigm.md) · [0002](../adr/0002-v2-typederror-model.md) · [0003](../adr/0003-v2-result-type-shape.md) · [0004](../adr/0004-v2-api-surface-method-inventory.md) · [0005](../adr/0005-v2-async-strategy.md) · [0006](../adr/0006-v2-package-layout-entrypoints.md) · [0007](../adr/0007-v2-do-notation-helper.md) · [0008](../adr/0008-v2-migration-breaking-change-story.md) · [0009](../adr/0009-v2-resultasync-surface.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md)
- **Vocabulary:** [`CONTEXT.md`](../../CONTEXT.md)

## 0. How to read this document

The map produced **eight ADRs**, each answering one question, and consolidating them here surfaced a ninth ([ADR 0009](../adr/0009-v2-resultasync-surface.md) — see §10.4). They are the **why**, they are append-only, and they are not superseded by this document.

This spec is the **what to build**. It consolidates those decisions into one implementation-ready surface: every final signature, every export, the package manifest, and the release sequence. Where two ADRs describe the same symbol at different times (ADR 0004 locked the sync transforms; ADR 0005 later reopened them as value-or-promise overloads), **this spec carries the merged, final shape** and says so.

**Precedence.** For *rationale*, the ADRs win — this document deliberately does not restate their argument, only their outcome. For *signatures and exports*, this document wins: it is the only place the full merged surface exists. Where this spec decides something no ADR decided, §10 records it explicitly rather than letting it pass as ADR-derived.

**Naming.** The map, the ADRs, and `CONTEXT.md` call this rework **"v2"** — an internal codename. It ships to npm as **`5.0.0`**, because `2.0.0`–`4.0.0` are permanently burned on the registry ([ADR 0008 §1](../adr/0008-v2-migration-breaking-change-story.md)). Contributor-facing docs may say "v2"; **consumer-facing docs say `5.0.0` only, and never mention "v2"**. This spec is contributor-facing and uses both, always disambiguated.

## 1. Scope

**In.** A lean, zero-dependency, ESM-only TypeScript library shipping the `Result` pattern: the plain union, the free-function core, the `TypedError` convention, an opt-in fluent wrapper, and generator do-notation. Plus the packaging, the migration guide, and the `5.0.0` release.

**Out** (ruled out by the map; do not reintroduce):

- The NestJS adapter (`src/nest/`) and the `@nestjs/common` peer dependency — **removed, not reworked**.
- The fp-ts interop (`src/fp-ts/`, `src/internal/fp-ts.ts`) and the `fp-ts` runtime dependency — **removed, not reworked**. No shim ships.
- New domain capabilities (`Option`/`Maybe`, codecs, transport adapters). This is a lean-down, not a feature expansion.
- Formatter helpers for accumulated `TypedError[]` — declined for 5.0.0, backlogged as [#18](https://github.com/alifarooq-zk/result-kit/issues/18).
- A companion `eslint-plugin-result-kit` must-use rule.
- Category subpaths (`/collections`, `/interop`, …) — zero bundle gain at this surface size; an additive minor later if the surface grows.
- A migration codemod.

## 2. The `Result` union

Source: [ADR 0003](../adr/0003-v2-result-type-shape.md). Vocabulary: [`CONTEXT.md`](../../CONTEXT.md).

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
```

**Invariants the implementation must preserve.** These are contracts, not style notes — each one is load-bearing for a guarantee below.

| Invariant | Why it is load-bearing |
|---|---|
| **No brand, symbol, or nominal tag** | Any `{ ok: true, value }` *is* an `Ok<T>`. This is what makes §2.1's round-trip provable and lets a cross-boundary object flow straight in. |
| **No methods on the union** | Methods would not survive serialization and would drag surface into every consumer's bundle. |
| **Exactly two fields per half** | No `error?: never` on `Ok`, no `value?: never` on `Err`. The `ok` boolean is already a complete discriminant. |
| **Shallow `readonly` only** | No `DeepReadonly<T>`; no `Object.freeze` in constructors. The contained value's mutability is its own business. |
| **Halves are exported** | `Ok<T>` / `Err<E>` are the narrowing targets of `isOk` / `isErr`, and useful public annotations in their own right. |

Type and value namespaces are separate, so the `Ok<T>` **type** and the `ok` **constructor** coexist without collision.

### 2.1 The JSON round-trip guarantee (public contract)

> If `T` and `E` are JSON-serializable, then `JSON.parse(JSON.stringify(result))` is a valid, structurally-identical `Result<T, E>`, consumable with **no** re-wrapping.

A `Result` may therefore be an HTTP response body, a queue message, or a `postMessage` payload. Two carve-outs must be documented alongside the guarantee:

- **`cause`** ([ADR 0002 §3](../adr/0002-v2-typederror-model.md)). When `error` is a `TypedError`, `{ type, message, details }` is JSON-safe but a populated `cause?: unknown` may not be. **The caller sanitizes or drops `cause` before serializing.** The core never silently mutates error data to auto-strip it.
- **`.toResult()`-before-serialize** ([ADR 0003 §5](../adr/0003-v2-result-type-shape.md)). Never `JSON.stringify` a `ResultChain` or `ResultAsync`. Exit to the plain union first. `ResultChain.toJSON()` (§6.1) makes the mistake lossless, but the *documented* path stays explicit.

## 3. `TypedError` and `defineError`

Source: [ADR 0002](../adr/0002-v2-typederror-model.md), with the factory signature locked by the [`prototype/define-error/`](../../prototype/define-error/README.md) prototype ([#17](https://github.com/alifarooq-zk/result-kit/issues/17)).

`E` in `Result<T, E>` stays **fully generic**. `TypedError` is an **opt-in convention**, never mandated by the error channel — `err("not found")` and `err(new DomainError())` stay first-class.

```ts
export interface TypedError<TType extends string = string, TData = Record<string, unknown>> {
  readonly type: TType;      // discriminant — narrow with `switch (err.type)`
  readonly message: string;  // required; guaranteed human-readable, loggable
  readonly details?: TData;  // optional typed payload, nested (never spread)
  readonly cause?: unknown;  // ES2022-style chaining; outside the §2.1 guarantee
}
```

**Invariants.** Plain structural object — **never a class, never `extends Error`**, no eager stack capture. Errors are *values* narrowed with `switch (err.type)`, not exceptions thrown. Consumers needing a real `Error` at a throw boundary construct one there or carry the original in `cause`. The shape stays exactly four fields — no top-level `path` (that belongs inside a validation error's `details`).

### 3.1 `defineError`

```ts
export type ErrorCtor<TType extends string, TData> = ([TData] extends [void]
  ? (message?: string) => TypedError<TType, never>
  : (details: TData, message?: string) => TypedError<TType, TData>) & {
  readonly type: TType;
  is(x: unknown): x is TypedError<TType, [TData] extends [void] ? never : TData>;
};

export function defineError<TType extends string, TData = void>(
  type: TType,
  defaultMessage: string | ((details: TData) => string),
): ErrorCtor<TType, TData>;

export declare namespace defineError {
  function withData<TData>(): <TType extends string>(
    type: TType,
    defaultMessage: string | ((details: TData) => string),
  ) => ErrorCtor<TType, TData>;
}
```

Four behaviours the implementation must get exactly right — each was a decided point, not an accident of the prototype:

1. **Payload type is inferred from the message function's parameter annotation.** `defineError('not_found', (d: { id: string }) => …)` infers `TData = { id: string }` with no explicit type argument.
2. **`.withData<TData>()` is the escape hatch** for the one shape single-call cannot infer: a payload paired with a *static* message. It supplies `TData` explicitly **without repeating the `type` literal**.
3. **`message` is always required** at definition. No silent fallback to the `type` string. A per-call second argument still overrides it.
4. **The factory defaults `TData = void`, not `Record<string, unknown>`.** This is deliberate and differs from the *interface* default: it makes absent-payload variants `TypedError<TType, never>`, so no `Record<string, unknown>` leaks into a no-payload error. The interface keeps the permissive default so a hand-written `TypedError<'not_found'>` behaves as it did in v1.

```ts
const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
notFound({ id: '123' });
// → { type: 'not_found', message: 'User 123 not found', details: { id: '123' } }
notFound({ id: '123' }, 'Custom message');   // per-call override

const forbidden = defineError('forbidden', 'Access denied');            // no payload
const conflict  = defineError.withData<{ id: string }>()('conflict', 'Already exists');
```

**`ReturnType<typeof notFound>` must resolve to a clean `TypedError<'not_found', { id: string }>`** — verified by the prototype's compiler assertions. Error unions are built from constructor return types, each with its own payload:

```ts
type ApiError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>;
```

### 3.2 Guards

- **`notFound.is(x)`** — per-variant, **tag-only** (`x.type === 'not_found'`). It cannot validate the payload at runtime; that needs a schema.
- **`isTypedError(x)`** — narrows a caught `unknown` to the base shape. See §5.1 for the signature (the ADRs render it two ways; the spec picks one).

### 3.3 Cut from v1

`TypedErrorOf` (a redundant alias) and `TypedErrorUnion` (distributes tags into same-*default*-payload variants, fighting the per-variant typed payload). `isTypedError` is **kept, unchanged in name**. v1's separate typed `fail` constructor collapses into the single generic `err` — the typed convention is expressed by *what you pass*, not a second constructor.

## 4. Architecture

Source: [ADR 0001](../adr/0001-v2-core-api-paradigm.md), [ADR 0005 §1](../adr/0005-v2-async-strategy.md), [ADR 0006](../adr/0006-v2-package-layout-entrypoints.md).

```
┌─ @zireal/result-kit  (root, `.`) ────────────────────────────┐
│  Result<T,E> = Ok<T> | Err<E>     ← plain data, no methods   │
│  27 free functions, data-first, single-signature, no curry   │
│  async = Promise<Result<T,E>>     ← stdlib; no new type      │
│  SELF-SUFFICIENT: never needs /fluent                        │
└──────────────────────────────────────────────────────────────┘
             ▲ delegates to (one implementation)
             │
┌─ @zireal/result-kit/fluent ──────────────────────────────────┐
│  ResultChain<T,E>   ← sync wrapper, the documented hero      │
│  ResultAsync<T,E>   ← implements PromiseLike<Result<T,E>>    │
│  ok / err / from / safeTry, returning wrappers               │
│  THIN ENVELOPE: imports only the core fns it delegates to    │
└──────────────────────────────────────────────────────────────┘
```

Three rules govern this split, and every one of them is enforceable:

1. **The plain union is the source of truth.** The wrapper is a transient ergonomic envelope, never the interchange or serialized type.
2. **One implementation.** The wrapper delegates to the same core functions — a thin envelope, not a second codebase.
3. **The boundary is a build-time guarantee, not prose.** The root `.` bundle must never contain the wrapper. §7.3 mandates an automated guard.

**Positioning** (drives README and tutorials): the **fluent wrapper is the documented hero**; the **free-function core is the first-class, supported "lean / tree-shakable" escape hatch** — the differentiator class-only neverthrow structurally cannot offer.

**Dual constructors** ([ADR 0001 §4](../adr/0001-v2-core-api-paradigm.md), reaffirmed by [ADR 0005 §4](../adr/0005-v2-async-strategy.md) and [ADR 0007 §3](../adr/0007-v2-do-notation-helper.md)): **same name, surface-appropriate return type**. `ok`/`err`/`safeTry`/`fromPromise`/`fromThrowableAsync` exist at both entrypoints; the root returns plain data, `/fluent` returns wrappers.

## 5. Root entrypoint — `@zireal/result-kit`

**27 free functions.** Data-first, **one signature, no currying, no data-last variants** — the auto-curry tree-shaking trap is why. Async is handled by overloads, never by an `Async`-suffixed twin.

### 5.1 Constructors & guards (6)

```ts
export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function err<E>(error: E): Err<E>;

export function isOk<T, E>(result: Result<T, E>): result is Ok<T>;
export function isErr<T, E>(result: Result<T, E>): result is Err<E>;

export function isTypedError(x: unknown): x is TypedError;

// defineError — §3.1
```

- **Narrow returns.** `ok`/`err` return `Ok<T>`/`Err<E>`, *not* `Result<T, never>`/`Result<never, E>`. Narrow is strictly more precise — it still assigns into any `Result<T, E>` annotation (widening is free) while preserving `.value`/`.error` access for code holding a known half.
- **`ok(): Ok<void>` overload** for the common `Result<void, E>` success — `return ok()` beats `ok(undefined)`.
- **Guards emit type predicates**, not plain booleans. `if (isOk(r)) { r.value }` must narrow.
- **`isTypedError` signature — spec decision.** [ADR 0002](../adr/0002-v2-typederror-model.md) renders it `x is TypedError` (base, `TData = Record<string, unknown>`); [ADR 0004](../adr/0004-v2-api-surface-method-inventory.md) renders it `error is TypedError<string>`. These differ only in whether `TData` takes the interface default. **The spec takes ADR 0002's form** — `x is TypedError` — because ADR 0002 owns the error model and its `TData` default is the deliberate one. Recorded in §10.

### 5.2 Transforms (6) — **merged signatures**

> **This section supersedes the sync-only rendering in [ADR 0004 §1](../adr/0004-v2-api-surface-method-inventory.md).** [ADR 0005 §2](../adr/0005-v2-async-strategy.md) reopened these six as value-or-promise overloads (the [`@praha/byethrow`](https://github.com/praha-inc/byethrow) model). Neither ADR shows the merged result; this is it. **Build from this block.**

The contract in one line: **one name, no `Async` suffix, input drives output.** A plain `Result` in yields a `Result` out; a `Promise<Result>` **or** an async callback yields a `Promise<Result>` out.

> **Two amendments from building this (#24).** Both are recorded in §10.6 and reflected in `src/core/transforms.ts`; the block below stays as originally written, because it is the clearest statement of the *contract*. It is no longer a literal transcription target.
>
> 1. **The promise arm takes `PromiseLike<Result<T, E>>`, not `Promise<Result<T, E>>`** (§10.6) — otherwise `ResultAsync`, which implements `PromiseLike`, cannot flow into the core it is supposed to delegate to.
> 2. **The arm order below is presentational and must be inverted in code.** TypeScript takes the first matching overload, so the async-callback arm has to be declared *before* the sync arm. Written literally, `map`'s `fn: (value: T) => U` captures an async callback with `U = Promise<X>` and returns `Result<Promise<X>, E>`; `inspect` is worse, because `() => Promise<void>` is assignable to `() => void` under the void-return rule, so the sync arm silently drops the await. Neither fails at runtime — see the note at the top of `transforms.ts`.

```ts
// map
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>;
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => Promise<U>): Promise<Result<U, E>>;
export function map<T, U, E>(result: Promise<Result<T, E>>, fn: (value: T) => U | Promise<U>): Promise<Result<U, E>>;

// mapErr  (v1's `mapError`, renamed)
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F>;
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => Promise<F>): Promise<Result<T, F>>;
export function mapErr<T, E, F>(result: Promise<Result<T, E>>, fn: (error: E) => F | Promise<F>): Promise<Result<T, F>>;

// andThen — accumulates the error union E | F
export function andThen<T, U, E, F>(result: Result<T, E>, fn: (value: T) => Result<U, F>): Result<U, E | F>;
export function andThen<T, U, E, F>(result: Result<T, E>, fn: (value: T) => Promise<Result<U, F>>): Promise<Result<U, E | F>>;
export function andThen<T, U, E, F>(result: Promise<Result<T, E>>, fn: (value: T) => Result<U, F> | Promise<Result<U, F>>): Promise<Result<U, E | F>>;

// orElse — accumulates the success union T | U
export function orElse<T, E, U, F>(result: Result<T, E>, fn: (error: E) => Result<U, F>): Result<T | U, F>;
export function orElse<T, E, U, F>(result: Result<T, E>, fn: (error: E) => Promise<Result<U, F>>): Promise<Result<T | U, F>>;
export function orElse<T, E, U, F>(result: Promise<Result<T, E>>, fn: (error: E) => Result<U, F> | Promise<Result<U, F>>): Promise<Result<T | U, F>>;

// inspect / inspectErr — side-effect tees; return the result unchanged
export function inspect<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E>;
export function inspect<T, E>(result: Result<T, E>, fn: (value: T) => Promise<void>): Promise<Result<T, E>>;
export function inspect<T, E>(result: Promise<Result<T, E>>, fn: (value: T) => void | Promise<void>): Promise<Result<T, E>>;

export function inspectErr<T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E>;
export function inspectErr<T, E>(result: Result<T, E>, fn: (error: E) => Promise<void>): Promise<Result<T, E>>;
export function inspectErr<T, E>(result: Promise<Result<T, E>>, fn: (error: E) => void | Promise<void>): Promise<Result<T, E>>;
```

**Union accumulation is the highest-value inference behaviour in the design** — `andThen` accumulates `E | F`, `orElse` accumulates `T | U`. Do not "simplify" to monomorphic `Result<U, E>`; that reintroduces fp-ts's `chainW`/`mapLeft` gymnastics the map explicitly rejected.

`andThen(fetchUser(id), validate)` must "just work" when `fetchUser` returns `Promise<Result>`. That is the acceptance criterion for these overloads.

### 5.3 Terminals (5) — **strictly synchronous**

```ts
export function match<T, E, UOk, UErr = UOk>(result: Result<T, E>, cases: { ok: (value: T) => UOk; err: (error: E) => UErr }): UOk | UErr;
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T;
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T;
export function unwrapOrThrow<T, E>(result: Result<T, E>, message?: string): T;   // NEW — throws on Err
export function toNullable<T, E>(result: Result<T, E>): T | null;
```

**Terminals do not overload over promises.** You `await` before a terminal — natural, since a terminal ends the chain — so unifying them buys nothing and only degrades inference.

> **Amendment from building this ([#25](https://github.com/alifarooq-zk/result-kit/issues/25), 2026-07-16).** `match`'s signature above is **amended, not merely annotated** — the earlier `match<T, E, U>` is the one signature in this spec that contradicted its own prose, and it is corrected in place.
>
> 1. **A slot per branch, `UOk | UErr`.** A single naked `U` across both callbacks cannot deliver the union this section's last bullet requires. TypeScript collects `U`'s inference candidates and takes the **first** rather than unioning them, so `U` locks to the `ok` branch and the `err` branch is rejected: `match(r, { ok: (v) => v.n, err: () => 'fallback' })` fails with *string is not assignable to number*. That is a hard compile error at the call site, not a silent degradation — unlike §5.2's arms, this one cannot ship and be discovered later. The same first-candidate-wins rule §5.7 note 1 hit from the other direction.
> 2. **`UErr` defaults to `UOk`**, which is what makes this a strict superset of the old signature rather than a trade. A default applies exactly when inference finds no candidate (§5.7 note 2, same mechanism) — and for `UErr` that is precisely when type arguments are supplied explicitly. So `match<User, NotFound, string>(…)` still means *one `U`, both branches*, and still holds both to it; `match<User, NotFound, number, string>(…)` is there when they differ. A `cases` object always supplies an `err`, so the default never fires on an inferred call and cannot collapse the union.
>
> Verified by `test/core/terminals.spec.ts` and enforced by `pnpm check`. **This applies identically to the wrapper's `.match()` (§6.1, §6.2)** — the method form has the same naked `U` and the same failure.

- **`match` takes both `ok` and `err`**, both required → exhaustive by construction. (v1's `onSuccess`/`onFailure` keys are renamed.)
- **`unwrapOrThrow` is the only throwing extractor**, and is honestly named. There is deliberately **no bare `unwrap`** (across the genre `unwrap` *throws*; v1's returned `T | undefined`, a silent-undefined footgun) and **no err-side `unwrapErrOrThrow`**.

### 5.4 Collections (3) — **sync-only**

```ts
export function combine<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>>;

export function combineWithAllErrors<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>[]>;

export function partition<T, E>(results: readonly Result<T, E>[]): [T[], E[]];
```

> **Amended (2026-07-17, at implementation): `partition` takes a `readonly` array.** This section wrote it mutable while both combinators above take `readonly` inputs, so a `readonly Result<T, E>[]` that `combine` accepts broke one call later at `partition` — for no stated reason, since nothing in `partition` mutates its input.
>
> The `readonly` form is a **strict superset**: every call the mutable signature accepted still resolves (a mutable array is assignable to a `readonly` parameter, not the reverse), and inference of `T` and `E` is untouched. So this is corrected in place rather than annotated as a deviation — the same strict-superset test §5.3's `UErr` default was amended under.
>
> Pinned by `test/core/collections.spec.ts`; enforced by `pnpm check`.

- **`combine` is fail-fast** (first error, errors unioned); **`combineWithAllErrors` accumulates every error** as a flat array — the `ZodError.issues[]` analog, and the whole of the accumulation story.
- **Both preserve tuples** — heterogeneous per-position types, with the homogeneous array as a special case.
- **Empty input is `ok([])`** for both combinators — the identity that makes `combine` fold-like, and what keeps `combineWithAllErrors` from erring on *no* errors. `partition([])` is `[[], []]`.
- **`partition` is best-effort** — always returns the successes that worked *plus* the failures. This is the batch capability the all-or-nothing combinators cannot express. It returns a plain tuple, not a `Result`: it has no failure mode.
- **No promise overloads.** `await Promise.all([...])` first, then hand the plain `Result[]` to the combinator. Overloading over *arrays of unions vs. arrays of promises-of-unions* is a combinatorial inference mess for a thin gain.

### 5.5 Interop constructors (3)

```ts
export function fromNullable<T, E>(value: T | null | undefined, error: E): Result<NonNullable<T>, E>;

export function fromPredicate<T, S extends T, E>(value: T, predicate: (value: T) => value is S, error: E): Result<S, E>;
export function fromPredicate<T, E>(value: T, predicate: (value: T) => boolean, error: E): Result<T, E>;

export function fromThrowable<Args extends unknown[], T, E>(
  fn: (...args: Args) => T,
  errorFn: (error: unknown) => E,
): (...args: Args) => Result<T, E>;
```

`fromThrowable` is **lazy** — it returns a reusable wrapped function (one-shot use is a thunk). Strictly more flexible than an eager form, preserves the arg list, and matches both neverthrow and v1. The `fromPredicate` type-guard overload (narrowing the success type to `S`) is net-new.

### 5.6 Async constructors (2)

```ts
export function fromPromise<T, E>(promise: Promise<T>, onReject: (error: unknown) => E): Promise<Result<T, E>>;

export function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => Promise<Result<T, E>>;
```

Entering the async-result world from a raw promise is a **construction** concern: the §5.2 transforms operate on `Promise<Result>`, not `Promise<T>`, and **cannot catch a rejection**. Both constructors earn their place — `fromPromise` keeps the overwhelmingly common "promise already in hand" path a one-liner; `fromThrowableAsync` gives reusable-wrapper symmetry with sync `fromThrowable`.

`fromThrowableAsync` (not `fromAsyncThrowable`) reads as "the async variant of `fromThrowable`" and is the one async name v1 users already know. It is **not** an `xAsync` double in the cut sense — there is no sync `fromThrowable` overload that could absorb it, because the rejection-catching behaviour differs.

### 5.7 Do-notation (2)

Source: [ADR 0007](../adr/0007-v2-do-notation-helper.md). Ships in 5.0.0, not deferred — it is the ergonomic the research crowned highest-ROI, and the "lean **and** ergonomic" thesis promises it at launch.

```ts
type ErrorOf<Y> = Y extends Err<infer E> ? E : never;   // internal — not exported

export function safeTry<Y extends Err<unknown>, T = never, E = never>(
  gen: () => Generator<Y, Result<T, E>>,
): Result<T, E | ErrorOf<Y>>;
export function safeTry<Y extends Err<unknown>, T = never, E = never>(
  gen: () => AsyncGenerator<Y, Result<T, E>>,
): Promise<Result<T, E | ErrorOf<Y>>>;

export function safeUnwrap<T, E>(result: Result<T, E>): Generator<Err<E>, T>;
export function safeUnwrap<T, E>(result: Promise<Result<T, E>>): AsyncGenerator<Err<E>, T>;
```

```ts
import { safeTry, safeUnwrap, ok } from '@zireal/result-kit';

const total = safeTry(function* () {
  const user  = yield* safeUnwrap(findUser(id));     // Err short-circuits → becomes safeTry's result
  const order = yield* safeUnwrap(loadOrder(user));  // each yield* binds its own T
  return ok(user.credit + order.total);              // explicit Ok
});

// async: zero `await` ceremony inside the generator
const total = await safeTry(async function* () {
  const user  = yield* safeUnwrap(findUser(id));     // findUser: Promise<Result> — no await
  const order = yield* safeUnwrap(loadOrder(user));
  return ok(order.total);
});
```

Five constraints:

1. **`yield*` delegation, never bare `yield`.** Delegation lets each yielded `Result` carry its own unwrapped type so successive `yield*`s bind distinct types. Bare `yield` forces one monomorphic next-type and is unusable heterogeneously.
2. **Iterability lives in the `safeUnwrap` adapter, not in the data.** Making the core union iterable would put `[Symbol.iterator]` on what `ok()`/`err()` produce, reopening §2's no-brand / JSON guarantee for the sake of *optional sugar*. The union stays untouched.
3. **One overloaded `safeTry`, no `safeTryAsync`.** Sync generator → `Result`; async generator → `Promise<Result>`.
4. **`safeUnwrap` overloads value-or-promise** — the same byethrow model as §5.2 — so an async generator unwraps a `Promise<Result>` with zero `await`.
5. **The generator returns a `Result` explicitly** (`return ok(v)` / early `return err(e)`); `safeTry` returns it directly rather than auto-wrapping a bare value. The error channel is **union-accumulated** — `Result<TReturn, E₁ | … | Eₙ | Eᵣ>`, the same rule `andThen` uses (do-notation *is* `andThen` chaining with nicer syntax). TypeScript has no `From` trait, so there is **no Rust-style error coercion**.

Both names are neverthrow's, making the highest-value migration path zero-surprise. `safeUnwrap` is deliberately not bare `unwrap` (§5.3 cut that token).

> **Implementation note — resolved by [#23](https://github.com/alifarooq-zk/result-kit/issues/23) (2026-07-16).** The signatures above are the verdict of a prototype (since deleted); the plumbing they encode is not decoration, and two details are load-bearing in ways no happy-path call site reveals.
>
> 1. **`Y` is a naked type parameter.** Spelling the yield slot `Generator<Err<E>, …>` — the obvious reading of this section's earlier sketch — makes TypeScript decompose the yielded union into one inference candidate per constituent and keep only the **first**, silently collapsing `E₁ | E₂` to `E₁`. A naked `Y` captures the union whole; the distributive `ErrorOf<Y>` unpacks it again.
> 2. **`T` and `E` default to `never`.** In a body whose only exit is `return ok(v)`, nothing matches the `Err<E>` arm, so `E` draws no inference candidate and falls back to `unknown` — and `unknown | ErrorOf<Y>` swallows the accumulated union. A default applies exactly when inference finds no candidate, so a body that *does* `return err(…)` still infers `E` from it normally.
>
> **One caveat, and it is not fixable here.** TypeScript **subtype-reduces** a generator's yield type across `yield*` delegations: any yielded error that is a subtype of another yielded error is **dropped**, and the channel keeps only the supertype. This happens in the generator expression itself — with no `safeTry` and no contextual type in sight — so it is upstream of this signature, and no signature can recover it ([microsoft/TypeScript#57625](https://github.com/microsoft/TypeScript/issues/57625), open and unmilestoned since March 2024; neverthrow has the same bug and has not fixed it).
>
> It bites in two shapes, both pinned in `test/core/do-notation.spec.ts` under *"the known limitation, pinned"*:
>
> - **A hierarchy widens.** `class NotFoundError extends HttpError` yielded alongside an `HttpError` gives `Result<T, HttpError>` — `NotFoundError` is gone, and `error.path` is unreachable without a cast. Structural subtyping does the same: `{type, message, id}` beside `{type, message}` loses `id`.
> - **Lookalikes merge.** Mutually assignable types (two structurally identical `Error` subclasses) are just the special case where each is a subtype of the other. Here nothing is really lost — TypeScript already treats them as one type.
>
> **Judged not to warrant escalation**, on these grounds — note the first is weaker than the hierarchy case might suggest, so state it carefully:
>
> - It is **lossy but never unsound.** The survivor is always a supertype of what was dropped, so the channel *widens* and never names an error that cannot occur. A consumer handling `HttpError` handles a `NotFoundError` correctly; it just cannot see the narrower type. (For lookalikes it is not even lossy.) It is **not** true in general that "the channel is no less precise than the language" — for the hierarchy case it plainly is less precise, since `const e: NotFoundError = new HttpError()` is rightly an error.
> - **No §3 `TypedError` can hit it.** Distinct literal `type` discriminants make variants mutually non-assignable, so neither is a subtype of the other and the union survives intact. This is the path the spec's own error convention puts consumers on, and it is verified.
> - It is **not ours to fix**, and the alternative is never shipping.
>
> §2 keeps `E` fully generic and `TypedError` opt-in, so error-class hierarchies are a reachable path and consumers on one should know the channel widens. If a future TypeScript fixes #57625, those pinned assertions fail and this caveat can be dropped.
>
> These assertions live under `tsc --noEmit`, not `vitest`. Both traps produce **no runtime error whatsoever** — a collapsed union is invisible until a consumer handles an error the types said could not occur.

### 5.8 Public types

```ts
export type { Result, Ok, Err };            // §2
export type { TypedError, ErrorCtor };      // §3
export type { OkTypeOf, ErrTypeOf };        // §5.4 — see §10
```

`OkTypeOf` / `ErrTypeOf` extract the halves of a `Result`; they appear in `combine`'s public signature. `ErrorCtor` is `defineError`'s return type. **All three are exported** — see §10 for why.

### 5.9 Complete root export list

**Values (27):**

| Group | Exports |
|---|---|
| Constructors & guards (6) | `ok` `err` `isOk` `isErr` `isTypedError` `defineError` |
| Transforms (6) | `map` `mapErr` `andThen` `orElse` `inspect` `inspectErr` |
| Terminals (5) | `match` `unwrapOr` `unwrapOrElse` `unwrapOrThrow` `toNullable` |
| Collections (3) | `combine` `combineWithAllErrors` `partition` |
| Interop (3) | `fromNullable` `fromPredicate` `fromThrowable` |
| Async constructors (2) | `fromPromise` `fromThrowableAsync` |
| Do-notation (2) | `safeTry` `safeUnwrap` |

**Types (7):** `Result` `Ok` `Err` `TypedError` `ErrorCtor` `OkTypeOf` `ErrTypeOf`

**Not exported from root:** `ResultChain`, `ResultAsync`, `from` — these are `/fluent` only, and §7.3's guard enforces it.

## 6. `/fluent` entrypoint — `@zireal/result-kit/fluent`

The wrapper mirrors only functions operating on a **single `Result` instance**, delegating one-to-one to the core. Array- and entry-shaped functions (`combine`, `partition`, `from*`, `isTypedError`) stay **free-function-only** — re-enter fluent-land with `from(...)`.

### 6.1 `ResultChain<T, E>` — the sync wrapper

> **Named by this spec, not by an ADR.** Every ADR calls it "the wrapper". See §10.

| Member | Kind | Delegates to |
|---|---|---|
| `.map(fn)` `.mapErr(fn)` `.andThen(fn)` `.orElse(fn)` | chaining → `ResultChain` (or `ResultAsync` if `fn` is async) | `map` / `mapErr` / `andThen` / `orElse` |
| `.inspect(fn)` `.inspectErr(fn)` | chaining → same | `inspect` / `inspectErr` |
| `.match({ ok, err })` | terminal → value | `match` |
| `.unwrapOr(d)` `.unwrapOrElse(fn)` `.unwrapOrThrow(msg?)` `.toNullable()` | terminal → value | corresponding core fn |
| `.isOk()` `.isErr()` | terminal → **boolean** | `isOk` / `isErr` |
| `.toResult()` | exit → plain `Result<T, E>` | (unwraps) |
| `.toJSON()` | serialization net → plain `Result<T, E>` | returns `this.toResult()` |
| `[Symbol.iterator]` | do-notation | self-iterable — `yield* chain` needs no `safeUnwrap` |

- **`.isOk()` / `.isErr()` return plain booleans, not type predicates.** A method cannot emit a predicate that narrows the wrapper's own generics the way a free function narrows a plain union. **Type-safe narrowing on the fluent side goes through `.match()` / terminals.** They exist so a hero-path user reaching for `if (result.isOk())` does not hit a DX cliff — nothing more.
- **`.toJSON()` is the pit-of-success net.** An accidental `JSON.stringify(chain)` silently emits the correct plain union instead of leaking class internals (the `Date.prototype.toJSON` idiom). It makes the mistake lossless; it does not replace the documented `.toResult()` path (§2.1).
- **`[Symbol.iterator]` on the wrapper does not touch §2's guarantee**, which governs only the core union.

### 6.2 `ResultAsync<T, E>` — the async wrapper

Source: [ADR 0005 §4–5](../adr/0005-v2-async-strategy.md) (placement, constructor, safety properties) and **[ADR 0009](../adr/0009-v2-resultasync-surface.md)** (the member list).

**The rule: `ResultAsync` is `ResultChain`, lifted** — every value-terminal mirrored with a `Promise`-lifted return — with two deliberate departures (no guards, throwing `toJSON`).

```ts
export class ResultAsync<T, E> implements PromiseLike<Result<T, E>> {
  static from<T, E>(promise: Promise<Result<T, E>>): ResultAsync<T, E>;

  // chaining → ResultAsync
  map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U, E>;
  mapErr<F>(fn: (error: E) => F | Promise<F>): ResultAsync<T, F>;
  andThen<U, F>(fn: (value: T) => Result<U, F> | Promise<Result<U, F>>): ResultAsync<U, E | F>;
  orElse<U, F>(fn: (error: E) => Result<U, F> | Promise<Result<U, F>>): ResultAsync<T | U, F>;
  inspect(fn: (value: T) => void | Promise<void>): ResultAsync<T, E>;
  inspectErr(fn: (error: E) => void | Promise<void>): ResultAsync<T, E>;

  // five value-terminals → Promise-lifted; handlers stay SYNC
  match<UOk, UErr = UOk>(cases: { ok: (value: T) => UOk; err: (error: E) => UErr }): Promise<UOk | UErr>;
  unwrapOr(defaultValue: T): Promise<T>;
  unwrapOrElse(fn: (error: E) => T): Promise<T>;
  unwrapOrThrow(message?: string): Promise<T>;      // rejects on Err
  toNullable(): Promise<T | null>;

  // exit
  toResult(): Promise<Result<T, E>>;
  then(...): PromiseLike<...>;                      // await ra ≡ await ra.toResult()

  // departures from ResultChain
  // NO isOk() / isErr()
  toJSON(): never;                                  // throws — see below
  [Symbol.asyncIterator](): AsyncGenerator<..., T>;
}
```

This restores v1's hero async ergonomic — one `await` at the front, terminal at the end:

```ts
const displayName = await ok(token)
  .andThen(requireSession)
  .andThen(findUser)              // → ResultAsync
  .map((user) => user.name)
  .match({ ok: (n) => n, err: () => 'anon' });
```

**Terminal handlers are synchronous**, exactly as the core's are (§5.3) — only the *return* is lifted. Async work belongs upstream in `.andThen()`. (A deliberate departure from v1, whose `AsyncResultPipeline.match` took `Awaitable<U>` handlers.)

> **`.match()` carries §5.3's amendment** ([#25](https://github.com/alifarooq-zk/result-kit/issues/25), 2026-07-16), and its signature above is corrected in place. Binding `T` and `E` on the class buys the method nothing here: `U` is still a single naked parameter across both callbacks, so `ra.match({ ok: (u) => u.credit, err: () => 'anon' })` fails to compile for the same first-candidate-wins reason. `ResultChain.match()` (§6.1) is the same. The hero example above is *not* affected — both its branches return `string`, which is exactly why this trap survives a happy-path reading. Delegating to the corrected core is not sufficient; the wrapper's own signature must carry the fix.

**No `isOk()` / `isErr()`.** The "lifted" rule stops at the guards, on a principle worth stating because it looks like an inconsistency otherwise: a *value-producing* terminal is useful lifted (it saves the intermediate binding and keeps the chain reading left-to-right); a *non-narrowing boolean guard* is not, because the only thing it would buy — narrowing — needs the plain union anyway. `if (await ra.isOk())` awaits twice and still cannot reach `.value`; `const r = await ra; if (isOk(r))` narrows properly and is shorter. Omitting them also avoids the always-truthy `if (ra.isOk())` footgun.

**`toJSON()` throws.** `ResultChain`'s lossless net (§6.1) cannot be built here — `JSON.stringify` is synchronous and the value isn't available yet, so the accident is lossy whether `toJSON` returns a `Promise` (serializes `{}`) or is omitted (also `{}`). The choice is therefore silent vs. loud, and [ADR 0008 §6](../adr/0008-v2-migration-breaking-change-story.md) fixed this project's stance on that axis:

```ts
toJSON(): never {
  throw new TypeError(
    'Cannot serialize an in-flight ResultAsync. ' +
    'await it first, then serialize the Result: JSON.stringify(await resultAsync)',
  );
}
```

**`[Symbol.asyncIterator]` is forced, not chosen.** It is what makes [ADR 0007 §3](../adr/0007-v2-do-notation-helper.md)'s "no `safeUnwrap` needed at `/fluent`" true: inside an `async function*`, `yield* ra` needs `[Symbol.asyncIterator]` on `ResultAsync` — `ResultChain`'s sync `[Symbol.iterator]` does not cover it. Iterability on the wrapper does not touch §2's guarantee, which governs only the core union.

**Three safety properties, each of which must survive implementation:**

1. **`await`-collapse is intentional and lossless.** `await someResultAsync` yields the plain `Result` union **by design** — exactly equivalent to `await ra.toResult()`. Awaiting *is* the sanctioned exit from the fluent async surface, not an accident. **Document this as a guarantee**, because it is the mitigation for the footgun that spawned ADR 0005.
2. **Never forced through the thenable.** Structural invariant: the functional core hands you `Promise<Result>` directly (§5.2, §5.6), so nobody ever *has* to touch `ResultAsync`. It is pure opt-in ergonomics. Guaranteed by the split — no extra work, but do not regress it.
3. **Floating async is caught for free.** Because `ResultAsync implements PromiseLike`, a floating un-`await`ed `ResultAsync` is already flagged by stock `@typescript-eslint/no-floating-promises`. This **closes** the floating-thenable gap v1's custom thenable left open — call it out in the docs as a design payoff, and do not implement `then` in any way that would defeat the rule.

The five terminals are **additive and touch none of these three** — no terminal goes near `then`.

### 6.3 Complete `/fluent` export list

**Values (7):** `ok` `err` `from` `safeTry` `fromPromise` `fromThrowableAsync` `ResultAsync`
**Types (2):** `ResultChain` `ResultAsync`

> **Amended 2026-07-15 — was "Values (5)", omitting `fromPromise` / `fromThrowableAsync`.** That list contradicted §4's dual-constructor rule and [ADR 0005 §4](../adr/0005-v2-async-strategy.md)'s placement table, both of which place both async constructors at **both** entrypoints. §4 wins. See §10.5.

```ts
export function ok(): ResultChain<void, never>;
export function ok<T>(value: T): ResultChain<T, never>;
export function err<E>(error: E): ResultChain<never, E>;
export function from<T, E>(result: Result<T, E>): ResultChain<T, E>;

export function safeTry<T, E>(gen: () => Generator<..., Result<T, E>>): ResultChain<T, E>;
export function safeTry<T, E>(gen: () => AsyncGenerator<..., Result<T, E>>): ResultAsync<T, E>;

// dual constructors — §4, ADR 0005 §4. Same names as root, wrapper return types.
export function fromPromise<T, E>(promise: Promise<T>, onReject: (error: unknown) => E): ResultAsync<T, E>;
export function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => ResultAsync<T, E>;
```

- **`/fluent` has no `safeUnwrap`** — the wrapper is self-iterable, so `yield* chain` works directly. Root's `safeUnwrap` remains available for unwrapping a *plain* union inside a fluent `safeTry`.
- **`fromPromise` ≠ `ResultAsync.from`.** `ResultAsync.from` lifts a `Promise<Result<T, E>>` that is *already* a union; `fromPromise` catches a rejection off a raw `Promise<T>` into the `E` channel. Neither substitutes for the other, which is why omitting `fromPromise` here would have left a `/fluent` user no rejection-catching entry into the wrapper without importing from root — breaking core/wrapper symmetry in the opposite direction to the one §4 guards.
- **`ResultChain` is exported as a type; instances come from `ok`/`err`/`from`/`safeTry`.** `ResultAsync` is exported as a **value** (class) because [ADR 0005 §4](../adr/0005-v2-async-strategy.md) specifies the static `ResultAsync.from(promiseOfResult)`. The asymmetry — free `from` for sync, static `ResultAsync.from` for async — is as-decided; do not "fix" it without a new decision.

## 7. Packaging

Source: [ADR 0006](../adr/0006-v2-package-layout-entrypoints.md).

### 7.1 Format, entrypoints, floors

- **ESM-only.** No CJS output, no `.cjs`, no split type files. A CJS consumer reaches 5.0.0 via `require(esm)` (guaranteed by the Node floor) or dynamic `import()`. Consequence: a **single `.d.ts` per entry**, and the "masquerading types" dual-package hazard **cannot occur**.
- **Exactly three entrypoints:** `.` (flat, self-tree-shakable barrel — all 27 functions + the 7 public types) · `./fluent` · `./package.json`. The v1 `./core`, `./fp-ts`, `./nest` are **all removed**. No `/esm` deep-path hack. No category subpaths.
- **`engines.node` = `>=22.12`** — raised from v1's `>=20` to align with unflagged `require(esm)`, so *every* supported Node can load the ESM-only package.
- **Emit target `ES2023`** — all native on the Node floor; no downleveling.
- **Dev toolchain: TypeScript 7 (`tsgo`)** for the 8–12× typecheck speedup. ~~**Caveat:** TS 7 does not yet expose a stable programmatic API (promised for 7.1), so tools embedding the compiler API — notably **`attw`** — may need to pin the TS 6 line. This does not affect emit.~~ — **Caveat closed by [#21](https://github.com/alifarooq-zk/result-kit/issues/21) (2026-07-16); do not re-investigate.** `typescript@7.0.2` landed with **no TS 6 fallback and no `attw` pin**. `@arethetypeswrong/core` hard-pins its own `typescript@5.6.1-rc` as a *regular dependency* and resolves it nested, so it never loads the project's TypeScript and cannot break on the jump. `.d.ts` generation via `rolldown-plugin-dts` also works (it warns that the 7.0 API is experimental, but emits correctly). The real constraint turned out to be **tsdown's peer range** — `0.21.4` declares `typescript: "^5.0.0"`, which TS 7 violates; `0.22.8` widens it to `"^5.0.0 || ^6.0.0 || ^7.0.0"`. The tsdown upgrade is what enabled the jump. `tsc`'s binary name is unchanged, so `pnpm check` needed no edit — "tsgo" was the name of the *preview* package (`@typescript/native-preview`), superseded by `typescript@7`.
- **Consumer types floor: TypeScript `6.0+`.** TS 6.0 is the *bridge* release: code compiling cleanly on TS 6 compiles **identically** on TS 7, so a `6.0+` floor covers both with one commitment. TS 7 is the *recommended* consumer compiler for speed, not a requirement.

### 7.2 `package.json`

```jsonc
{
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=22.12" },

  "module": "./dist/index.js",     // legacy fallback for non-exports-aware tooling → ESM
  "types":  "./dist/index.d.ts",   // single .d.ts — no split, no masquerading-types hazard
  // no "main": 5.0.0 publishes no CJS artifact

  "exports": {
    ".":        { "types": "./dist/index.d.ts",        "default": "./dist/index.js" },
    "./fluent": { "types": "./dist/fluent/index.d.ts", "default": "./dist/fluent/index.js" },
    "./package.json": "./package.json"
  }
}
```

- **`types` first** in every `exports` branch — guards the "types last → wrong resolution" hazard even with a single format.
- **`"main"` is dropped.** Declaring one invites a tool to `require()` an ESM file as CJS.
- **`publint` + `attw` stay in the build.** They catch exactly the resolution regressions this shape depends on; `attw` should report a clean ESM-only resolution.
- **Dependencies:** remove the `fp-ts` runtime dependency and the `@nestjs/common` peer dependency + `peerDependenciesMeta`. The package becomes **zero-dependency, zero-peerDependency**.
- **[`tsdown.config.ts`](../../tsdown.config.ts) and `exports` are updated together** — two entries (`.`, `./fluent`), ESM-only, `target: ES2023`. ([CLAUDE.md](../../CLAUDE.md)'s new-entrypoint rule.)
- **`exports` is hand-authored, not generated — established by [#21](https://github.com/alifarooq-zk/result-kit/issues/21) (2026-07-16).** [`tsdown.config.ts`](../../tsdown.config.ts) sets `exports: false`, because tsdown's generator **cannot express the block above**: it collapses `"."` to a bare string (losing the mandated types-first branch), and it offers no way to keep `module` without also emitting `main` — verified empirically, `exports.legacy: true` produces `"main": "./dist/index.js"`, the exact hazard this section forbids. `publint` + `attw` still validate the hand-written result on every build. **Consequence for [#28](https://github.com/alifarooq-zk/result-kit/issues/28):** adding `./fluent` means hand-editing `exports` alongside `tsdown.config.ts` — which satisfies the update-together rule, it just is not automated. Do not "fix" this by re-enabling `exports: true`; that silently reverts the types-first branch.

### 7.3 The fluent-boundary guard (mandatory)

ADR 0001's headline differentiator — a tree-shakable core neverthrow structurally cannot offer — survives **only** if the root `.` bundle never contains the fluent wrapper. The rule is: *`/fluent` imports only the core functions it delegates to; the barrel never re-exports the wrapper.*

**Prose is not sufficient.** The execution effort **must** add an automated guard that fails loudly on regression — either a **size budget** on the built `.` entry, or a **test importing only from `.` that asserts `ResultChain` / `ResultAsync` are absent from the built chunk**. This is over and above `publint`/`attw`, which check resolution, not bundle contents. Extend it to cover `safeTry`/`safeUnwrap` too.

This guard is the single most important piece of infrastructure in the spec: it is the only thing standing between the design and a silent regression that erases the differentiator the whole rework is built on.

## 8. Migration & release

Source: [ADR 0008](../adr/0008-v2-migration-breaking-change-story.md).

### 8.1 Why `5.0.0`

`2.0.0`, `3.0.0`, `3.0.1`, `4.0.0` **and `1.2.0`** were published 2026-03-27→30, then unpublished. **npm permanently retires an unpublished version number.** `2.0.0` cannot be created.

The decisive argument is **semver honesty**, not "next free number". Those versions were genuinely published for a few days; anyone who installed one holds a `^2`/`^3`/`^4` range that their next install re-resolves:

| Candidate | A stale `^2.0.0` resolves to it? | Verdict |
|---|---|---|
| `2.0.1` | **yes** — ships a total API rewrite as a **patch** | rejected |
| `2.1.0` | **yes** — ships it as a **minor** | rejected |
| **`5.0.0`** | **no** — above `^2` / `^3` / `^4` alike | **adopted** |

`5.0.0` is the only candidate under which the semver contract cannot lie.

### 8.2 Version bump — hand-set, no changeset

`package.json` currently declares the burned `1.2.0`, so a `major` changeset would compute `2.0.0` and `changeset publish` would **403**. Therefore:

1. Set `package.json` `version` directly: `1.2.0` → **`5.0.0`**.
2. Hand-write the `## 5.0.0` `CHANGELOG.md` entry (§8.4).
3. Add **no changeset** for the rework. `changesets/action` publishes the current `package.json` version when nothing is pending.
4. Resume normal changeset flow from `5.0.1` / `5.1.0` onward.

> This **knowingly overrides [CLAUDE.md](../../CLAUDE.md)'s "add a changeset for any consumer-facing change" rule — for this release only.** The tool cannot express the jump. Precedent: `CHANGELOG.md` already carries a hand-written rollback entry. Do **not** "fix" this by setting a fake `4.0.0` waypoint to let a changeset compute `5.0.0` — that commits a false, burned version to `main` to satisfy a tool.

### 8.3 `MIGRATION.md` — root, six areas

**Root placement**, not `docs/` — `docs/` holds contributor material; this is the one consumer-facing document. Linked from `README.md` and the `5.0.0` changelog entry. **No codemod ships**, so this rename table *is* the migration tool — it must be complete enough to drive a find-and-replace.

Ordered so the biggest break comes first:

1. **Before you start** — ESM-only, Node **≥22.12**, TypeScript **≥6.0**. A CJS consumer must load via `require(esm)` or dynamic `import()`. *This outranks every rename: it decides whether the package loads at all.*
2. **Rename table** — `Success`/`Failure` → `Ok`/`Err`; `success`/`failure`/`fail` → `ok`/`err`; `isSuccess`/`isFailure` → `isOk`/`isErr`; `mapError` → `mapErr`; `match` keys `onSuccess`/`onFailure` → `ok`/`err`; static `ResultKit.*` → free-function imports.
3. **The 10 cuts and their replacements:**

   | Cut | Replacement |
   |---|---|
   | `bimap` | `mapErr(map(r, onOk), onErr)` |
   | `flatten` | `andThen(r, x => x)` |
   | `unwrap` (→ `T \| undefined`) | `toNullable` for value-or-empty; `unwrapOrThrow` to throw |
   | `unwrapSuccess` / `unwrapFailure` | field access after `isOk`/`isErr` narrowing |
   | `tap` | `inspect` / `inspectErr` |
   | `filterSuccesses` / `filterFailures` | `partition` (each was one half) |
   | `pipe` / `pipeAsync` (+ `ResultPipeline` / `AsyncResultPipeline`) | `/fluent` or `safeTry` — see 4 |

   All `xAsync` doubles are gone too: `mapAsync`, `mapErrorAsync`, `andThenAsync`, `orElseAsync`, `matchAsync`, `unwrapOrElseAsync`, `tapAsync`, `combineAsync`, `combineWithAllErrorsAsync`. The §5.2 overloads absorb them.
4. **`pipe`/`pipeAsync` → `/fluent` or `safeTry`** — prose plus before/after. **A per-site design call, not a substitution.**
5. **Removed entrypoints** — `/nest` and `/fp-ts` (§8.5).
6. **Net-new** — `safeTry` / `safeUnwrap`, `defineError`, the `/fluent` entrypoint, `unwrapOrThrow`, `inspect` / `inspectErr`, the `fromPredicate` type-guard overload.

### 8.4 `CHANGELOG.md` `## 5.0.0`

In order:

1. **Why `5.0.0` and not `2.0.0`** — the burned-number explanation. The changelog is the **only** artifact that can answer this, because "why does this jump from 1.1.0 to 5.0.0?" only occurs to someone reading the release.
2. **Breaking** — one-liners: ESM-only / Node ≥22.12 / TS ≥6.0; core API reworked to free functions; `/nest` + `/fp-ts` removed; `fp-ts` and `@nestjs/common` dropped; **the `unwrapOrThrow` collision** (§8.5).
3. **Added** — `/fluent`, `safeTry` / `safeUnwrap`, `defineError`, `unwrapOrThrow`, `inspect` / `inspectErr`.
4. **→ See `MIGRATION.md`.**

It **must not restate the rename table.** `MIGRATION.md` is its single source of truth; a second copy in an append-only changelog drifts on the first edit and is never reconciled.

### 8.5 Removed entrypoints — bare note, one mandatory warning

Both get a **prose pointer only**. No shim ships, no replacement is provided, no `fp-ts` devDep is retained to typecheck one.

- **`/fp-ts`** (`toEither`, `fromEither`, `toTaskEither`, `fromTaskEither`): removed. Convert at your own boundary — `isOk(r) ? right(r.value) : left(r.error)`.
- **`/nest`** (`toHttpException`, `unwrapOrThrow`, `unwrapPromise`, `HttpExceptionDescriptor`, `NestErrorOptions`): removed, no replacement. Map `Result` to HTTP in your own exception filter or interceptor.

> ### ⚠️ The `unwrapOrThrow` collision — the migration's only silent breakage
>
> | | v1 `/nest` `unwrapOrThrow` | 5.0.0 core `unwrapOrThrow` (§5.3, net-new) |
> |---|---|---|
> | Throws | an `HttpException` | a plain throw on `Err` |
> | Purpose | HTTP boundary mapping | honest extractor |
>
> The name **survives find-and-replace, still typechecks, and silently stops producing HTTP responses.** Every other break in this migration is loud — a missing export or a type error. This one is not.
>
> **This warning is mandatory** in `MIGRATION.md` (§8.3 area 5) *and* in the `5.0.0` changelog's Breaking list (§8.4). It is a coordination constraint on the execution effort, not just a doc line.

### 8.6 Deprecate 1.x, post-publish

```sh
npm deprecate "@zireal/result-kit@1.x" \
  "v1 is unmaintained. v5 is a full rework: see MIGRATION.md"
```

`5.0.0` takes `latest` automatically, but that reaches nobody pinned to `^1.0.0` — and given the version jump, a pinned consumer has no reason to go looking for a `5`. `npm deprecate` only warns; it never breaks a build.

## 9. Execution checklist

Suggested order — §9.2 was deliberately first after the teardown, because §5.7's generator typing was the highest-risk unknown in the spec. It is now settled; §5.2's transform overloads are the remaining inference-sensitive area.

### 9.1 Teardown

- [ ] Delete `src/nest/`, `src/fp-ts/`, `src/internal/fp-ts.ts`, and the v1 `src/core/pipeline.ts` (`ResultPipeline` / `AsyncResultPipeline`).
- [ ] Delete the static `ResultKit` toolbox (`src/core/result-kit.ts`).
- [ ] Remove the `fp-ts` dependency and the `@nestjs/common` peer dependency + `peerDependenciesMeta`.
- [ ] Delete `test/nest/` and any fp-ts-bound tests.

### 9.2 Highest-risk first

- [x] **`safeTry` / `safeUnwrap` (§5.7)** — **done ([#23](https://github.com/alifarooq-zk/result-kit/issues/23), 2026-07-16).** Types as specified; no escalation. The yield/next plumbing is resolved in §5.7's implementation note — read it before touching `src/core/do-notation.ts`, because the naive signature compiles and is wrong. One upstream caveat recorded there, which the §3 `TypedError` convention cannot hit.
- [x] **The §5.2 transform overloads** — **done ([#24](https://github.com/alifarooq-zk/result-kit/issues/24), 2026-07-16).** Acceptance met: `andThen(fetchUser(id), validate)` infers `Promise<Result<User, NotFound | Forbidden>>`. Two amendments came out of it, both in §10.6 and both invisible at runtime: the promise arm takes `PromiseLike`, and §5.2's arm *order* must be inverted in code. Read the note at the top of `src/core/transforms.ts` before touching the overloads — as with §5.7, the naive transcription compiles and is wrong.

### 9.3 Core (`src/core/` → root barrel)

- [ ] `Ok<T>` / `Err<E>` / `Result<T, E>` (§2) — rename from `Success`/`Failure`.
- [ ] `ok` / `err` / `isOk` / `isErr` (§5.1) with narrow returns and type predicates.
- [x] `TypedError` + `defineError` + `ErrorCtor` (§3) — **done.** The prototype it was ported from is deleted, as planned; the verdict lives in ADR 0002 §4.
- [x] `isTypedError` (§5.1) — **done**; `TypedErrorOf` / `TypedErrorUnion` cut.
- [ ] Transforms (§5.2) — **done ([#24](https://github.com/alifarooq-zk/result-kit/issues/24))**; terminals (§5.3) — **done ([#25](https://github.com/alifarooq-zk/result-kit/issues/25))**; collections (§5.4) — **done ([#26](https://github.com/alifarooq-zk/result-kit/issues/26))**; interop (§5.5), async constructors (§5.6).
- [x] `OkTypeOf` / `ErrTypeOf` (§5.8) — **done ([#26](https://github.com/alifarooq-zk/result-kit/issues/26))**; they live in `src/core/result.ts` beside the `Ok` / `Err` they destructure, not in `collections.ts` — §5.4 tags *why they exist*, not where.
- [ ] Assert the §2.1 JSON round-trip guarantee in tests.

### 9.4 `/fluent`

- [ ] `ResultChain<T, E>` (§6.1) — delegating only; **no reimplemented logic**.
- [ ] `ResultAsync<T, E>` (§6.2, [ADR 0009](../adr/0009-v2-resultasync-surface.md)) — `implements PromiseLike`; five Promise-lifted terminals with **sync** handlers; **no** `isOk`/`isErr`.
- [ ] `/fluent` `ok` / `err` / `from` / `safeTry` (§6.3).
- [ ] `[Symbol.iterator]` on `ResultChain`; `[Symbol.asyncIterator]` on `ResultAsync`.
- [ ] Test: `await` on `ResultAsync` is **lossless** — `await ra` ≡ `await ra.toResult()`.
- [ ] Test: `ResultAsync.toJSON()` throws with an actionable message (§6.2).
- [ ] Test: `yield* resultAsync` works inside a `/fluent` async `safeTry` (§6.2, §6.3).

### 9.5 Packaging

- [ ] [`tsdown.config.ts`](../../tsdown.config.ts) + `exports` **together** (§7.2): two entries, ESM-only, `target: ES2023`.
- [ ] `package.json` per §7.2; `engines.node >=22.12`; drop `"main"`.
- [ ] **The §7.3 fluent-boundary guard.** Not optional.
- [ ] `publint` + `attw` green (pin `attw` to TS 6 if the TS 7 API blocks it — §7.1).
- [ ] Verify: `pnpm build`, `pnpm test`, `pnpm check`.

### 9.6 Docs & release

- [ ] Rewrite `README.md` against the 5.0.0 surface — **fluent (`ResultChain`) as the hero**, the free-function core as the documented lean path (§4). Consumer-facing: say `5.0.0`, never "v2".
- [ ] Write root `MIGRATION.md` (§8.3, six areas) — with the §8.5 `unwrapOrThrow` warning.
- [ ] Rewrite [`examples/core.ts`](../../examples/core.ts); **delete `examples/nest.ts`**.
- [ ] Update [`CLAUDE.md`](../../CLAUDE.md) — its Architecture section still describes `src/nest/` and the core/adapter split.
- [ ] Hand-set `package.json` to `5.0.0`; hand-write the `## 5.0.0` changelog (§8.4); **no changeset** (§8.2).
- [ ] Publish; `npm deprecate` 1.x (§8.6); resume changesets at 5.0.1+.

### 9.7 Repo hygiene (recorded by ADR 0008, deliberately deferred to execution)

- [ ] **There is no `v1.2.0` git tag** — verified 2026-07-15: tags stop at `v1.0.1` / `v1.0.2` / `v1.1.0`, while `package.json` and `CHANGELOG.md` both claim the (burned) `1.2.0`. Tag hygiene restarts at **`v5.0.0`**; do not retro-create a tag for a burned version.
- [x] ~~**`dist/` is checked into the working tree**, while `.gitignore` does not cover it.~~ — **ADR 0008 is factually wrong here; nothing to do.** Verified 2026-07-15: `git log --all -- dist` returns **zero commits** (it has never been tracked on any branch), `.gitignore` has listed `dist` since the file was created (commit `52565fc`), and `git status --ignored` reports `dist/` as `!!` (correctly ignored). What ADR 0008 saw was a **stale local build artifact** on disk (last written 2026-05-14) — untracked and already ignored. ADR 0008 is append-only and is **not** amended; this line is the correction.

## 10. Decisions this spec makes

The map's eight ADRs left four things open — all four found by consolidating them here, which is exactly the pressure eight separate documents don't apply. Three are decided in this document (§10.1–§10.3); the fourth was substantial enough to earn its own ADR (§10.4).

A **fifth** (§10.5) surfaced later still, when this spec was broken into execution tickets. Consolidation catches what eight documents miss; **ticketing catches what consolidation misses** — reading the spec as a builder, not an author, is its own kind of pressure. Worth carrying forward: a document can be internally consistent everywhere a reader looks and still contradict itself between two sections no one read together.

§10.1–§10.3 are recorded here rather than in an ADR **by choice**: they are naming and export-visibility calls with no real argument trail. §10.4 is not — it corrects a misreading of an accepted ADR, so it needed to reach ADR readers. §10.5 is an erratum against an accepted ADR that already decided the question, so it stays here too.

### 10.1 The fluent wrapper is named `ResultChain` — **decided**

No ADR ever named it; all eight say "the wrapper". [ADR 0005](../adr/0005-v2-async-strategy.md) named the async twin `ResultAsync`, leaving its synchronous counterpart anonymous — yet it is a public exported type consumers must annotate.

**`ResultChain`** names what it is. ADR 0001 describes the wrapper as *"a transient ergonomic envelope, never the interchange or serialized type"* — `ResultChain` says exactly that at the call site, and cannot be mistaken for the interchange `Result`.

- **Rejected — `Result` at `/fluent`** (shadowing the root union, neverthrow-style). It applies ADR 0001 §4's dual-constructor rule to the type and mirrors the incumbent's shape, but boundary code — the designed-in use case, since `from()` and `.toResult()` exist precisely to straddle the seam — would need an alias on every file importing both entrypoints.
- **Rejected — `FluentResult`.** No collision and self-describing, but no better than `ResultChain` on the asymmetry it shares, and it names the *entrypoint* rather than the *role*.

**Known cost:** the pair reads asymmetrically — `ResultChain` / `ResultAsync`. Accepted. `ResultAsync` is locked by an accepted ADR, and renaming it to `ResultChainAsync` to buy symmetry would amend ADR 0005 for cosmetics.

### 10.2 `OkTypeOf`, `ErrTypeOf`, and `ErrorCtor` are public type exports — **decided**

[ADR 0004](../adr/0004-v2-api-surface-method-inventory.md) uses `OkTypeOf`/`ErrTypeOf` in `combine`'s public signature but explicitly deferred them: *"helper type aliases the execution effort defines."* It never said whether they are public. `ErrorCtor` has the same status in [ADR 0002](../adr/0002-v2-typederror-model.md) — it is `defineError`'s return type.

**All three are exported.** They already appear in public signatures, so they surface in hover and `.d.ts` output whether exported or not — and an unexported name in a public signature is strictly worse, because a user sees a symbol they cannot import. They are type-only: **zero runtime, zero bundle, zero tree-shaking cost**, so they do not dent the lean claim. Names stay exactly as ADR 0004 and ADR 0002 wrote them.

### 10.3 `isTypedError` takes ADR 0002's signature — **decided**

The ADRs render it two ways: `x is TypedError` ([ADR 0002](../adr/0002-v2-typederror-model.md), base shape with the interface's `TData` default) versus `error is TypedError<string>` ([ADR 0004 §1](../adr/0004-v2-api-surface-method-inventory.md), which pins `TType` and lets `TData` default anyway). They differ only in explicitness.

**The spec takes ADR 0002's form** — `isTypedError(x: unknown): x is TypedError` — because ADR 0002 owns the error model and its defaults are the deliberate ones. ADR 0004 was listing the symbol for completeness, not restating its contract.

### 10.4 `ResultAsync`'s surface — **resolved by [ADR 0009](../adr/0009-v2-resultasync-surface.md)**

An earlier draft of this spec derived "`ResultAsync` has no terminals" from ADR 0005 §2 and flagged it for confirmation. **That derivation was wrong and has been withdrawn.**

ADR 0005 §2 is scoped to the **functional core** — its heading says so — and never constrained the wrapper. Its "terminals stay strictly synchronous" ruling answers whether the core's `match(result, cases)` should *overload* to accept a `Promise<Result>`; its stated cost (value-or-promise overload inference) does not arise for an unconditionally-async *method*. Reading that sentence in isolation invites the opposite conclusion, which is why [ADR 0005](../adr/0005-v2-async-strategy.md) now carries a forward note.

The question was then grilled properly and decided in **[ADR 0009](../adr/0009-v2-resultasync-surface.md)**: five `Promise`-lifted value-terminals with sync handlers, no `isOk`/`isErr`, a throwing `toJSON()`, and `[Symbol.asyncIterator]`. §6.2 carries the surface; ADR 0009 carries the rationale and the rejected alternatives.

### 10.5 `/fluent` exports the async constructors — **decided (2026-07-15, at ticketing)**

Found while breaking this spec into execution tickets — the fourth seam consolidation-pressure surfaced, and the first found by *reading the spec as a builder* rather than as an author.

§6.3 headed itself **"Complete `/fluent` export list"** and listed five values, omitting `fromPromise` / `fromThrowableAsync`. But **§4 states** that `ok`/`err`/`safeTry`/`fromPromise`/`fromThrowableAsync` exist at both entrypoints, and **[ADR 0005 §4](../adr/0005-v2-async-strategy.md)'s placement table** is explicit: `/fluent`'s `fromPromise` / `fromThrowableAsync` return a `ResultAsync`. A "complete" list and an accepted ADR cannot both be right.

**§4 and ADR 0005 win; §6.3 was an incomplete list, now amended to seven values.** The decisive argument is that the two are not interchangeable: `ResultAsync.from` lifts an already-`Result` promise, while `fromPromise` catches a rejection off a raw `Promise<T>`. Under the five-value reading, a `/fluent` user entering from a throwing promise **must** import from root — precisely the cross-entrypoint dependency ADR 0005 §4 rejected when it ruled that async constructors cannot live *only* at `/fluent`. The same reasoning forbids them living only at root.

- **Rejected — five values, no async constructors at `/fluent`.** A smaller surface, but it contradicts an accepted ADR's explicit table and §4 of this document; §6.3 is the outlier and the only text asserting it.
- **Not escalated to an ADR.** Unlike §10.4, this corrects no misreading and reverses no decision — ADR 0005 §4 already decided it. §6.3 simply failed to carry it. That makes this an erratum, which is what §10 is for.

### 10.6 The transforms' promise arm takes `PromiseLike` — **decided (2026-07-16, at build)**

Found while building §5.2 ([#24](https://github.com/alifarooq-zk/result-kit/issues/24)) — the fifth seam, and the first surfaced by neither consolidation nor ticketing but by **writing the code**. §10.5 predicted the pattern; here it is again one rung down.

§5.2 renders the promise-input arm as `Promise<Result<T, E>>` and implies the obvious runtime check, `instanceof Promise`. **That pair is unsound, and the flaw is in the check, not the type.**

`instanceof Promise` asks which *realm* an object was born in, not what it is. A genuine, native promise from a `vm` context, a worker, or an iframe is a `Promise<Result<T, E>>` to TypeScript — it type-checks, and it `await`s correctly — while `instanceof Promise` returns `false` for it:

```
typeof foreign.then       // 'function'
foreign instanceof Promise // false   ← native Promise, different realm
await foreign              // { ok: true, value: 42 }   ← awaits fine
```

Run that through §5.2's promise arm with an `instanceof` check and the failure is silent and total: the check says "not a promise", the value falls into the plain-`Result` path, `.ok` reads `undefined`, the err branch is taken, and the transform **returns the raw promise typed as `Result<U, E>`**. No throw, no rejection — a wrong value with a confident type. Pinned by the cross-realm regression test in `test/core/transforms.spec.ts`.

**So the check becomes `typeof x?.then === 'function'`, and the arm widens to `PromiseLike<Result<T, E>>` to match it.** The check is the decision; the widening is what keeps the types honest about it, because a runtime that accepts any thenable while the signature promises `Promise` is just the same lie pointing the other way. The return type stays `Promise<Result<T, E>>`: accept the loosest thing that can be awaited, hand back the concrete thing consumers expect — `Promise.resolve()` normalizes at the boundary. It is a pure widening; every `Promise` is a `PromiseLike`, so no call site §5.2 admits is lost.

The deeper reason: `await` and `Promise.resolve` are **defined** on thenables, not on `instanceof`. The language's own contract is structural here, and a library branching on `instanceof` is the thing deviating. A `Result` is `{ ok, value }` / `{ ok, error }` and never carries a `then`, so the check cannot misfire on the union.

`ResultAsync` (§6.2) implements `PromiseLike` and so flows into the core transforms for free under this rule — **but it is a beneficiary, not the reason.** An earlier draft of this section argued the reverse: that §4's delegation rule *required* the widening, because `ResultChain.map` would otherwise have nothing to delegate to. **That argument was wrong and is withdrawn.** `ResultAsync.from` takes a real `Promise` and the wrapper delegates *that internal promise*, never `this` — and §6.2's second safety property says so directly ("the functional core hands you `Promise<Result>` directly, so nobody ever *has* to touch `ResultAsync`"). The widening would be correct with `/fluent` deleted.

- **Rejected — widen the runtime check only, keep §5.2's `Promise` types.** No spec deviation, and it fixes the cross-realm bug. But it leaves the signature narrower than the behaviour, so a caller holding a `PromiseLike` is told no by a function that would have handled it. Types should describe what the code does.
- **Rejected — keep both, and document "pass real promises only".** Unenforceable: the offending value type-checks. A rule the compiler cannot state is not a rule.
- **Not escalated to an ADR.** It reverses no decision and corrects no misreading of one; ADR 0005 §2 fixed the *shape* of these overloads and is untouched. This corrects an unsound runtime check the spec never actually specified. That is an erratum.

**Known debt:** `safeUnwrap` (§5.7, shipped in [#23](https://github.com/alifarooq-zk/result-kit/issues/23)) branches on `instanceof Promise` and has the identical cross-realm hole — `safeUnwrap(foreignPromise)` takes the sync branch and yields a malformed `Err`. Out of #24's scope; raised on [#28](https://github.com/alifarooq-zk/result-kit/issues/28). Note this is **not** about `yield* resultAsync`, which routes through §6.2's own `[Symbol.asyncIterator]` and never reaches `safeUnwrap`.

**This spec no longer contains an open question** — for the third time. Each pass applies pressure the last could not: §10.1–§10.4 came from consolidating eight ADRs, §10.5 from reading the spec as a builder, §10.6 from *being* one. Treat "no open questions" as a claim with a short half-life, not a property.

**And a note on this section's own reliability**, earned the hard way. §10.6 shipped with a **wrong** decisive argument — a delegation requirement that §6.2 flatly contradicts, invented rather than verified, and caught only when someone asked "was that a good call?" *after* the code was green. The decision survived; the reasoning did not. Two things follow, and they cost nothing to state:

1. **A right answer reached by a wrong argument is not a right decision** — it is a coin landing well. It survives until someone reasons *from* the recorded rationale, which is the entire purpose of writing one down.
2. **The pass that catches this is the retro**, and it has no ticket. Consolidation, ticketing, and building each have a moment that forces them; asking "was that actually right?" after the tests pass has none. Green is not the end of the loop.

## 11. Traceability

| Spec § | Source | Note |
|---|---|---|
| §2 `Result` union | ADR 0003 | — |
| §2.1 JSON round-trip | ADR 0003 §5 + ADR 0002 §3 | `cause` carve-out |
| §3 `TypedError` / `defineError` | ADR 0002 + prototype [#17](https://github.com/alifarooq-zk/result-kit/issues/17) | — |
| §4 architecture | ADR 0001 | — |
| §5.1 constructors & guards | ADR 0003 §6, ADR 0002 §5 | `isTypedError` signature → §10.3 |
| **§5.2 transforms** | **ADR 0004 §1 + ADR 0005 §2** | **merged here; 0005 supersedes 0004**; `PromiseLike` arm + arm order → §10.6 |
| §5.3 terminals | ADR 0004 §1, ADR 0005 §2 | sync-only |
| §5.4 collections | ADR 0004 §1, ADR 0005 §2 | sync-only; `OkTypeOf`/`ErrTypeOf` → §10.2 |
| §5.5 interop | ADR 0004 §1 | — |
| §5.6 async constructors | ADR 0005 §3 | — |
| §5.7 do-notation | ADR 0007 + prototype [#23](https://github.com/alifarooq-zk/result-kit/issues/23) | yield typing resolved in §5.7's note; `safeUnwrap` name → ADR 0007 §5 |
| §5.8 public types | ADR 0004 §1, ADR 0002 §4 | publicness → §10.2 |
| **§6.1 `ResultChain`** | ADR 0004 §2, ADR 0007 §2 | **name → §10.1** |
| **§6.2 `ResultAsync`** | ADR 0005 §4–5 + **ADR 0009** | placement/safety from 0005; **member list from 0009** |
| §6.3 `/fluent` exports | ADR 0001 §4, ADR 0005 §4, ADR 0007 §3 | `safeUnwrap` stays out — ADR 0009 §5; **async constructors in — §10.5** |
| §7 packaging | ADR 0006 | — |
| §8 migration & release | ADR 0008 | — |
| §9.7 repo hygiene | ADR 0008 Consequences | — |
