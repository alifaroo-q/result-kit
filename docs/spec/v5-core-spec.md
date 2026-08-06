# `@zireal/result-kit` 5.0.0 — implementation spec

- **Status:** Handoff-ready
- **Date:** 2026-07-15
- **Author:** Ali Farooq
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifaroo-q/result-kit/issues/8) (complete)
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
- Formatter helpers for accumulated `TypedError[]` — declined for 5.0.0, backlogged as [#18](https://github.com/alifaroo-q/result-kit/issues/18).
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

A `Result` may therefore be an HTTP response body, a queue message, or a `postMessage` payload. **Three** carve-outs must be documented alongside the guarantee:

- **`cause`** ([ADR 0002 §3](../adr/0002-v2-typederror-model.md)). When `error` is a `TypedError`, `{ type, message, details }` is JSON-safe but a populated `cause?: unknown` may not be. **The caller sanitizes or drops `cause` before serializing.** The core never silently mutates error data to auto-strip it.
- **`.toResult()`-before-serialize** ([ADR 0003 §5](../adr/0003-v2-result-type-shape.md)). Never `JSON.stringify` a `ResultChain` or `ResultAsync`. Exit to the plain union first. `ResultChain.toJSON()` (§6.1) makes the mistake lossless, but the *documented* path stays explicit.
- **`Ok<void>` is consumable, not structurally identical** (§10.9). `ok()` — the form §5.1 recommends over `ok(undefined)` — serializes to `{"ok":true}`, because `undefined` is not JSON-serializable and `JSON.stringify` drops the key. It round-trips to a **one-field** object, which contradicts §2's "exactly two fields per half". It stays fully consumable (`.value` reads `undefined` either way, `isOk` works, nothing re-wraps), so the guarantee's practical intent holds — but the word *structurally-identical* does not, and this carve-out went undocumented until a pre-freeze retro measured it. Strictly, `Ok<void>` sits outside the antecedent, since `void` is not JSON-serializable; the guarantee never said so, while §5.1 recommends the constructor that produces it.

## 3. `TypedError` and `defineError`

Source: [ADR 0002](../adr/0002-v2-typederror-model.md), with the factory signature locked by the [`prototype/define-error/`](../../prototype/define-error/README.md) prototype ([#17](https://github.com/alifaroo-q/result-kit/issues/17)).

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

### 3.1a Error registries — `defineErrors` / `ErrorsOf`

The manual union above (`ReturnType<typeof notFound> | …`) stays fully supported. `defineErrors` / `ErrorsOf` are the **opt-in canonical form** for building it once from a named bag of constructors, added 2026-07-20 as a backward-compatible minor.

```ts
export function defineErrors<const T extends ErrorRegistry>(registry: T): T;
export type ErrorsOf<T extends ErrorRegistry> = {
  [K in keyof T]: T[K] extends (...args: never[]) => infer R ? R : never;
}[keyof T];
// ErrorRegistry = Record<string, (...args: never[]) => TypedError> — internal, not exported.
```

```ts
const billingErrors = defineErrors({ missingBaseItem, missingSwap, planNotFound });
type BillingError = ErrorsOf<typeof billingErrors>;
```

1. **`defineErrors` is a constrained identity.** It returns the registry unchanged; the only work it does is at the type level. The `ErrorRegistry` bound rejects a non-constructor entry *at the registration site* rather than letting it fold silently into `never` inside `ErrorsOf`. The `const` type parameter keeps the key set and each entry's `ErrorCtor` precise.
2. **`ErrorsOf` is constructor-based, never tag-based.** It maps over the registry's *values* and infers each constructor's **return type**, so every variant keeps its own typed payload. This is the mechanism §3.1 already mandates ("error unions are built from constructor return types, each with its own payload"), packaged as a helper — it is **not** the cut `TypedErrorUnion` (§3.3, §10.14), which keyed off tags and rebuilt variants with the default payload.
3. **The registry constraint is structural, not `ErrorCtor<string, unknown>`.** `ErrorCtor`'s call signature is conditional on `[TData] extends [void]`, so no single instantiation is a supertype of both the payload and no-payload forms; the structural `(...args: never[]) => TypedError` lower bound admits every real constructor — and a hand-rolled factory too, since the helpers standardize the shape, not the origin.
4. **`ErrorsOf` also accepts a plain object literal** with no wrapping call, and its `: never` fallback lets it degrade over an `import * as errors` module (non-constructor exports vanish rather than erroring). `defineErrors` is the stricter door for when you want the registration-time check.

### 3.2 Guards

- **`notFound.is(x)`** — per-variant, **tag-only** (`x.type === 'not_found'`). It cannot validate the payload at runtime; that needs a schema.
- **`isTypedError(x)`** — narrows a caught `unknown` to the base shape. See §5.1 for the signature (the ADRs render it two ways; the spec picks one).

### 3.3 Cut from v1

`TypedErrorOf` (a redundant alias) and `TypedErrorUnion` (distributes tags into same-*default*-payload variants, fighting the per-variant typed payload). The `ErrorsOf` helper added in §3.1a is **not** a return of `TypedErrorUnion`: it maps over constructor *values* and infers their return types, so per-variant payloads survive — the exact failure that got `TypedErrorUnion` cut. `isTypedError` is **kept, unchanged in name**. v1's separate typed `fail` constructor collapses into the single generic `err` — the typed convention is expressed by *what you pass*, not a second constructor.

### 3.4 Formatters (2)

Source: **[ADR 0010](../adr/0010-v2-error-formatter-helpers.md)**, [#18](https://github.com/alifaroo-q/result-kit/issues/18). Added 2026-07-18, at the maintainer's direction, **before** the release rather than as the post-release additive minor ADR 0004 §4 had deferred them to — so the API freezes with them in and there is no second cut.

They live in §3 rather than §5 because they operate on `TypedError[]`, not on a `Result`. They are exported from the root barrel like everything else (§5.9), and are free, pure, standalone functions — a consumer who imports neither ships neither.

```ts
export function groupByType<E extends TypedError<string, unknown>>(
  errors: readonly E[],
): { [K in E['type']]?: Extract<E, { type: K }>[] };

export function prettifyErrors(errors: readonly TypedError<string, unknown>[]): string;
```

```ts
const combined = combineWithAllErrors([ok(1), err(notFound({ id: 'u1' })), err(forbidden())]);

if (!combined.ok) {
  groupByType(combined.error);   // { not_found?: NotFound[]; forbidden?: Forbidden[] }
  prettifyErrors(combined.error);      // "✖ not_found: No user u1\n✖ forbidden: Not permitted"
}
```

Four constraints, each argued in full in ADR 0010:

1. **Zod's tree formatters are not portable, and that is a finding rather than a shortfall.** `treeifyError` and the deprecated `formatError` are **entirely** path-derived; `flattenError` is path-keyed too, bucketing on `path.length === 0` and keying on `path[0]`. All three need a `path`, which §3 has none of ([ADR 0002 §3](../adr/0002-v2-typederror-model.md) rejected a top-level `path` as validation-specific). No path, no tree — and no `formErrors`/`fieldErrors` split either, since that split is just `path.length === 0`.
2. **Nothing positional is available either.** §5.4's `combineWithAllErrors` returns a flat `E[]` and does not record which input failed, so which key an error *would* have had is not recoverable from the value being formatted. Any keyed shape must key on something intrinsic — and that is `type`, the discriminant §3 is built around and the structural analog of `ZodIssue.code`.
3. **`groupByType`'s keys are optional.** A union variant that does not occur has no key; a non-optional `Record<E['type'], E[]>` would type an absent group as present and hand back `undefined` — §10.6's failure mode. Each present group keeps its **narrowed** variant, which is the reason this is a function rather than a documented `Object.groupBy` one-liner. Precisely: `Object.groupBy` keeps the literal keys and their optionality, and loses only the per-group *value* type — its groups are `AppError[]`, not `NotFound[]`. That difference is the whole justification; an earlier draft claimed the keys were lost too, and that was false.
4. **`prettifyErrors` never reads `details`, and that is not redaction.** §3.1 lets a variant's `message` be *computed from* its payload, so a message may already carry interpolated fields; `prettifyErrors` neither adds to nor strips from it. Keep sensitive fields out of `message` — no formatter can undo that. An empty input returns `''`, not a placeholder, so the output composes into a larger message.

> **Recorded because the shape of the mistake recurs.** A first draft of ADR 0010 and of the implementation's own doc comment claimed `prettifyErrors` "does not leak the payload". The test written to assert it **failed**, correctly: `defineError('not_found', (d) => \`No user ${d.id}\`)` puts the payload in `message` before any formatter runs. The narrow claim ("never reads `details`") is true and useful; the broad one was false and would have read as a security property. Pinned by two tests, one for each half.

### 3.5 `matchType` — exhaustive dispatch over an error union

Source: [#64](https://github.com/alifaroo-q/result-kit/issues/64), with the signature locked by the [#73](https://github.com/alifaroo-q/result-kit/issues/73) prototype. Added after the `5.0.0` freeze as a backward-compatible **minor**; nothing here changes an existing signature.

It lives in §3 for §3.4's reason: it operates on a **`TypedError`**, not on a `Result`. Reach it from a `Result` through §5.3's `match` — `match(r, { ok: …, err: (e) => matchType(e, …) })`.

```ts
type Arms<E extends TypedError> = {
  [K in E['type']]: (variant: Extract<E, { type: K }>) => unknown;
};
type PartialArms<E extends TypedError> = { [K in E['type']]?: (variant: Extract<E, { type: K }>) => unknown };
type NoStrayArms<E extends TypedError, H> = Record<Exclude<keyof H, E['type']>, never>;
// all three internal, not exported.

export function matchType<E extends TypedError, H extends Arms<E>>(
  error: E,
  handlers: H & NoStrayArms<E, H>,
): ReturnType<H[keyof H]>;
export function matchType<E extends TypedError, H extends PartialArms<E>, R>(
  error: E,
  handlers: H & NoStrayArms<E, H>,
  fallback: (variant: Exclude<E, { type: keyof H }>) => R,
): ReturnType<NonNullable<H[keyof H]>> | R;
```

```ts
matchType(error, { not_found: () => 404, forbidden: () => 403, conflict: () => 409 });
//                                        a missing arm is a compile error

matchType(error, { not_found: () => 404 }, (e) => 500);
//                                             ^ e: forbidden | conflict
```

Four constraints, each a prototype finding rather than a style choice:

1. **Never a single naked `U` across the arms.** This is the §5.3 `match` trap in a *worse* form. There, `U` locks to the first inference candidate and the second branch is a hard error; here `U` does not infer at all — the call compiles and the result is silently `unknown`, even when every arm agrees. Inferring the bag `H` and returning `ReturnType<H[keyof H]>` unions the arms' returns and still collapses to one type where they agree.
2. **`NoStrayArms` is load-bearing.** `H extends Arms<E>` alone is satisfied by a bag with *extra* keys, and object-literal freshness does not fire against a type parameter — so a typo'd tag compiles as a dead arm that never runs. The clause types the stray key as `never`, and the error points at the arm rather than at the call.
3. **The fallback is a third parameter, not a `_` key in the bag.** A `_` arm sharing the bag cannot be narrowed to the *residual* variants under any formulation tried, currying included: `H` absorbs `_`, the `Exclude` resolves against a not-yet-inferred `H`, and the arm lands on `never`. As its own parameter, the bag's key set is known before the fallback is typed, so it sees exactly what is left. Residual narrowing is the reason to prefer this over `switch`, so the form that cannot deliver it does not ship — §10.9's "typed honestly or not at all" line, applied here.
4. **It throws when the tag has no arm and no fallback was supplied.** Only reachable by defeating the types (an `as any`, or a value crossing a runtime boundary with a tag its type did not admit), but returning `undefined` under a type promising a value is the silent-failure class this package refuses. The dispatch reads keys with `hasOwnProperty`, not a bare index — a tag of `constructor` or `toString` would otherwise find `Object.prototype`'s member and call it.

**The own-property rule.** The lookup is `Object.prototype.hasOwnProperty.call(handlers, error.type)`, and reading the guard off `Object.prototype` rather than calling `handlers.hasOwnProperty(...)` is load-bearing twice: a bag built with `Object.create(null)` has no such method, and a union carrying a `hasOwnProperty` variant would otherwise have its own arm invoked *as the guard*. Two consequences, both deliberate — an arm inherited from a prototype (a class-instance bag) is not offered and the call throws, and `{ __proto__: fn }` sets the bag's prototype instead of adding a key so that arm is likewise not offered (the computed `{ ['__proto__']: fn }` stores a real own property and works). **Arms are called unbound**, so `this` in a method-shorthand arm is `undefined` — unlike §5.3's `match`, which invokes `cases.ok(...)`. A handler bag is data, not an object with methods.

Five shapes that **compile and do less than they look like they do**. None is a defect in the signature; each is the consequence of a `TypedError` that is not a closed discriminated union, or of `any` behaving as `any`. All are pinned by assertions in `test/core/match-type.spec.ts`:

- **`details` is optional**, so an arm reads `v.details!.id`. Narrowing the *tag* does not make the payload non-optional.
- **The bare `TypedError` cannot be exhausted.** Its open `string` tag maps to an index signature, so *any* bag satisfies it — `{}` included, which returns `never` and throws, the same statement made twice. This bites hardest in a **mixed** union: one bare `TypedError` alongside good literal variants opens the whole tag to `string`, and exhaustiveness is gone with no diagnostic.
- **A variant whose tag is itself a union is one variant, not several.** `TypedError<'a' | 'b'>` is not assignable to `{ type: 'a' }`, so `Extract` finds nothing and both arms are typed `(v: never) => unknown` — every arm satisfies that, and the payload is unreachable. Declare two variants instead.
- **One `any` arm widens the whole result to `any`**, since the arms' returns are unioned and `any` absorbs a union. The no-`any` property is about what this signature introduces, not about what a caller can hand it.
- **A generic wrapper cannot supply arms**, even one constrained to the whole union (`<E extends AppError>`) — `Arms<E>` stays deferred. This is stronger than the unresolved-`E` degradation, and the answer is to widen at the call (`matchType(error as AppError, …)`) rather than fight it.

## 4. Architecture

Source: [ADR 0001](../adr/0001-v2-core-api-paradigm.md), [ADR 0005 §1](../adr/0005-v2-async-strategy.md), [ADR 0006](../adr/0006-v2-package-layout-entrypoints.md).

```
┌─ @zireal/result-kit  (root, `.`) ────────────────────────────┐
│  Result<T,E> = Ok<T> | Err<E>     ← plain data, no methods   │
│  37 free functions, data-first, no curry, no data-last       │
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

**What earns a seat in the root barrel** (2026-08-06): **root surface earns its seat by making expressible what was not otherwise expressible — never by making an expressible thing shorter.** The corollary is what makes the positioning above load-bearing rather than a taste claim: an ergonomics-only argument for a root export is answered by *"that is `/fluent`'s job"*, and a caller who declined `/fluent` over bundle size is the caller least likely to want another export in their graph. This is stated descriptively — it is the rule three independent decisions turned out to share, not a rule imposed on them ahead of time. Root `pipe` offered only a shorter spelling of composition already available three ways, and was measured as the *longest* spelling at all three call-sites ([ADR 0016](../adr/0016-declining-root-pipe-flow-dual.md)); §5.4's record overload recovers the **key**, which the array form structurally cannot give back ([ADR 0017](../adr/0017-object-form-combine.md)); and the resource-safety helper was declined because `safeTry` + `finally` and `using` already expressed it, while the one residue no export could close was never on the table (`RECIPES.md`). Because it is descriptive it binds nothing on its own — an export that clears it still needs its own case.

**Dual constructors** ([ADR 0001 §4](../adr/0001-v2-core-api-paradigm.md), reaffirmed by [ADR 0005 §4](../adr/0005-v2-async-strategy.md) and [ADR 0007 §3](../adr/0007-v2-do-notation-helper.md)): **same name, surface-appropriate return type**. `ok`/`err`/`safeTry`/`fromPromise`/`fromThrowableAsync` exist at both entrypoints; the root returns plain data, `/fluent` returns wrappers.

## 5. Root entrypoint — `@zireal/result-kit`

**37 free functions.** Data-first, **no currying, no data-last variants** — the auto-curry tree-shaking trap is why. Async is handled by overloads, never by an `Async`-suffixed twin.

> **Amended (2026-08-06): what is banned is currying, not overloading.** This sentence read "**one signature**, no currying, no data-last variants", which was true when written and is not any more: §5.4's two combinators each declare a second signature, overloading on *input shape* (array vs. record). The ban was always aimed at the auto-curry tree-shaking trap and at data-last doubles — the same clause already tolerated the async overloads named in its own next sentence, so "one signature" was never the rule it looked like. Overloads that dispatch on the shape of an argument are **permitted**; overloads that re-spell the same call data-last are not. Corrected here rather than left to §5.4's own note, because a reader learning what this package refuses reads §5, not §5.4. Rationale for the §5.4 case is [ADR 0017](../adr/0017-object-form-combine.md); the decline that fixes the other half of the line is [ADR 0016](../adr/0016-declining-root-pipe-flow-dual.md).
>
> **Amended (2026-08-06): the count is now 37, was 29.** This sentence and §4's diagram both read `29`, while §5.9's table read `33` — three statements of one number, none of them true and no two of them agreeing. All three are reconciled against the shipped barrel in the same pass; see the note on §5.9's export table for what the number now means and what it deliberately excludes.

### 5.1 Constructors & guards (7)

```ts
export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function err<E>(error: E): Err<E>;

export function isOk<T, E>(result: Result<T, E>): result is Ok<T>;
export function isErr<T, E>(result: Result<T, E>): result is Err<E>;

export function isTypedError(x: unknown): x is TypedError;

// defineError, defineErrors — §3.1
```

- **Narrow returns.** `ok`/`err` return `Ok<T>`/`Err<E>`, *not* `Result<T, never>`/`Result<never, E>`. Narrow is strictly more precise — it still assigns into any `Result<T, E>` annotation (widening is free) while preserving `.value`/`.error` access for code holding a known half. **Both clauses hold for the value itself and neither survived a transform until §10.10** — a narrow half offers `E` no inference site, so `E` fell back to `unknown` one hop later and stopped assigning anywhere. The decision stands; its cost is now recorded and paid by defaulting `E` to `never`.
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

> **Amendment from building this ([#25](https://github.com/alifaroo-q/result-kit/issues/25), 2026-07-16).** `match`'s signature above is **amended, not merely annotated** — the earlier `match<T, E, U>` is the one signature in this spec that contradicted its own prose, and it is corrected in place.
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

// Record ("object form") overloads — declared beneath the array signatures above,
// which stay verbatim. See the 2026-08-06 amendment below.

export type KeyedError<K extends PropertyKey, E> = {
  readonly key: K;
  readonly error: E;
};

export function combine<T extends Record<string, Result<unknown, unknown>>>(
  results: T,
): Result<
  { [K in keyof T]: OkTypeOf<NonNullable<T[K]>> },
  ErrTypeOf<NonNullable<T[keyof T]>>
>;

export function combineWithAllErrors<
  T extends Record<string, Result<unknown, unknown>>,
>(
  results: T,
): Result<
  { [K in keyof T]: OkTypeOf<NonNullable<T[K]>> },
  { [K in keyof T]-?: KeyedError<K, ErrTypeOf<NonNullable<T[K]>>> }[keyof T][]
>;
```

> **Amended (2026-07-17, at implementation): `partition` takes a `readonly` array.** This section wrote it mutable while both combinators above take `readonly` inputs, so a `readonly Result<T, E>[]` that `combine` accepts broke one call later at `partition` — for no stated reason, since nothing in `partition` mutates its input.
>
> The `readonly` form is a **strict superset**: every call the mutable signature accepted still resolves (a mutable array is assignable to a `readonly` parameter, not the reverse), and inference of `T` and `E` is untouched. So this is corrected in place rather than annotated as a deviation — the same strict-superset test §5.3's `UErr` default was amended under.
>
> Pinned by `test/core/collections.spec.ts`; enforced by `pnpm check`.

> **Amended (2026-08-06): the two combinators gain a record ("object form") overload.** Rationale, rejected alternatives and the reversal condition are in [ADR 0017](../adr/0017-object-form-combine.md); evidence is `spikes/effect-gen-comparison/FINDINGS.md` Part 3 (F14–F17). `partition` does **not** gain one — record support is a property of the combinators, not of this section.
>
> **Overloads, not one unified signature.** An array of `Result`s is not assignable to `Record<string, Result<unknown, unknown>>`, so the record overload is unreachable for an array input regardless of declaration order, and tuple preservation cannot degrade (F14). Effect's single `const Arg` spelling was rejected: `const T` leaks `readonly` into the success value, changing an already-shipped signature at call-sites with nothing to do with this feature (F15).
>
> **Two clauses in the signatures are load-bearing.** `NonNullable<T[K]>` is required rather than defensive — with an optional key `T[K]` is `Result | undefined`, which fails `OkTypeOf`'s and `ErrTypeOf`'s `R extends Result<unknown, unknown>` constraint, so the signature does not compile without it. And `-?` appears on the **error** mapped type but deliberately **not** on the success one: optionality must survive on the success side (`{ posts?: Result<string, E> }` maps to `posts?: string | undefined`, which is correct), while on the error side an optional key without `-?` puts `undefined` into the entry union — §10.6's failure mode, and the defect that sank the partial-record alternative. The asymmetry reads as an inconsistency and must carry a doc comment and a type-level assertion.

- **`combine` is fail-fast** (first error, errors unioned); **`combineWithAllErrors` accumulates every error** as a flat array for an array input, and as a **`KeyedError` array** for a record input — the `ZodError.issues[]` analog, and the whole of the accumulation story.
- **The record form of `combineWithAllErrors` carries keys; the array form stays flat.** The pair is knowingly asymmetric: a record knows the name of each part and throwing that away is the only reason not to pass one. `KeyedError` keeps `key` and `error` correlated per entry, so `switch (entry.key)` narrows `error` to that key's variant; over an index-signature record it degenerates honestly to `KeyedError<string, E>`. The consequence to state at the call-site: a `KeyedError[]` is **not** accepted by `groupByType` or `prettifyErrors`, which take a flat `TypedError[]` — bridge with `errors.map((e) => e.error)`.
- **"First `Err`" means property order for a record input, not order as written.** `combine({ 10: late, 2: early })` returns `early`: `Object.keys` yields integer-like keys in ascending numeric order *before* insertion-ordered string keys, and `combineWithAllErrors` inherits the same ordering for accumulation. Only own enumerable properties participate, matching `parse.ts`. **Symbol keys are invisible** — a symbol-keyed `Err` does not join the string index signature, so it type-checks and is silently dropped. This is documented rather than closed: it matches the §2.1 serialization boundary the package is built around, and a per-call symbol scan would defend against a shape the type system cannot express usefully.
- **A present-but-`undefined` entry throws a named diagnostic.** An optional key may carry `undefined` as a *present* own key; reading `.ok` off it threw a bare `TypeError` — a handler that is itself the crash. It stays a hard failure (a non-`Result` in the bag is a programming error, and skipping it silently would hide a real mistake) but reports through `render.ts`'s diagnostic family, naming the offending key: `combine: value at key "posts" is not a Result (received: undefined)`. **The array path takes the same guard**, since `for...of` over a sparse array yields `undefined` identically — that half is a fix to shipped behaviour. The two paths differ in *when* they fire: the record path validates the whole bag first, so the diagnostic is deterministic rather than hiding behind whichever `Err` happened to come first; the array path guards as visited, because a sparse array is reachable only through a cast and the hot path should not pay a second pass.
- **Both preserve tuples** — heterogeneous per-position types, with the homogeneous array as a special case.
- **Empty input is `ok([])`** for both combinators — the identity that makes `combine` fold-like, and what keeps `combineWithAllErrors` from erring on *no* errors. **`combine({})` is `ok({})`**, the same identity in the record form rather than a special case; an empty *array* still picks the array overload, so the two never contend. `partition([])` is `[[], []]`.
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

> **Implementation note — resolved by [#23](https://github.com/alifaroo-q/result-kit/issues/23) (2026-07-16).** The signatures above are the verdict of a prototype (since deleted); the plumbing they encode is not decoration, and two details are load-bearing in ways no happy-path call site reveals.
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

> **This block names the types §5 itself specifies, not the whole exported set** — §5.9's list is the complete one, and it carries six more (`ErrorsOf`, plus the five belonging to the groups §5 has no subsection for). Noted 2026-08-06 alongside the §5.9 reconciliation, because an incomplete list with no count reads as complete.

### 5.9 Complete root export list

**Values (37):**

| Group | Exports | Specified in |
|---|---|---|
| Constructors & guards (7) | `ok` `err` `isOk` `isErr` `isTypedError` `defineError` `defineErrors` | §5.1, §3.1 |
| Error matching (1) | `matchType` | §3.5 |
| Formatters (2) | `groupByType` `prettifyErrors` | §3.4 |
| Transforms (6) | `map` `mapErr` `andThen` `orElse` `inspect` `inspectErr` | §5.2 |
| Terminals (5) | `match` `unwrapOr` `unwrapOrElse` `unwrapOrThrow` `toNullable` | §5.3 |
| Collections (3) | `combine` `combineWithAllErrors` `partition` | §5.4 |
| Interop (3) | `fromNullable` `fromPredicate` `fromThrowable` | §5.5 |
| Async constructors (2) | `fromPromise` `fromThrowableAsync` | §5.6 |
| Schema adapters (2) | `fromSchema` `fromSchemaAsync` | §5.10 |
| Envelope parsing (2) | `isResult` `parseResult` | §5.11 |
| Do-notation (2) | `safeTry` `safeUnwrap` | §5.7 |
| Assertions (2) | `expectOk` `expectErr` | §5.12 |

**Types (13):** `Result` `Ok` `Err` `TypedError` `ErrorCtor` `ErrorsOf` `OkTypeOf` `ErrTypeOf` `MalformedResult` `MalformedResultReason` `FromSchemaOptions` `ValidationFailed` `ValidationIssue`

> **Reconciled 2026-08-06 against the shipped barrel — was "Values (33)" / "Types (9)".** The table had not tracked four exports added since it was written (`fromSchema` / `fromSchemaAsync`, `isResult` / `parseResult`) or their five types, and the same drift had reached §4's diagram and §5's opening sentence as a *different* wrong number (29). The counts above are now those of `src/index.ts`, and they agree with `llms-full.txt` — pinned by `test/docs/agent-kit.spec.ts`, which is the guard that actually held throughout and is why the drift went unnoticed. **That guard, not this table, remains the source of truth**: it reads the barrel, and this table is hand-maintained.
>
> **`KeyedError` is specified but not yet shipped**, so it is deliberately absent above. §5.4's record overloads declare it and [ADR 0017](../adr/0017-object-form-combine.md) records the bump; when they land it becomes the **14th** type here and in `llms-full.txt`, in the same commit.
>
> **Closed [#96](https://github.com/alifaroo-q/result-kit/issues/96) (2026-08-06): the three groups that had no §5 subsection now have one.** The schema adapters, envelope parsing and the assertions had each landed against an ADR or an issue rather than a spec group, so the `Specified in` column carried an em dash — this document claimed authority over signatures it did not state, for six of the 37 values and five of the 13 types. They are §5.10, §5.11 and §5.12; the note below the export list explains why they sit after it rather than beside their siblings.

**Not exported from root:** `ResultChain`, `ResultAsync`, `from` — these are `/fluent` only, and §7.3's guard enforces it.

> **Why §5.10–§5.12 sit *after* the export list** ([#96](https://github.com/alifaroo-q/result-kit/issues/96), 2026-08-06). Reading order would put these three groups beside their siblings, between §5.7 and §5.8 — but that renumbers §5.8 and §5.9, and **§5.9 is cited by [ADR 0010](../adr/0010-v2-error-formatter-helpers.md), [ADR 0016](../adr/0016-declining-root-pipe-flow-dual.md) and [ADR 0017](../adr/0017-object-form-combine.md)**, which are append-only and so cannot be corrected to follow. A renumber does not break a link; it silently redirects three ADRs to the wrong section, which is worse. `CLAUDE.md` cites §5.9 repeatedly for the same reason. The number is load-bearing, the ordering is not, so the ordering gave way. §5.9's `Specified in` column points forward.
>
> **§3 was considered and rejected for all three.** §3.4 and §3.5 live in §3 rather than §5 on a stated test — they operate on a `TypedError` or a `TypedError[]`, *not* on a `Result`. All six functions here fail that test in the other direction: `fromSchema` and `parseResult` **return** a `Result`, and `expectOk` / `expectErr` **take** one. That `ValidationFailed` and `MalformedResult` happen to be `TypedError`s is incidental — it describes what rides in the `E` channel, not what the function operates on, and §5.4's `combineWithAllErrors` is already a §5 member by the same reasoning. Recorded because the test is easy to apply backwards.

### 5.10 Schema adapters (2)

Source: [ADR 0015](../adr/0015-standard-schema-issue-mapping.md), shipped in [#61](https://github.com/alifaroo-q/result-kit/issues/61). **Not in §5.5** despite being a sixth way *into* the `Result` world: it brings two public types and a vendored third-party interface with it, which is §3.4's argument for `format.ts`.

```ts
export interface ValidationIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export type ValidationFailed = TypedError<
  'validation_failed',
  { readonly issues: readonly ValidationIssue[] }
>;

export interface FromSchemaOptions {
  readonly includeCause?: boolean;   // default false
}

export function fromSchema<S extends StandardSchemaV1>(
  schema: S,
  options?: FromSchemaOptions,
): (input: unknown) => Result<InferOutput<S>, ValidationFailed>;

export function fromSchemaAsync<S extends StandardSchemaV1>(
  schema: S,
  options?: FromSchemaOptions,
): (input: unknown) => Promise<Result<InferOutput<S>, ValidationFailed>>;
```

`StandardSchemaV1` is **vendored, not depended on** — the spec package is types-only, and a `.d.ts` rollup that re-emitted a type-only import of it would put a bare specifier in a shipped artifact, the class §7.3's guard exists to catch. It is exported from the module but **not from the barrel**, so it is absent from §5.9's type list by design — do not read it as one of the 13. `InferOutput` is internal, read off `~standard.types` rather than inferred from `validate`'s return.

Both are **lazy**, returning a reusable parse function — §5.5's `fromThrowable` shape, for its reason.

Six constraints, each of which cost something to establish:

1. **`E` is one `TypedError`, never an array** ([ADR 0015](../adr/0015-standard-schema-issue-mapping.md) §1). A `Result` has one error channel; an array in `E` forces `matchType`, `isTypedError`, `.is()` and `unwrapOrThrow` to each special-case it. Accumulation lands one level up, via §5.4's `combineWithAllErrors` across several validated inputs.
2. **The tag is a fixed literal**, not overridable — a stable tag keeps every consumer's error union and §3.5 exhaustiveness predictable, and re-tagging is a one-line `mapErr`.
3. **`ValidationIssue` carries the two fields Standard Schema *defines*, and no more.** Only `message` is *guaranteed* — the vendor `path` is optional and heterogeneous (`PropertyKey | { key: PropertyKey }`, `symbol` included), which is what clause 4's normalization exists to absorb; `ValidationIssue.path` is always present because this adapter makes it so, not because the vendor promised it. Vendor extras — Zod's `code`, `expected`, `input` — are **dropped**. The trade is real: branching on *what kind* of failure occurred is not possible from the portable payload. A `details` that varies between Zod, Valibot and ArkType is not an adapter, and Zod's `input` is a live route for PII, a `BigInt` or a cycle into the one field §2.1 promises is JSON-safe.
4. **`path` is an array and always present** (`[]` is the root), never a dotted string — a dotted string cannot round-trip a key containing a dot, and it is one `join` away from this. Segment coercion is **total**: `string` and *finite* `number` pass through, everything else goes through `String(key)`. That is broader than the `symbol`-only rule ADR 0015 §3 first enumerated, amended in place after a `v.map(v.bigint(), …)` failure made `JSON.stringify` on the `Result` **throw** and an object key was retained by identity.
5. **`includeCause` is off by default, and the default was the decision** ([ADR 0015](../adr/0015-standard-schema-issue-mapping.md) §5). Always-on was the first recommendation, rejected on a measured cost: Zod puts the failing input in its issues, so every validation error would retain the rejected payload — PII and memory both — inside a value people log by reflex. It does not change the return type; `cause` is already optional on `TypedError`.
6. **A schema that throws or rejects propagates.** A crash is not a validation failure, and laundering it into `validation_failed` would claim an issue list that does not exist. This is the one place the family's usual rejection-catching does not apply, which is why there is no `onReject` in the options bag; wrap in `fromThrowable` if an untrusted schema needs containing.

**`fromSchemaAsync` accepts synchronous schemas; `fromSchema` does not accept asynchronous ones** — it throws a `TypeError` naming `fromSchemaAsync`. The asymmetry is deliberate rather than an oversight: this direction costs a microtask, while the other cannot be served at all. When it is not statically known which kind of schema arrives, `fromSchemaAsync` is the one to reach for. Before throwing, `fromSchema` **defuses the promise it abandons**, or a rejecting async schema raises an unhandled rejection a tick later and kills the process the caller had already recovered in.

Both halves take §10.11's **settled-first** ordering — `Result`-shaped before thenable — and `fromSchemaAsync` needs it as much as the sync half. A bare `await` looks like it makes the question moot and does the opposite: §2's union is brandless, so a settled failure may carry a `then`, and `await` hands the value to it. Measured, not argued — it returned `Ok` holding a leaked value where `fromSchema` correctly returned the `Err`, and a `then` that never called back hung forever.

### 5.11 Envelope parsing (2)

Source: **none — this group has no ADR**, shipped in [#66](https://github.com/alifaroo-q/result-kit/issues/66). Recorded rather than left blank: it is additive surface that reverses no prior decision, so §10's escalation bar was not met, and this section is therefore the only normative statement of it.

This is the **safe landing half of §2.1's round trip**: §2 makes the union structural so a `Result` can *leave*, and nothing covered the way back in, so every wire-crossing consumer wrote `as Result<T, E>` — an assertion the round-trip guarantee implicitly encourages and the type system cannot check.

```ts
export type MalformedResultReason =
  | 'not_an_object'          // a primitive, `null`, or an array
  | 'unreadable'             // own properties could not be read — a hostile `Proxy`
  | 'missing_discriminant'   // no `ok` property at all
  | 'invalid_discriminant'   // an `ok` that is not a boolean
  | 'error_dropped';         // `ok: false` with no `error` key

export type MalformedResult = TypedError<
  'malformed_result',
  { readonly reason: MalformedResultReason }
>;

export function isResult(value: unknown): value is Result<unknown, unknown>;

export function parseResult(
  value: unknown,
): Result<Result<unknown, unknown>, MalformedResult>;
```

**The nesting in `parseResult` is the honest shape**, not an accident: the outer `Result` answers *was this a `Result` at all*, the inner one *did the operation succeed*. Collapsing them makes a malformed envelope indistinguishable from a reported failure, which is the distinction the function exists to draw.

Six constraints:

1. **Neither is generic, and `parseResult<T, E>` must not compile.** It would reinstate the `as Result<T, E>` cast this module exists to delete — the same lie behind a friendlier face. This module can prove the *envelope* and nothing about what it carries; narrowing the halves is the caller's job, or §5.10's. A type-level assertion pins it.
2. **Both run one shared classifier**, so `isResult` and `parseResult` cannot disagree about what a `Result` is. That sharing is the whole argument for shipping a pair rather than either alone.
3. **The discriminant probe is `propertyIsEnumerable`** — not `in`, not `Object.hasOwn`. That is exactly the set `JSON.stringify` writes. The first spelling (`'ok' in value`) called an object *inheriting* `ok` well-formed while it serialized to `{}`; a guard for wire re-entry that disagrees with the wire is worse than none. Caught by its own test, not by review, and §3.5 reached past `in` for the neighbouring reason.
4. **A bare `{ ok: true }` is accepted and a bare `{ ok: false }` is rejected**, and the asymmetry is this spec's rather than taste. Both lose an `undefined` payload to `JSON.stringify` and TypeScript rejects both, but §10.9 carves out `Ok<void>` **because §5.1 recommends the constructor that produces it**, while `err` has no no-arg overload — so a bare `{ ok: false }` only ever means a non-serializable error went onto the wire. Measured: admitting it crashes `matchType`, `groupByType` and `prettifyErrors` one hop later, all three reading `type` off `undefined`. There is no value-side equivalent, because nothing in the package consumes `.value` structurally.
5. **Extra properties pass, and are never stripped.** §2's exactly-two-fields rule binds what this package *builds*, not what it will *look at* — a gateway that stamped a `traceId` on the envelope has not made it stop being a `Result`. On success the input is returned **as-is**: same object, extras and all. This validates; it never normalizes or reconstructs.
6. **The classifier cannot throw.** Every probe can, against a hostile or revoked `Proxy` — which makes even `Array.isArray` throw — so the whole walk sits inside one handler answering `'unreadable'`. Avoided here rather than found later; the internal diagnostic renderer §5.12 relies on had the same shape found the hard way, three times.

**The rejected value is not in `details`.** Unlike §5.10's issues, which are produced inside the adapter and are otherwise unreachable, the caller of `parseResult` is holding the input already — putting it in `details` buys nothing and routes arbitrary wire data into the field §2.1 promises is JSON-safe. That is also why there is no `includeCause` here. `MalformedResultReason` is exported because it surfaces in hover and `.d.ts` output whether exported or not, and a symbol a user can see but cannot import is strictly worse (§10.2).

### 5.12 Assertions (2)

Source: [ADR 0011](../adr/0011-testing-subpath-matchers.md) (Option B), shipped ahead of the `/testing` matchers that later delegate to them.

```ts
export function expectOk<T, E>(result: Result<T, E>): T;
export function expectErr<T, E>(result: Result<T, E>): E;
```

Test-facing narrowing terminals: return the expected half, throw a descriptive `Error` on the other. They are at the **root, not `/testing`** — they are dependency-free and ADR 0011's Option B ships them where the core is, while the `./testing` subpath (§6.4) carries only the Vitest matchers, which have an optional peer.

Three constraints:

1. **They are the throwing counterpart to §5.3's terminals, not a competitor to them.** `unwrapOrThrow` is production surface and throws the error it holds; these are test surface and throw a *diagnostic about the branch*. The difference is the audience, and it is why both exist.
2. **The payload renders through an internal diagnostic renderer, never `JSON.stringify`.** This message is thrown at the moment a caller is already confused, and a raw `TypeError: Converting circular structure to JSON` in its place answers a question nobody asked. A `TypedError` — or the array of them `combineWithAllErrors` produces — reads in §3.4's `✖ type: message` *form*, with `details` and `cause` beneath, so the failure is diagnosable from test output alone. **A message may therefore be multi-line**; consumers must not flatten it. The renderer itself is **not §3.4 surface** and this spec does not specify it: §3.4 specifies `groupByType` and `prettifyErrors`, and its constraint 4 — *"`prettifyErrors` never reads `details`"* — still holds, being a statement about that one-liner. This is not a one-liner, and `details` is exactly the field a reader would otherwise go and log by hand.
3. **The rendering rule is symmetric.** `expectErr` prettifies an `Ok` carrying a typed error shape too. That is unusual but not wrong, and one rule holding on both branches beats two rules differing by which half you are on.

The `/testing` matchers delegate **every** wrong-branch message here, which is what let that renderer's prettified output reach them with no edit under `src/testing/`. Unlike these functions, a matcher does **not** narrow and cannot — a Vitest matcher says nothing about its subject's type — so `expectOk` remains the way to read `.value`.

## 6. Opt-in entrypoints — `/fluent` and `/testing`

> **Retitled 2026-08-06** ([#96](https://github.com/alifaroo-q/result-kit/issues/96)). This section read "`/fluent` entrypoint" and covered that subpath alone, while `./testing` — shipped in [#63](https://github.com/alifaroo-q/result-kit/issues/63) — had no section anywhere, appearing only in §7.1's amendment note about the entrypoint count. That is the gap #96 closed for the root groups, one entrypoint over, and §6.4 closes it here. **The number did not change and no subsection was renumbered**, for the reason given under §5.9: §6, §6.1–§6.3 and §7.x are cited from append-only ADRs, so a renumber would silently redirect them. Only the title widened.

§6.1–§6.3 specify `/fluent`; §6.4 specifies `/testing`. Both are opt-in: the root entrypoint is self-sufficient (§4), and a consumer who imports neither ships neither.

**`/fluent` — `@zireal/result-kit/fluent`.** The wrapper mirrors only functions operating on a **single `Result` instance**, delegating one-to-one to the core. Array- and entry-shaped functions (`combine`, `partition`, `from*`, `isTypedError`) stay **free-function-only** — re-enter fluent-land with `from(...)`.

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

> **`.match()` carries §5.3's amendment** ([#25](https://github.com/alifaroo-q/result-kit/issues/25), 2026-07-16), and its signature above is corrected in place. Binding `T` and `E` on the class buys the method nothing here: `U` is still a single naked parameter across both callbacks, so `ra.match({ ok: (u) => u.credit, err: () => 'anon' })` fails to compile for the same first-candidate-wins reason. `ResultChain.match()` (§6.1) is the same. The hero example above is *not* affected — both its branches return `string`, which is exactly why this trap survives a happy-path reading. Delegating to the corrected core is not sufficient; the wrapper's own signature must carry the fix.

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

> **A rejecting inner promise propagates — added 2026-07-17, in the retro of [#29](https://github.com/alifaroo-q/result-kit/issues/29).** This section specified the behaviour nowhere, and the omission is worth closing because one consequence is genuinely surprising.
>
> `ResultAsync.from` takes a `Promise<Result<T, E>>` — a promise that has *already* entered the result world and therefore should not reject. If it does, the caller broke that contract, and the class propagates, uniformly across `then` and all five terminals, exactly as `await ra.toResult()` would. Nothing is swallowed, and nothing is converted into an `Err`: `E` is the **modelled** error channel, and laundering a contract violation into it would make `E` a lie — the same reason §5.5's `errorFn` takes `unknown` rather than `Error`.
>
> **The sharp edge: `unwrapOr(d)` rejects**, despite being total everywhere else in the library. That follows from the rule rather than contradicting it, but it is exactly the kind of thing a reader assumes the other way. `fromPromise` is the constructor that *does* catch a rejection into `E` — which is §10.5's distinction restated, and the answer for anyone holding a promise that can genuinely reject.
>
> Pinned by `test/fluent/result-async.spec.ts`, including the `fromPromise` contrast that makes the rule navigable rather than a trap.

### 6.3 Complete `/fluent` export list

**Values (7):** `ok` `err` `from` `safeTry` `fromPromise` `fromThrowableAsync` `ResultAsync`
**Types (2):** `ResultChain` `ResultAsync`

> **Amended 2026-07-15 — was "Values (5)", omitting `fromPromise` / `fromThrowableAsync`.** That list contradicted §4's dual-constructor rule and [ADR 0005 §4](../adr/0005-v2-async-strategy.md)'s placement table, both of which place both async constructors at **both** entrypoints. §4 wins. See §10.5.

```ts
export function ok(): ResultChain<void, never>;
export function ok<T>(value: T): ResultChain<T, never>;
export function err<E>(error: E): ResultChain<never, E>;
export function from<T, E>(result: Result<T, E>): ResultChain<T, E>;

// The body may return EITHER half of the dual constructor — see §10.13.
type BodyReturn = Result<unknown, unknown> | ResultChain<unknown, unknown>;

export function safeTry<Y extends Err<unknown>, R extends BodyReturn>(
  gen: () => Generator<Y, R>,
): ResultChain<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>;
export function safeTry<Y extends Err<unknown>, R extends BodyReturn>(
  gen: () => AsyncGenerator<Y, R>,
): ResultAsync<ValueOf<R>, ErrorOf<Y> | ErrorOf<R>>;

// dual constructors — §4, ADR 0005 §4. Same names as root, wrapper return types.
export function fromPromise<T, E>(promise: Promise<T>, onReject: (error: unknown) => E): ResultAsync<T, E>;
export function fromThrowableAsync<Args extends unknown[], T, E>(
  fn: (...args: Args) => Promise<T>,
  onReject: (error: unknown) => E,
): (...args: Args) => ResultAsync<T, E>;
```

- **`/fluent` has no `safeUnwrap`** — the wrapper is self-iterable, so `yield* chain` works directly. Root's `safeUnwrap` remains available for unwrapping a *plain* union inside a fluent `safeTry`.
- **The body returns a `ResultChain` *or* a plain `Result`, and `Y`/`R` are naked** — amended 2026-07-18 at build, see **§10.13**. The signature above originally read `gen: () => Generator<..., Result<T, E>>`, which rejects the one thing a `/fluent` user actually writes: `ok` is the dual constructor here, so `return ok(v)` produces a **wrapper**. The naked type parameters carry §5.7's implementation notes 1 and 2 for the same reasons the core's do.
- **`fromPromise` ≠ `ResultAsync.from`.** `ResultAsync.from` lifts a `Promise<Result<T, E>>` that is *already* a union; `fromPromise` catches a rejection off a raw `Promise<T>` into the `E` channel. Neither substitutes for the other, which is why omitting `fromPromise` here would have left a `/fluent` user no rejection-catching entry into the wrapper without importing from root — breaking core/wrapper symmetry in the opposite direction to the one §4 guards.
- **`ResultChain` is exported as a type; instances come from `ok`/`err`/`from`/`safeTry`.** `ResultAsync` is exported as a **value** (class) because [ADR 0005 §4](../adr/0005-v2-async-strategy.md) specifies the static `ResultAsync.from(promiseOfResult)`. The asymmetry — free `from` for sync, static `ResultAsync.from` for async — is as-decided; do not "fix" it without a new decision.

### 6.4 `/testing` — `@zireal/result-kit/testing`

Source: [ADR 0011](../adr/0011-testing-subpath-matchers.md) **Option A**, deferred there and unblocked by [ADR 0014 §1](../adr/0014-peer-dependency-policy-and-lint-package-layout.md); shipped in [#63](https://github.com/alifaroo-q/result-kit/issues/63). Four Vitest matchers over a `Result`. §5.12's `expectOk` / `expectErr` are Option B of the same ADR and stayed at the root; these are the half that needed a peer.

```ts
export const resultMatchers: {
  toBeOk(): void;                        // the subject is an Ok, whatever it carries
  toBeOkWith(expected: unknown): void;   // an Ok whose `value` deep-equals `expected`
  toBeErr(): void;
  toBeErrWith(expected: unknown): void;
};

// ambient — merges into vitest's own `Matchers<T>`; rides along with any import
// from this module, so no `/// <reference>` is needed.
declare module 'vitest' {
  interface Matchers<T = any> {
    toBeOk(): void;
    toBeOkWith(expected: unknown): void;
    toBeErr(): void;
    toBeErrWith(expected: unknown): void;
  }
}
```

```ts
// vitest.setup.ts
import { expect } from 'vitest';
import { resultMatchers } from '@zireal/result-kit/testing';

expect.extend(resultMatchers);
```

Six constraints, four of them enforced by `test/testing/boundary.spec.ts` rather than by review:

1. **`vitest` is imported in type position only.** That is what makes the peer optional *in fact*: `peerDependenciesMeta.optional` is a claim about installation, while the shipped chunk's import list is a claim about **resolution**. The guard asserts the built `dist/testing/` chunk contains **no bare specifier at all**. §7.2's "zero-dependency, zero-peerDependency" bullet is not violated — [ADR 0014 §0](../adr/0014-peer-dependency-policy-and-lint-package-layout.md) resolves that the promise is about the core artifact's install footprint, and an optional peer is never installed.
2. **Registration is explicit, never a side effect of importing.** §7.2 declares `sideEffects: false`, so an auto-registering module is a bundler-droppable import — and the failure mode is a matcher that silently is not there.
3. **The matchers do not narrow, and cannot.** A Vitest matcher's return type says nothing about its subject, so `expect(r).toBeOk()` leaves `r` a `Result<T, E>`. Reading `.value` still needs §5.12's `expectOk`. That is the division of labour rather than a gap: these **assert**, §5.12 **extracts**.
4. **Every wrong-branch message is delegated to §5.12**, never authored here — one wording to maintain. It paid off exactly as intended: when the diagnostic renderer gained prettified `TypedError` output, the matchers inherited it with **no edit** under `src/testing/`, only a test asserting they did. A delegated message may therefore be **multi-line**, and must not be flattened.
5. **A non-`Result` subject throws; it does not return `pass: false`.** "This is not a `Result`" is a usage error, not an assertion outcome, and the distinction is load-bearing under `.not` — a `pass: false` would make `expect(42).not.toBeOk()` *succeed*, reporting green about a subject the matcher never understood. A throw fails in both directions. That subject renders through the plain payload renderer rather than the diagnostic one, because the string is a *sentence* about something that is by definition not a `Result`.
6. **The payload matchers are deep equality, not subset matching, and symmetric.** One semantic to remember rather than two. Partial matching is Vitest's own job — asymmetric matchers resolve through `this.equals`, so `toBeErrWith(expect.objectContaining({ type: 'not_found' }))` works without a third semantic. Their `Result`-ness check asks only for a boolean `ok`, per §2's brandless union — and so admits two subjects a stricter guard would reject. One has **no `value` key**, because `ok()` round-trips to `{ ok: true }` and §2.1 promises that is still usable. The other is **callable**: a function carrying `ok: true` is structurally an `Ok` and tsc assigns it, so a guard rejecting it would be narrower than the type it gates — the same widening §10.9 applied to `isTypedError` after the `typeof x !== 'object'` form silently rejected a valid callable.

**The subpath ships no way to write `Result` code** — matchers only. That is why §7.1's "exactly three entrypoints" could grow a fourth without reopening its own rule: what that clause defends is the ban on deep-path hacks and on *category* subpaths carving the core API into `/transforms` and friends, and this is neither.

## 7. Packaging

Source: [ADR 0006](../adr/0006-v2-package-layout-entrypoints.md).

### 7.1 Format, entrypoints, floors

- **ESM-only.** No CJS output, no `.cjs`, no split type files. A CJS consumer reaches 5.0.0 via `require(esm)` (guaranteed by the Node floor) or dynamic `import()`. Consequence: a **single `.d.ts` per entry**, and the "masquerading types" dual-package hazard **cannot occur**.
- **Exactly three entrypoints:** `.` (flat, self-tree-shakable barrel — all 37 functions + the 13 public types) · `./fluent` · `./package.json`. The v1 `./core`, `./fp-ts`, `./nest` are **all removed**. No `/esm` deep-path hack. No category subpaths.

  > **Amended by [ADR 0014 §1](../adr/0014-peer-dependency-policy-and-lint-package-layout.md), shipped in [#63](https://github.com/alifaroo-q/result-kit/issues/63) (2026-08-05): there is now a fourth, `./testing`.** Recorded rather than silently edited, because the count was load-bearing prose and a reader who remembers "exactly three" should find out why it changed. It is specified in **§6.4** as of [#96](https://github.com/alifaroo-q/result-kit/issues/96); until then this note was the only place in the document it appeared at all.
  >
  > What the clause was defending is **not** the number — it is the two rules right after it: no deep-path hack, and no *category* subpaths carving the core API into `/transforms`, `/terminals`, and friends. Both still hold. `./testing` is neither: it is test-only sugar that ships **no** way to write `Result` code, in the same "pay for what you import" shape as `./fluent` (ADR 0001), and it is why ADR 0011's deferred Option A could land additively at all.
  >
  > The one genuinely new thing is an **optional `vitest` peer**, which §7.2's "zero-dependency, zero-peerDependency" bullet appears to forbid. ADR 0014 §0 resolves that: the promise is about the **core artifact's install footprint**, and an optional peer is never installed, so the footprint is unchanged. §7.3's guard is extended to check that on the *artifact* rather than the manifest — the shipped `dist/testing/` chunk imports no bare specifier at all.
- **`engines.node` = `>=22.12`** — raised from v1's `>=20` to align with unflagged `require(esm)`, so *every* supported Node can load the ESM-only package.
- **Emit target `ES2023`** — all native on the Node floor; no downleveling.
- **Dev toolchain: TypeScript 7 (`tsgo`)** for the 8–12× typecheck speedup. ~~**Caveat:** TS 7 does not yet expose a stable programmatic API (promised for 7.1), so tools embedding the compiler API — notably **`attw`** — may need to pin the TS 6 line. This does not affect emit.~~ — **Caveat closed by [#21](https://github.com/alifaroo-q/result-kit/issues/21) (2026-07-16); do not re-investigate.** `typescript@7.0.2` landed with **no TS 6 fallback and no `attw` pin**. `@arethetypeswrong/core` hard-pins its own `typescript@5.6.1-rc` as a *regular dependency* and resolves it nested, so it never loads the project's TypeScript and cannot break on the jump. `.d.ts` generation via `rolldown-plugin-dts` also works (it warns that the 7.0 API is experimental, but emits correctly). The real constraint turned out to be **tsdown's peer range** — `0.21.4` declares `typescript: "^5.0.0"`, which TS 7 violates; `0.22.8` widens it to `"^5.0.0 || ^6.0.0 || ^7.0.0"`. The tsdown upgrade is what enabled the jump. `tsc`'s binary name is unchanged, so `pnpm check` needed no edit — "tsgo" was the name of the *preview* package (`@typescript/native-preview`), superseded by `typescript@7`.
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
- **`exports` is hand-authored, not generated — established by [#21](https://github.com/alifaroo-q/result-kit/issues/21) (2026-07-16).** [`tsdown.config.ts`](../../tsdown.config.ts) sets `exports: false`, because tsdown's generator **cannot express the block above**: it collapses `"."` to a bare string (losing the mandated types-first branch), and it offers no way to keep `module` without also emitting `main` — verified empirically, `exports.legacy: true` produces `"main": "./dist/index.js"`, the exact hazard this section forbids. `publint` + `attw` still validate the hand-written result on every build. **Consequence for [#28](https://github.com/alifaroo-q/result-kit/issues/28):** adding `./fluent` means hand-editing `exports` alongside `tsdown.config.ts` — which satisfies the update-together rule, it just is not automated. Do not "fix" this by re-enabling `exports: true`; that silently reverts the types-first branch.

### 7.3 The fluent-boundary guard (mandatory)

ADR 0001's headline differentiator — a tree-shakable core neverthrow structurally cannot offer — survives **only** if the root `.` bundle never contains the fluent wrapper. The rule is: *`/fluent` imports only the core functions it delegates to; the barrel never re-exports the wrapper.*

**Prose is not sufficient.** The execution effort **must** add an automated guard that fails loudly on regression — either a **size budget** on the built `.` entry, or a **test importing only from `.` that asserts `ResultChain` / `ResultAsync` are absent from the built chunk**. This is over and above `publint`/`attw`, which check resolution, not bundle contents. Extend it to cover `safeTry`/`safeUnwrap` too.

This guard is the single most important piece of infrastructure in the spec: it is the only thing standing between the design and a silent regression that erases the differentiator the whole rework is built on.

> **Built in [#28](https://github.com/alifaroo-q/result-kit/issues/28) (2026-07-17) — and the implementation this section suggests is, on its own, insufficient.** Recorded because the gap is in the *guard*, and a guard with a blind spot is the one thing here worse than no guard.
>
> "A test importing only from `.`" can only see what the root **exports**. The regression that actually erases the differentiator is *wrapper code that ships without being exported* — a core module referencing `ResultChain` for any reason pulls the class body into the root's chunk graph, where every consumer downloads it while the public surface still looks clean. An import-based test passes that scenario green. **Verified, not theorised:** `test/fluent/boundary.spec.ts` is checked against both leaks, and the behavioural half is blind to the second one exactly as described.
>
> So the guard ships with **two independent mechanisms**, and both must hold:
>
> 1. **Structural** — the transitive chunk closure of the built root entry must be fed by no source under `src/fluent/`, read from **sourcemaps**. This sees unexported dead weight, and it is immune to prose: `dist/index.js` legitimately mentions `/fluent` in JSDoc today, so a naive text grep would false-positive, and a false-positive guard is one somebody disables.
> 2. **Behavioural** — importing only from `.`, no export may be or produce a wrapper. This needs no sourcemaps, so it survives mechanism 1 being defeated.
>
> Three implementation notes worth keeping, each of which was a way to ship a vacuously-green guard:
>
> - **It builds in `beforeAll`.** The guard is a claim about `dist/`, so reading whatever `dist/` happens to be lying around reports green about a stale bundle.
> - **A missing sourcemap throws** rather than skipping. Turning off `sourcemap` would otherwise silently disable mechanism 1.
> - **It carries a positive control** — an assertion that the detector *does* find the wrapper in the `/fluent` bundle. Without it, every "the wrapper is absent" test passes identically against a detector that cannot see a wrapper anywhere.
>
> The general point, which §10.6's closing note already made from a different direction: **a guard is code, and untested code does not work.** The question "would this fail if the thing it guards regressed?" has an answer, and it is cheap to go get.

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

`package.json` currently declares the burned `1.2.0`, so a `major` changeset would compute `2.0.0` and `changeset publish` would fail. Therefore:

> **Observed, not predicted (2026-07-18, during [#32](https://github.com/alifaroo-q/result-kit/issues/32)).** This section said the failure would be a **403**. It is an **E400** — `Cannot publish over previously published version "1.2.0"` — seen on every push to `main` since the rework began, because `changeset publish` reads npm's `versions` list, does not find the burned `1.2.0` there, and concludes it is unpublished. The registry disagrees, since `time` still records it. The verdict is unchanged and the mechanism is exactly as described; only the status code was wrong. Recorded because this document's own §10 rule is to cite the observation rather than the expectation.

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

   The row above collapses two different things into one cut: the `ResultPipeline` / `AsyncResultPipeline` **classes**, and the `pipe` **composition helper**. Only the classes were cut on wrapper-machinery grounds — a bare variadic `pipe` was later evaluated on its own merits and declined too, along with `flow` and `dual`. See [ADR 0016](../adr/0016-declining-root-pipe-flow-dual.md); do not re-open without re-opening `dual` first.
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

- [x] **`safeTry` / `safeUnwrap` (§5.7)** — **done ([#23](https://github.com/alifaroo-q/result-kit/issues/23), 2026-07-16).** Types as specified; no escalation. The yield/next plumbing is resolved in §5.7's implementation note — read it before touching `src/core/do-notation.ts`, because the naive signature compiles and is wrong. One upstream caveat recorded there, which the §3 `TypedError` convention cannot hit.
- [x] **The §5.2 transform overloads** — **done ([#24](https://github.com/alifaroo-q/result-kit/issues/24), 2026-07-16).** Acceptance met: `andThen(fetchUser(id), validate)` infers `Promise<Result<User, NotFound | Forbidden>>`. Two amendments came out of it, both in §10.6 and both invisible at runtime: the promise arm takes `PromiseLike`, and §5.2's arm *order* must be inverted in code. Read the note at the top of `src/core/transforms.ts` before touching the overloads — as with §5.7, the naive transcription compiles and is wrong.

### 9.3 Core (`src/core/` → root barrel)

- [ ] `Ok<T>` / `Err<E>` / `Result<T, E>` (§2) — rename from `Success`/`Failure`.
- [ ] `ok` / `err` / `isOk` / `isErr` (§5.1) with narrow returns and type predicates.
- [x] `TypedError` + `defineError` + `ErrorCtor` (§3) — **done.** The prototype it was ported from is deleted, as planned; the verdict lives in ADR 0002 §4.
- [x] `isTypedError` (§5.1) — **done**; `TypedErrorOf` / `TypedErrorUnion` cut.
- [x] Transforms (§5.2) — **done ([#24](https://github.com/alifaroo-q/result-kit/issues/24))**; terminals (§5.3) — **done ([#25](https://github.com/alifaroo-q/result-kit/issues/25))**; collections (§5.4) — **done ([#26](https://github.com/alifaroo-q/result-kit/issues/26))**; interop (§5.5) and async constructors (§5.6) — **done ([#27](https://github.com/alifaroo-q/result-kit/issues/27))**, both in `src/core/interop.ts`.
- [x] `OkTypeOf` / `ErrTypeOf` (§5.8) — **done ([#26](https://github.com/alifaroo-q/result-kit/issues/26))**; they live in `src/core/result.ts` beside the `Ok` / `Err` they destructure, not in `collections.ts` — §5.4 tags *why they exist*, not where.
- [ ] Assert the §2.1 JSON round-trip guarantee in tests.

### 9.4 `/fluent`

- [x] `ResultChain<T, E>` (§6.1) — **done ([#28](https://github.com/alifaroo-q/result-kit/issues/28))**; delegating only, **no reimplemented logic**. The async-callback arms of `.map` / `.andThen` (returning `ResultAsync`) land with #29.
- [x] `ResultAsync<T, E>` (§6.2, [ADR 0009](../adr/0009-v2-resultasync-surface.md)) — **done ([#29](https://github.com/alifaroo-q/result-kit/issues/29))**: `implements PromiseLike`; five Promise-lifted terminals with **sync** handlers; **no** `isOk`/`isErr`. The `ResultChain`→`ResultAsync` seam (an async callback crossing over) landed with it.
- [ ] `/fluent` `ok` / `err` / `from` — **done ([#28](https://github.com/alifaroo-q/result-kit/issues/28))**; `fromPromise` / `fromThrowableAsync` / `ResultAsync` — **done ([#29](https://github.com/alifaroo-q/result-kit/issues/29))**; `safeTry` (§6.3) with #30. Six of §6.3's seven values ship.
- [ ] `[Symbol.iterator]` on `ResultChain`; `[Symbol.asyncIterator]` on `ResultAsync`.
- [x] Test: `await` on `ResultAsync` is **lossless** — `await ra` ≡ `await ra.toResult()` — **done ([#29](https://github.com/alifaroo-q/result-kit/issues/29))**, both branches.
- [x] Test: `ResultAsync.toJSON()` throws with an actionable message (§6.2) — **done ([#29](https://github.com/alifaroo-q/result-kit/issues/29))**; `JSON.stringify(ra)` throws rather than silently emitting `{}`.
- [ ] Test: `yield* resultAsync` works inside a `/fluent` async `safeTry` (§6.2, §6.3).

### 9.5 Packaging

- [x] [`tsdown.config.ts`](../../tsdown.config.ts) + `exports` **together** (§7.2): two entries, ESM-only, `target: ES2023` — **done ([#28](https://github.com/alifaroo-q/result-kit/issues/28))**.
- [ ] `package.json` per §7.2; `engines.node >=22.12`; drop `"main"`.
- [x] **The §7.3 fluent-boundary guard.** Not optional. **Done ([#28](https://github.com/alifaroo-q/result-kit/issues/28))** — `test/fluent/boundary.spec.ts`, two independent mechanisms, proven red against two distinct leaks. See §7.3's note: the implementation this spec suggested is insufficient alone.
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

Found while building §5.2 ([#24](https://github.com/alifaroo-q/result-kit/issues/24)) — the fifth seam, and the first surfaced by neither consolidation nor ticketing but by **writing the code**. §10.5 predicted the pattern; here it is again one rung down.

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

~~**Known debt:** `safeUnwrap` (§5.7, shipped in [#23](https://github.com/alifaroo-q/result-kit/issues/23)) branches on `instanceof Promise` and has the identical cross-realm hole — `safeUnwrap(foreignPromise)` takes the sync branch and yields a malformed `Err`. Out of #24's scope; raised on [#28](https://github.com/alifaroo-q/result-kit/issues/28).~~ — **Debt discharged by [#28](https://github.com/alifaroo-q/result-kit/issues/28) (2026-07-17).** `safeUnwrap`'s async overload now takes `PromiseLike<Result<T, E>>` and detects a thenable. Note this was **not** about `yield* resultAsync`, which routes through §6.2's own `[Symbol.asyncIterator]` and never reaches `safeUnwrap`.

> **And the debt was undercounted — `safeTry` had it too.** Found while discharging the above: this note named only `safeUnwrap`, but `safeTry`'s own implementation branched `body().next() instanceof Promise` on the identical rule. `body` is the **caller's** generator, so an `async function*` born in another realm returns a foreign promise from `.next()`; `instanceof` disowned it, `safeTry` took the sync branch, read `.value` off a promise, and **returned `undefined` where its signature promises `Promise<Result<T, E>>`**. Verified against a real cross-realm generator before fixing, and pinned by a regression test that fails against the old check.
>
> Both are fixed, and `isThenable` now lives in `src/core/thenable.ts` with exactly one definition — §10.6 makes *the check* the decision, so three copies of it was two too many.
>
> The general lesson, which §10.6 already earned once from the other direction: **an erratum's blast radius is a claim, not an observation.** This note asserted a scope ("`safeUnwrap` has the identical hole") that nobody had gone and measured, and it was wrong by one function in a two-function module. When recording that a bug class exists, grep the class.

### 10.7 The mixed value-or-promise callback is rejected; the non-promise thenable is documented — **decided (2026-07-18, at retro)**

Found in a retro of #26–#29 ([#36](https://github.com/alifaroo-q/result-kit/issues/36)), both reproduced against `src` and a fresh `dist` before being written down. Neither defect is in that range's new code — both live in §5.2 and in §10.6's check — but they freeze into the API at 5.0.0 and one fix is signature-level, so deferring was breaking.

**One root cause, not two.** §10.6 widened the runtime check to `typeof x?.then === 'function'`, and **that decision stands.** But the check is strictly *broader* than TypeScript's static notion of awaitable, and §10.6 never reconciled the two. Every value in that gap is typed one way and executed the other.

**The mixed callback — rejected at compile time.** A callback returning `U | Promise<U>` matched §5.2's *sync* arm with `U` = the whole union:

```ts
const lookup = (id: number) => cache.get(id) ?? fetchName(id);  // string | Promise<string>
map(ok(7), lookup);
// tsc:     Result<string | Promise<string>, unknown>   ← a settled Result
// runtime: a Promise on a cache miss  →  .ok undefined  →  err branch silently taken
```

Data-dependent, so the same call site is correct on a cache hit and silently wrong on a miss — §10.6's own signature failure, *a wrong value with a confident type and no throw*. It also contradicted `transforms.ts`'s documented invariant that the arms are mutually exclusive: true for purely-sync and purely-async callbacks, and a union callback is neither. Only `map` / `mapErr` / `inspect` / `inspectErr` were affected; `andThen`, `orElse`, and `safeUnwrap` demand a `Result` on their sync arm and always rejected the union loudly. **Half the surface said no; half lied quietly.** The four now agree, via a `NoMixedThenable<U>` rest parameter in `src/core/thenable.ts`, mirrored on `ResultChain`.

The encoding matters and is the reason this needed design rather than a patch. `U extends PromiseLike<unknown> ? never : U` on the *parameter* does not work — a conditional type is not an inference site, so `U` collapses to `unknown` and every call site degrades. Spreading the conditional as a **rest parameter** keeps `U` in a naked inference position and evaluates the check only after `U` is known: when `U` holds no thenable it reduces to `[]` and the resolved signature is byte-identical, so correct code pays nothing. The *promise-input* arms deliberately still accept the union — §5.2 grants them that shape and the returned promise flattens it — though their value type is now `Awaited<U>`, which is what they always returned.

- **Rejected — type it honestly** as `Result<Awaited<U>, E> | Promise<Result<Awaited<U>, E>>`. Truthful, since the outcome genuinely is data-dependent, and nothing that compiles today stops compiling. But it pushes a union onto every affected call site and exports the confusion rather than resolving it, while the loud rejection has an obvious fix: mark the callback `async`.
- **Rejected — narrow the runtime check to match TypeScript's notion.** Reopens §10.6's cross-realm hole. See below for why it is worse than it looks.

**The non-promise thenable — documented, not fixed.** An object with a callable `then` that never invokes its callback (`{ tag: 'builder', then(next) { return this } }` — a workflow builder, not a promise) is assimilated by `Promise.resolve` and **deadlocks permanently**. TypeScript does not consider it awaitable, because its `then` returns no `PromiseLike`.

**This is inherited from the language, not chosen.** `PromiseResolveThenableJob` branches on exactly one condition, `IsCallable(thenAction)`, so plain `await builder` hangs identically with no library involved. And it is **not fixable here**, for a reason specific to this package: every technique that excludes the builder — `util.types.isPromise`, `Object.prototype.toString`, a `Promise.prototype.then` brand probe — is a check for a **native** promise, and `ResultAsync` (§6.2) is not one. It is a hand-written class that `implements PromiseLike`. Each of those checks returns `false` for this package's own headline type, reintroducing §10.6's exact failure on the most common path there is: **a rare third-party false positive traded for a guaranteed false negative on our own surface.** Detecting the hang instead is undecidable — a legitimately slow thenable and a never-calling one are observationally identical at every finite observation time, so any timeout is a policy that eventually cancels valid work. Surveyed for this decision: effect, RxJS, zod, `@praha/byethrow`, `is-promise`, `p-is-promise`, Bluebird, neverthrow, fp-ts, core-js, promise-polyfill. **No consumer gates on a native brand.** But the first draft of this section also claimed none of them attempts to exclude a non-promise thenable, and **that was wrong**: `@praha/byethrow`, effect's `isPromise`, `p-is-promise`, and zod's data classifier all require **`then` *and* `catch`**, which would exclude the builder. That option is therefore live, and is declined on the same ground as the brand checks — `ResultAsync` implements `PromiseLike`, which is `then` alone, so requiring `catch` disowns our own type unless §6.2 grows one. Recorded as an open option in §10.8 rather than silently dropped.

The blast radius is narrow: `isThenable` is never applied to arbitrary user data, only to a `Result`-typed input or the return of a user callback. `test/core/thenable.spec.ts` pins the *decision* rather than the deadlock — a test that waited on the hang could only observe a timeout, which is the same undecidability that makes it unfixable.

- **Not escalated to an ADR.** Reverses no decision and corrects no misreading of one — §10.6's check is reaffirmed, and §5.2's shapes are unchanged. This closes a gap between the runtime check and the static types that the spec never reconciled. That is an erratum.
- **A note on the retro that found it.** §10.6 closed by observing that the pass which asks "was that actually right?" has no ticket, and that **green is not the end of the loop.** This section exists because someone ran that pass anyway. Both defects predate #26–#29 and survived the building, the tests, and the type-level assertions — the union callback had *zero* test coverage, because §5.2 never specified that shape as accepted and so nobody thought to write one. **Untested is not the same as unreachable**, and `cache.get(id) ?? fetch(id)` is ordinary code.

### 10.8 §10.6 re-examined before the freeze — **check widened, asymmetry upheld (2026-07-18)**

§10.7 closed by noting that retro has no ticket. This section is a second one, run deliberately on §10.6 itself because 5.0.0 freezes the API permanently and §10.6 had already shipped one wrong-but-decisive argument (see the note at the end of §10.6). Three questions were put to primary sources — ECMA-262, Promises/A+, and the current source of eleven libraries — and instrumented on Node 24.

**1. `isThenable` widened to accept a callable thenable — a real bug, fixed.** The check tested `typeof x === 'object'`, so a *function* carrying a `then` was disowned. The language assimilates it and Promises/A+ says "if `x` is an object **or function**"; verified: `await callable` unwraps, while `map(ok(1), () => callable)` returned a **synchronous** `Ok` wrapping the raw function — typed `Result<string>`, actually holding a `Function`. **That is §10.6's own failure mode re-entering through a different door**, which is precisely what §10.6's closing note warned to go looking for. One clause, no new obligation. Pinned in `test/core/thenable.spec.ts`.

**2. Reading `then` once through `try`/`catch` (Promises/A+ 2.3.3.1) — rejected, and it is *regressive*.** The intuition is that capturing `then` removes a TOCTOU window. It does not, because every call site then hands the value to `Promise.resolve`, which reads `then` **again**: `PromiseResolve` short-circuits only when `IsPromise` holds *and* `Get(resolution, "constructor")` is `SameValue` as the constructor, so a userland `PromiseLike` always falls through to `CreateResolvingFunctions`' `Get(resolution, "then")`. Instrumented read counts confirm it — userland `PromiseLike`: **2 reads**; same-realm native promise: 1; **cross-realm promise: 2** (its `constructor` is the *other* realm's `Promise`, so `SameValue` fails and `Promise.resolve(foreign) !== foreign`). Capturing therefore buys exactly one thing — no synchronous throw escaping `map` — and **pays for it with the failure this spec exists to prevent**: a throwing getter would make the captured `then` `undefined`, the value would read as not-thenable, and `map` would silently return `ok(hostileObject)`. §10.6's own words are "a wrong value with a confident type." Trading a loud throw for that is a step backwards.

**3. Invoking the captured `then` directly — rejected, on scope.** It is the only variant that delivers read-once (verified: 1 read), but bypassing `Promise.resolve` means implementing the resolution procedure ourselves: first-call-wins latching, throw-after-settle, recursive unwrapping, realm handling. That converts this package from a thenable **consumer** into a Promises/A+ **implementer**, permanently, in a frozen zero-dependency library — a large irreversible obligation bought to defend against a hostile accessor on a value the user's own callback returned. **The implement-vs-consume split is the whole answer**, and it is 9-for-9 in the survey: Bluebird, core-js, and promise-polyfill do the careful read and *implement* promises; no consumer does. A+ is scoped "by implementers, for implementers", and 2.3.3.2's remedy — "reject promise with `e`" — has no subject when you are not implementing one. **The clause does not bind us.** Classification: the synchronous throw is a genuine if exotic contract violation; the TOCTOU is pedantry; neither is a security issue, since the inspected value is the user's own callback return, in-process, same trust domain.

**4. The §10.6 asymmetry — upheld, and it is the direction nobody else got right.** "Accept `PromiseLike`, return `Promise`" is Postel's law with both halves honest: the input takes the weaker requirement, the output makes the stronger promise, and the stronger promise is not a lie because `Promise.resolve` genuinely produces a native promise on every path, cross-realm included. Type-probed against the real source under `--strict`: both input forms accept, the output supports `.catch`/`.finally`, feeds back into `map`, and widens to `PromiseLike` for consumers. No `.d.ts` friction. **neverthrow is the only other promise-in/promise-out case and goes the opposite way** — `PromiseLike` in, `PromiseLike` **out** — discarding the native promise it actually produced, so `.catch`/`.finally` on its `ResultAsync` are type errors that work at runtime. The dangerous asymmetry is the reverse one, and we do not have it. Everyone else leaves the promise world entirely (RxJS → `Observable`, effect → `Effect`) or is `Promise`-on-both-sides (fp-ts, byethrow, zod).

**5. Require `then` *and* `catch` — examined and closed, and the reason is general.** Raised because four surveyed libraries do exactly this, and it would exclude §10.7's builder. **Rejected: it reintroduces §10.6's bug.**

The rule it violates is worth stating on its own, because it is the invariant this whole section keeps circling: **the runtime check must never be narrower than the published type.** `PromiseLike<T>` in TypeScript's own `lib.es5.d.ts` has exactly one member — `then`. So every signature in §5.2 that accepts `PromiseLike` is a published promise to handle a `then`-only thenable. A check requiring `catch` breaks that promise, and it breaks it *silently*:

```ts
const minimal = { then(r) { r(42) } };   // a PromiseLike<number>, and `await` unwraps it
map(ok(1), () => minimal);
// tsc:     Promise<Result<number, E>>   ← the async arm matched, PromiseLike<U>
// runtime: a SYNC Result whose .value is the raw thenable
```

Verified by building `dist` with the `catch` clause in place. §10.6's failure mode exactly, and this time caused by a check that is *too narrow* rather than too broad.

**`ResultAsync` was never the real objection** — an earlier draft of this bullet said it was, and said the fix was therefore additive later via a `catch` on §6.2. **That was wrong twice over.** `ResultAsync` is merely the most visible `then`-only thenable; giving it a `catch` would fix nothing, because every *other* minimal `PromiseLike` still breaks. The defect is in the relationship between the check and the signature, not in any one type.

This also explains the four libraries cleanly, and dissolves the apparent disagreement: `@praha/byethrow`, zod, and `p-is-promise` publish **`Promise`** in their types, and every real `Promise` has a `catch` — their check matches their signature. Ours accepts `PromiseLike`, so ours must not. **They are not doing something we are declining to do; they are obeying the same rule from a different starting point.** Requiring `catch` would only ever be available to us by narrowing §5.2 to `Promise`, which would re-break the cross-realm and `ResultAsync` cases §10.6 exists to serve.

§10.7's builder limitation therefore stands as documented — the option that appeared to narrow it was an illusion created by an unchecked ecosystem claim, and examining it properly produced the invariant above, which is worth more than the fix would have been.
- **Not escalated to an ADR.** §10.6's decision is reaffirmed, not reversed; one clause of its check is corrected and its rationale is re-grounded in primary sources.

### 10.9 A settled input cannot produce an asynchronous output — **decided (2026-07-18, at retro)**

§10.8 was a retro of §10.6. This is a retro of the whole async/thenable seam, run before the freeze for the reason §10.7 gave: **green is not the end of the loop.** Four independent lenses were pointed at shipped, reviewed, passing code — type-vs-runtime correspondence, do-notation, the wrapper pair, and doc-claims-vs-code. Every one of them found something, and the largest finding was in code that three prior passes had already read.

**The rule, which is the section's whole content:**

> A transform whose input is a **settled `Result`** cannot promise an **asynchronous output**.

**The "because" clause this section first attached to that rule named only one of two mechanisms**, and §10.11 corrects it. The runtime decides sync-vs-async by *inspecting values*, and on a settled input **both** inspection sites can lie: the callback may never run (fixed here), and the input may itself be thenable (fixed in §10.11). Only the first was addressed, while the prose asserted soundness for both.

**1. The async-callback arm could not keep its promise (silent, worst of the set).** `map`/`mapErr`/`andThen`/`orElse`/`inspect`/`inspectErr` each had an arm taking a settled `Result` plus an async callback and returning `Promise<Result<…>>`. But the runtime decides sync-vs-async by *inspecting what the callback returned*, and on the short-circuit branch the callback never runs:

```ts
ferr('boom').map(async (v) => v)   // tsc: ResultAsync   runtime: ResultChain
map(err('boom'), asyncFn)          // tsc: Promise<Result>   runtime: a plain Result
```

Awaiting a non-thenable yields the object itself, so the fluent case handed back the **wrapper**: `.ok` read `undefined`, `.error` read `undefined`, and a success was reported as a failure. The core case is milder — `await` masks it — but `.then`/`.catch`/`.finally`, all legal on the published type, throw `TypeError` on the error branch. Data-dependent, so the same call site is correct on one branch and silently wrong on the other. §10.6's signature failure, one rung up.

**No arm ordering fixes this, and no runtime check can — for *this* mechanism.** (§10.9 originally wrote the rule as though the callback-never-runs case were the only one. It is not; see §10.11 for the second, which *is* fixable by a runtime check.) The information does not exist: `fn.constructor.name === 'AsyncFunction'` catches `async v => …` but not `v => api.get(v)`, and a partial fix makes the residue rarer and correspondingly harder to find. **All twelve arms are removed.** Async work now starts from a promise — `map(Promise.resolve(r), fn)` in the core, and a new **`ResultChain.toAsync()`** on the fluent surface — where the output is a promise on *every* branch. `NoMixedThenable` is renamed **`NoThenableReturn`** and now rejects any thenable-returning callback on a settled input, which is what catches these calls.

The wrapper got *simpler*: each member collapsed from an overload pair to one signature. **This section also deleted `wrap()`, calling it "the defect" and the result "true by construction rather than by detection". Both claims were wrong, and §10.11 reverses them** — see there. The async-callback *arm* was the defect; `wrap()` was the mitigation for a different hole this section left open.

- **Rejected — type it honestly** as `Result | Promise<Result>` / `ResultChain | ResultAsync`. Truthful and removes no capability, but pushes a union onto every async call site, including the ones correct today.
- **Rejected — the `AsyncFunction` heuristic.** Knowingly partial; a rarer silent bug survives testing even better than this one did.
- **What was actually lost** is the *implicit* mid-chain seam, and it never worked on the error branch. Removing a feature that worked half the time is not the same as removing a feature.

**2. `isTypedError` and `ErrorCtor.is` (silent).** `isTypedError` gated on `typeof x !== 'object'`, so a **callable** carrying `type` and `message` — structurally a valid `TypedError`, assigned by tsc without complaint — was rejected. `unwrapOrThrow` consumes that guard, so it silently replaced the error's real message with the generic fallback. The identical `typeof` narrowing §10.8 fixed in `isThenable`; the second instance was missed because the erratum did not grep the class. **§10.6's lesson, unlearned twice now.** Separately, `.is()` checked only the tag while narrowing to `TypedError`, whose `message: string` is required — so a tag-only object passed and left `.message` `undefined` under a type asserting `string`. Both fixed; the payload disclaimer stands, since `message` is not payload.

**3. `safeTry` stranded the generator (silent resource leak).** The short-circuit suspends the body at its first `yield` and never resumed it, so `finally` blocks never ran — cleanup executed on the **success** path and was skipped on the **error** path, which is the path cleanup exists for. `.return()` now closes it. The async generator needed more than the sync one: its `.return()` is itself async, so the result must `await` it or the `finally` runs *after* the caller's promise settles — the same leak one turn later.

**4. `safeTry`'s return channel lost its union (loud).** The *yield* slot is a naked `Y` precisely so a union of `Err`s survives inference (implementation note 1). The *return* slot was `Result<T, E>` — not naked — so two distinct `return err(...)` exits gave `E` two candidates and the call failed to resolve at all. ADR 0007 §6 explicitly blesses a deliberate early `return err(...)`, and several of them is the ordinary shape; the existing test only ever used one. Now a naked `R`, decomposed by `ValueOf`/`ErrorOf`. The `never` defaults became **unnecessary rather than relocated**: `ErrorOf<Ok<T>>` derives `never` instead of asserting it.

**5. The tee arms and the promise parameters were narrower than their own implementations (loud).** `ResultAsync.inspect`/`inspectErr` took `void | Promise<void>`, so even `arr.push(u)` was rejected — the void-return rule does not fire for a union containing `void` — while the core's arms had always taken `unknown`. And `fromPromise` / `ResultAsync.from` demanded a full `Promise` while §5.2 takes `PromiseLike` throughout; the second pointed at itself, since **`ResultAsync` implements `PromiseLike`, so `ResultAsync.from(ra)` failed to compile while working at runtime.** All widened. Pure widenings — every `Promise` is a `PromiseLike` — so no call site is lost.

**6. `NoThenableReturn` false-positived on `any`.** `Extract<any, PromiseLike<unknown>>` is not `never`: a conditional over `any` takes both branches, so it reduces to `PromiseLike<unknown>` and the guard fired on **every** callback returning `any` — untyped JS callbacks, `vi.fn()` mocks, anything crossing an untyped boundary. Found only by running the change against the existing suite. An `IsAny` carve-out fixes it. Worth recording because the bug was in §10.7's guard as originally shipped, and would have frozen either way.

**Doc claims refuted by this retro**, all corrected in place:

- *"the check cannot misfire on the union"* (§10.6 and `thenable.ts`) — **false.** §2's purely-structural no-brand union means any `{ ok, value }` **is** an `Ok<T>`, including one carrying a `then`. Verified: `map(sneakyResult, syncFn)` deadlocks via the **input** path, with a purely synchronous callback. The no-brand invariant is precisely what makes the misfire possible, so the sentence was not merely wrong but backwards.
- *"no consumer can reach this"* (`ResultChain`'s constructor) — **false.** The type-only export hides the name; it does not gate the runtime. `new (ok(1).constructor)(…)` forges a working instance.
- *§2.1's "structurally-identical" JSON round-trip* — **overstated.** `ok()`, the form §5.1 recommends, round-trips to a one-field object, violating §2's "exactly two fields per half". Consumable, not identical; an undocumented third carve-out.
- *§7.3's "this guard reads `dist/`, not `src/`"* — **half true**, and now fixed (§10.12). Only the structural mechanism read `dist/`; all five behavioural assertions imported from `src/`, so they were blind to a packaging regression — the exact class of bug `CLAUDE.md` records for the missed `paths` entry. They now run against **both** trees.
- *`isThenable` has "two callers"* — **three**, since #28 added `wrap()`. Now two again, because §10.9 deleted `wrap()`.

**Cleared, and worth recording as covered:** collections (empty/sparse/non-array), `result.ts`, `fromNullable`/`fromPredicate`/`fromThrowable`/`fromThrowableAsync`, every documented identity claim (10/10 by `Object.is`), ADR 0009's full `ResultAsync` contract, error propagation across both wrappers, and §7.3's structural guard including its positive control.

- **Not escalated to an ADR.** No decision is reversed: ADR 0005's "input drives output" is *upheld*, and this is what it actually entails — a settled input drives a settled output, always. ADR 0007's do-notation semantics are unchanged; §5.7's signatures now deliver what they always described.

### 10.10 `E` defaults to `never` where a narrow half gives it no inference site — **decided (2026-07-18, at retro)**

Filed as [#37](https://github.com/alifaroo-q/result-kit/issues/37) out of the same retro that produced §10.7, deferred as low-severity, and picked up before the freeze because it traces to a **signature** decision.

§5.1 returns the narrow `Ok<T>` deliberately. `Ok<T>` has no `Err` member, so it offers `E` **no inference site**, and `E` fell back to `unknown`:

```ts
const withCtx: Result<number, MyErr> = map(ok(1), (v) => v + 1);  // fine — context supplies E
const noCtx = map(ok(1), (v) => v + 1);                            // Result<number, unknown>
use(noCtx);                                                        // TS2345 — assigns nowhere
```

The papercut is the **un-annotated intermediate binding**; the annotated shape always worked, which is why it went unnoticed. `E` now defaults to `never` — the honest answer, since a value built by `ok(1)` genuinely has no error channel, and `Result<T, never>` assigns into every `Result<T, E>`.

**A default fires exactly when inference finds no candidate**, which is the §5.3 `UErr` precedent and the mechanism §5.7 used before §10.9 made it unnecessary there. The risk is that it *masks* a real inference failure, so that was checked directly rather than assumed: a transform over a genuine `Result<T, A>` still infers `A`, and `andThen` still accumulates `A | B`. **Assignability alone cannot prove this** — `Result<T, never>` assigns into every `Result<T, E>`, which is precisely what masking would hide behind — so the check uses exact-type assertions, not assignment.

**The blast radius was wider than the ticket**, which named only §5.2. Applying §10.6's lesson rather than restating it — *grep the class* — `E` reaches a user-visible position in four more places, each with the same fallback: `match` and `unwrapOrElse` (handler parameter typed `unknown`), `partition` (`E[]` in the output), and `safeUnwrap`, which propagated `unknown` through `safeTry` so a whole do-notation block over a bare `ok()` assigned nowhere. All defaulted. `unwrapOr` and `unwrapOrElse` were checked and left alone: `E` is input-only there, and `T` is supplied by the fallback or the recovery callback. **`combine` was also left alone, and §10.10 first recorded a false reason for it** — "E is input-only there and never surfaces" is wrong, as `combine([ok(1), err('E1')])` is `Result<[number, never], 'E1'>`. The verdict survives for a different reason: `combine` has no `E` parameter at all. Its error channel is *derived* through `ErrTypeOf<T[number]>`, which reduces to `never` with no inference site that can fail. A right answer with a wrong rationale is the failure mode §10.6 recorded; this is that failure, caught by review rather than by the next erratum.

**§5.1's note is corrected, not its decision.** It read: *"strictly more precise, and it still assigns into any `Result<T, E>` annotation."* Both clauses are true of `ok(1)` **itself**; neither survived one transform. The note described a property of the *constructor* and read as a property of the *value*. Narrow returns remain the right call — the trade was real, and was recorded as costless.

- **Rejected — widen `ok` to `Result<T, never>`.** Fixes it at the source by reversing an explicit §5.1 decision, losing the `.value` access that narrow halves exist to preserve.
- **Rejected — leave the signatures and fix only the note.** The cheapest option, and it was the ticket's own first suggestion. But the default costs nothing, cannot mask (verified), and fixes the papercut rather than documenting it.
- **Not escalated to an ADR.** ADR 0003's narrow-return decision is upheld; only its recorded cost changes.

### 10.11 The guard moves to return position, and the input gets its own check — **decided (2026-07-18, at adversarial review)**

§10.9 and §10.10 were reviewed by three adversarial passes briefed to **refute rather than confirm**. They found four defects in that work, one of them a regression against the code it replaced. This section records the corrections; the findings live in [#38](https://github.com/alifaroo-q/result-kit/issues/38).

**1. The guard broke every generic wrapper — a regression.** `NoThenableReturn` spread a conditional as a **rest parameter**, which reduces only when `U` is resolved at the call site. Against an unresolved type parameter it never reduces, the guarded arm stops matching, and the call hard-errors:

```ts
function helper<A, B>(r: Result<A, string>, f: (a: A) => B) {
  return map(r, f);   // TS2769 — no overload matches
}
```

Verified as a regression against the arms that predate the guard, with **no escape**, since `NoThenableReturn` was not exported. §10.9 had already hit this wall internally — it is why `result-chain.ts` carries four `*Unguarded` casts, whose doc comment states the mechanism verbatim — and concluded it affected only internal delegation without checking whether consumers' generic code hit the same wall.

**2. Its `any` carve-out reopened the hole it was closing.** A conditional over `any` takes both branches, so `Extract<any, PromiseLike<unknown>>` is not `never` and the guard fired on every `any`-returning callback — untyped JS callbacks, `vi.fn()` mocks. The `IsAny` carve-out added to fix that then let an `any`-returning callback claim a settled `Result` while the runtime handed back a promise, `.ok` reading `undefined`. **A guard simultaneously too strict and too permissive is the wrong mechanism, not a mistuned one.**

**The check therefore moves to *return* position** (`SettledOr<U, R>`). It defers harmlessly for a generic `U`, resolves once `U` is known, and needs no `any` case — `any` lands in the honest branch and gets the union it deserves. Where `U` holds no thenable it **is** the plain `Result<U, E>`, so synchronous code is untouched. The cost is that a mixed or async callback is now *typed honestly* rather than *rejected*, softening §10.9's decision — and the ergonomic price is far lower than §10.9 assumed, because `await` collapses the union to the settled `Result`, which is what async code writes anyway.

**3. `wrap()`'s deletion was a net regression, and "true by construction" was false.** §10.9 claimed the wrapper could no longer produce a promise. It could, through the input: §2's brandless union means a structurally valid `{ ok: true, value }` may also carry a `then`, and `isThenable` assimilates it. The guard covered the *callback return*; **nothing covered the input**. Reproduced on all six members of both surfaces — `.toResult()` returning a `Promise` typed as a settled `Result`. `wrap()` had been the only thing coping with it, turning that case into a mistyped-but-coherent `ResultAsync`; deleting it produced a promise hidden inside a `ResultChain` instead. It is restored.

Rather than typing around it, the root cause is fixed. **`isSettledResult` asks "is this a `Result`?" before "is this thenable?"** — the two are distinguishable in the direction that matters, since a `Result` has a boolean `ok` and a promise of one does not. §10.6's cross-realm fix is untouched and re-verified: a foreign `Promise<Result>` has no `ok`, still fails the check, and still awaits. `andThen`/`orElse` therefore keep returning a plain `ResultChain`, so chaining does not pay for the edge case.

**4. §10.10's `T` channel was never done.** That section fixed `E` and claimed to cover "wherever a narrow half leaves it no inference site". `err()` returns the narrow `Err<E>`, leaving **`T`** with no inference site — the exact mirror — so `mapErr`, `inspectErr`, `orElse`, `toNullable`, `unwrapOrThrow`, `partition`, and `match` all returned `T = unknown`. Six of seven probes were defective. **The third time this cycle a stated scope was trusted instead of grepped, and the second time inside the same fix.**

Also corrected: §10.10 cleared `combine` for a **false reason** (`E` does surface in its output; it survives because `combine` has no `E` parameter at all, deriving its error channel through `ErrTypeOf<T[number]>`), and §10.7's builder example — which the parameter-position guard had made uncompilable, and which the move to return position restores.

**Three coverage gaps**, each first proven real by a mutation that left the suite green, then closed and re-proven by making that mutation fail: the `await` on the async `safeTry` release (every existing `finally` test used a synchronous body, which runs before the microtask boundary), `Awaited<U>` on the promise-input arms (a purely-async callback resolves via the separate `PromiseLike` arm and never exercises it), and `ErrorCtor.is`'s callable admission (two changes, one pinned).

- **What the review confirmed**, and it is worth recording as covered: all four §10.8 read-count claims (instrumented with `node:vm`), every ecosystem and primary-source claim, §10.10's non-masking under exact-type assertions, the 10/10 identity claims, §2.1's third carve-out, and the §7.3 and constructor-reachability corrections. On tests: **no weakened or lost assertions** across the ~35 rewritten sites, and all 18 `@ts-expect-error` directives mutation-proven load-bearing.
- **Not escalated to an ADR.** No decision reverses: §10.9's rule stands, corrected in its "because" clause and completed by a second mechanism.

**The lesson this section actually teaches** is not about thenables. §10.6 recorded that *a right answer reached by a wrong argument is a coin landing well*, and §10.9 restated it. Then §10.9 asserted "true by construction" two bullets from the refutation list that disproves it, and §10.10 asserted a scope it had not grepped. **Every erratum in §10 so far was found by the next pass, not by the one that shipped it** — and this one is the first found by a pass whose only job was to disagree. That is not a lucky catch; it is the difference between reviewing and being asked to refute.

### 10.12 The §7.3 behavioural assertions run against `dist/` too — **decided (2026-07-18)**

[#39](https://github.com/alifaroo-q/result-kit/issues/39), split out of §10.11's residual work. §7.3's guard has two mechanisms and its own note claimed the guard "reads `dist/`, not `src/`". Only the **structural** half did; all five **behavioural** assertions imported `src/`, so they proved the *source* boundary and left the *shipped* one uncovered.

Demonstrated before fixing, not argued: with a `ResultChain` export bolted onto `dist/index.js` and `src/` untouched, all five stayed green — and they stayed green against a `dist/` that did not even parse. The behavioural assertions now run against both trees via `describe.each`, and the simulation is re-run in reverse: the leak makes the `dist` pass go red, and a clean build restores it.

`src/` is **kept rather than replaced** — it fails earlier and more legibly on a source-level regression, and it does not depend on the build succeeding. The two mechanisms remain complementary in the mirror direction too: the structural half reads `dist/` through **sourcemaps**, so it is blind to anything changing the emitted bundle without changing the map, which is exactly what the hand-edited leak was.

**One blind spot is recorded rather than papered over**, since overstating this guard's coverage is what created §10.12 in the first place: the `dist` pass does not catch a bundle that fails to *link*. vitest's module runner is more permissive than Node's ESM linker, so an `export { Undefined }` appended to `dist/index.js` throws under plain `node` and imports fine under vitest. Verified, along with the converse — a marker export existing only in `dist/` **is** visible, so the pass genuinely reads the emitted file. The blind spot is acceptable: a non-linking bundle is caught by `pnpm build`, by `publint`/`attw`, and by the first consumer. The class this guard exists for is the silent one — a *valid* bundle whose contents are wrong.

- **Not escalated to an ADR.** §7.3's requirement is unchanged; its test now covers what its note already claimed.

### 10.13 The `/fluent` do-notation body returns a wrapper — **decided (2026-07-18, at build)**

[#30](https://github.com/alifaroo-q/result-kit/issues/30), the ticket that makes ADR 0007 §3's *"no `safeUnwrap` needed at `/fluent`"* true rather than aspirational. §6.3's `safeTry` sketch did not survive being implemented, and the reason is one this document has hit before in a different slot: **the signature was written from the root's vantage point and read as though it were the wrapper's.**

§6.3 spelled the body `gen: () => Generator<..., Result<T, E>>`. That is the correct shape at root. At `/fluent` it rejects the only thing a user on that surface actually writes:

```ts
import { safeTry, ok } from '@zireal/result-kit/fluent';

safeTry(function* () {
  const user = yield* findUser(id);   // ResultChain — self-iterable, the point of the ticket
  return ok(user.credit);             // ResultChain, NOT Result — TS2345 under the literal signature
});
```

`ok` / `err` are **dual constructors** (§4): same name at both entrypoints, surface-appropriate return type. So the `ok` in scope inside a `/fluent` block returns a `ResultChain`, and a signature demanding a plain `Result` at the exit is asking the user to leave the surface they are on. Both escapes are things this project has already rejected — `return ok(v).toResult()` reintroduces exactly the ceremony do-notation exists to kill, and importing root's `ok` into a `/fluent` block is the cross-entrypoint dependency [ADR 0005 §4](../adr/0005-v2-async-strategy.md) refused, pointing the same direction §10.5 refused it.

**The body therefore returns either half**, `Result<unknown, unknown> | ResultChain<unknown, unknown>`, decomposed by `/fluent`-local `ValueOf` / `ErrorOf` that take both arms. The plain half is kept rather than tolerated: the mixed case §6.3 itself calls out — root's `safeUnwrap` over a plain union inside a fluent block — genuinely leaves a plain `Result` in hand at the exit. The two arms cannot collide, because `ResultChain` carries a native-private field and so never matches `Ok`/`Err` structurally, and the plain union has no `#result`.

**`ResultAsync` needs no arm, and the first draft of this section gave a false reason for that** — caught by the adversarial pass on the same day, and recorded here rather than quietly corrected, because the *shape* of the error matters more than the error.

The true mechanism: `ResultAsync implements PromiseLike`, and an async generator's `TReturn` is awaited by **tsc and the runtime alike**. So `return someResultAsync` types as `Result<T, E>` — which `BodyReturn` already admits — and resolves to exactly that. Types and value agree, and the shape works today:

```ts
safeTry(async function* () {
  yield* asyncUser();
  return asyncScore();          // ResultAsync<number, never>
});                             // → ResultAsync<number, NotFound>, resolving to ok(42)
```

The arm `ResultChain` needs is therefore precisely the **non-thenable** case: neither side awaits a `ResultChain`, so it survives to the return slot as a wrapper and must be decomposed. The two halves of the dual constructor need opposite treatment for one reason — whether they are thenable.

**What the first draft claimed** was that tsc does *not* await `TReturn` while the runtime does, that admitting `ResultAsync` would therefore publish a type disagreeing with its value (§10.6's failure mode), and — in the same breath — that this was *"verified by prototype before deciding, not assumed."* Every clause is wrong, and the last one is why the others survived. The prototype returned a **`ResultChain`**, which is not thenable and so correctly stayed a wrapper; that result was then generalized to `ResultAsync`, which is thenable, without being re-run. The probe was real, the citation was honest, and the inference between them was never checked.

**This is §10.8's rule violated inside the erratum that cites it** — *cite the source, not the summary, including when the summary is your own and an hour old.* The summary here was an hour old and was the author's own. It also cost a real capability: users were told to write `return ok(yield* ra)` to route around a restriction that did not exist. Both assertions are now pinned by exact-type and runtime tests, so the corrected claim is guarded rather than merely restated.

Two further details were inherited rather than rediscovered, and it is worth recording that they were *checked*:

- **`Y` and `R` are naked**, carrying §5.7's implementation notes 1 and 2. A concrete spelling in either slot keeps only the first inference candidate — silently collapsing a yielded `NotFound | Forbidden`, and failing to resolve the call at all on the two-`return err(…)` shape ADR 0007 §6 blesses. Both are pinned by exact-type assertions, and both were **mutation-proven**: narrowing the expected channel makes `tsc` fail, which is the check §10.10 established is necessary, since `Result<T, never>` assigns into every `Result<T, E>` and assignability alone would hide the collapse.
- **§10.11's input check applies here too**, and it is load-bearing rather than defensive. §2's union is brandless, so a body can return a structurally valid `{ ok: true, value }` that also carries a `then` — reachable precisely through the mixed case above. Asking "is this thenable?" before "is this settled?" assimilates it, and a synchronous block returns a `ResultAsync` where the signature promised a `ResultChain`. So the fluent runner recognises the settled shapes **first** — `ResultChain` by `instanceof`, plain `Result` by its boolean `ok`. Pinned by a test that goes red under the thenable-first ordering.

Short-circuit, generator closing (§10.9's `.return()`), and union accumulation are **not reimplemented** — the fluent runner delegates to the core one, per §4 rule 2, so those hold by construction rather than by parallel maintenance.

- **Rejected — require `.toResult()` at the exit.** Honest and needs no signature change, but it puts ceremony on the hero path of the ticket whose entire purpose is removing ceremony.
- **Rejected — make `/fluent`'s `ok`/`err` return plain `Result`s inside blocks.** Not expressible, and it would break §4's dual-constructor rule to fix a signature.
- **Not escalated to an ADR.** No decision reverses: ADR 0007 §3's placement table already says the `/fluent` runner returns a wrapper, and §4's dual-constructor rule is what forces this. §6.3's signature simply had not been read against the surface it governs.

**This spec no longer contains an open question** — for the tenth time, and the phrase has now been wrong eight times. Each pass applies pressure the last could not: §10.1–§10.4 came from consolidating eight ADRs, §10.5 from reading the spec as a builder, §10.6 from *being* one, §10.7 from **retroing shipped, green, reviewed code**, §10.8 from **checking that retro's own sources against the primary record**, §10.9 from **four independent lenses over the same seam at once**, §10.10 from **picking up the finding a retro had itself deferred as low-severity**, §10.11 from **three passes briefed to refute rather than confirm**, and §10.13 from **building the surface this document described and discovering its signature had been written from the other entrypoint's vantage point**. Treat "no open questions" as a claim with a short half-life, not a property.

The half-life got shorter, and §10.8 is the sharpest demonstration this document has. **§10.7 was written and green on the same day §10.8 refuted a load-bearing sentence in it** — an ecosystem claim about nine libraries, asserted from a survey nobody had checked against the source. §10.6 earned the rule *"an erratum's blast radius is a claim, not an observation"*; §10.7 restated it and then violated it in its own prose. The corrected version is narrower and more useful: it turned up an option (`then` + `catch`) that the wrong version had defined out of existence. **Cite the source, not the summary — including when the summary is your own and an hour old.**

**And a note on this section's own reliability**, earned the hard way. §10.6 shipped with a **wrong** decisive argument — a delegation requirement that §6.2 flatly contradicts, invented rather than verified, and caught only when someone asked "was that a good call?" *after* the code was green. The decision survived; the reasoning did not. Two things follow, and they cost nothing to state:

1. **A right answer reached by a wrong argument is not a right decision** — it is a coin landing well. It survives until someone reasons *from* the recorded rationale, which is the entire purpose of writing one down.
2. **The pass that catches this is the retro**, and it has no ticket. Consolidation, ticketing, and building each have a moment that forces them; asking "was that actually right?" after the tests pass has none. Green is not the end of the loop.

### 10.14 Error registries are constructor-keyed, reviving nothing — **decided (2026-07-20, post-freeze additive)**

`defineErrors` / `ErrorsOf` (§3.1a) land after the `5.0.0` freeze as a backward-compatible minor: the manual `ReturnType<typeof a> | …` union stays, this is the opt-in canonical spelling. The one hazard worth pinning is that §3.3 records a **cut** helper of the same silhouette — `TypedErrorUnion` — so the resemblance had to be disproven, not waved off.

The two are opposites at the mechanism that got the old one cut. `TypedErrorUnion` keyed off **tags** (`TypedErrorUnion<'a' | 'b'>`) and rebuilt each variant from the interface's *default* payload, erasing the per-variant typed payload. `ErrorsOf` keys off the **constructor values** and infers each one's *return type* — which is the rule §3.1 already states ("error unions are built from constructor return types, each with its own payload"). It is that sentence packaged as a helper, not the cut design returning. The distinction is pinned by a test asserting the derived union keeps `{ dimension }` / `{ slug }` / `never` per variant rather than collapsing to `Record<string, unknown>`.

Two smaller calls, both recorded so they are not re-litigated:

- **The registry bound is structural — `(...args: never[]) => TypedError` — not `ErrorCtor<string, unknown>`.** `ErrorCtor`'s call signature is conditional on `[TData] extends [void]`, so no single instantiation is a supertype of both the payload and no-payload forms; a bound written that way rejects half of every real registry. The structural lower bound admits every constructor, and a hand-rolled factory too — the helpers standardize the shape, not the origin.
- **`defineErrors` is a constrained identity, not a runtime validator.** Its whole value is the compile-time bound firing at the registration site instead of `ErrorsOf` folding a bad entry silently into `never`; adding a runtime scan would buy nothing the type already guarantees and would break the free-identity/hand-roll symmetry the two paths share.

**Not escalated to an ADR.** No prior decision reverses — §3.3's cut stands, and this is additive surface it does not touch.

## 11. Traceability

| Spec § | Source | Note |
|---|---|---|
| §2 `Result` union | ADR 0003 | — |
| §2.1 JSON round-trip | ADR 0003 §5 + ADR 0002 §3 | `cause` carve-out |
| §3 `TypedError` / `defineError` | ADR 0002 + prototype [#17](https://github.com/alifaroo-q/result-kit/issues/17) | — |
| §4 architecture | ADR 0001 | — |
| §5.1 constructors & guards | ADR 0003 §6, ADR 0002 §5 | `isTypedError` signature → §10.3 |
| **§5.2 transforms** | **ADR 0004 §1 + ADR 0005 §2** | **merged here; 0005 supersedes 0004**; `PromiseLike` arm + arm order → §10.6 |
| §5.3 terminals | ADR 0004 §1, ADR 0005 §2 | sync-only |
| §5.4 collections | ADR 0004 §1, ADR 0005 §2 | sync-only; `OkTypeOf`/`ErrTypeOf` → §10.2 |
| §5.5 interop | ADR 0004 §1 | — |
| §5.6 async constructors | ADR 0005 §3 | — |
| §5.7 do-notation | ADR 0007 + prototype [#23](https://github.com/alifaroo-q/result-kit/issues/23) | yield typing resolved in §5.7's note; `safeUnwrap` name → ADR 0007 §5 |
| §5.8 public types | ADR 0004 §1, ADR 0002 §4 | publicness → §10.2 |
| §5.10 schema adapters | ADR 0015 + [#61](https://github.com/alifaroo-q/result-kit/issues/61) | `StandardSchemaV1` vendored, not barrel-exported; key coercion amends ADR 0015 §3 |
| §5.11 envelope parsing | [#66](https://github.com/alifaroo-q/result-kit/issues/66) — no ADR | additive; the `{ ok: true }` / `{ ok: false }` asymmetry follows §10.9 |
| §5.12 assertions | ADR 0011 (Option B) | root, not `./testing`; §6.4's matchers delegate here |
| §6.4 `/testing` matchers | ADR 0011 (Option A) + **ADR 0014 §1** | deferred in 0011, unblocked by 0014; optional peer → §7.2, guarded on the artifact → §7.3 |
| **§6.1 `ResultChain`** | ADR 0004 §2, ADR 0007 §2 | **name → §10.1** |
| **§6.2 `ResultAsync`** | ADR 0005 §4–5 + **ADR 0009** | placement/safety from 0005; **member list from 0009** |
| §6.3 `/fluent` exports | ADR 0001 §4, ADR 0005 §4, ADR 0007 §3 | `safeUnwrap` stays out — ADR 0009 §5; **async constructors in — §10.5** |
| §7 packaging | ADR 0006 | — |
| §8 migration & release | ADR 0008 | — |
| §9.7 repo hygiene | ADR 0008 Consequences | — |
