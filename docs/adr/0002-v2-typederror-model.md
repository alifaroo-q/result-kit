# ADR 0002 — v2 TypedError model

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 TypedError model](https://github.com/alifaroo-q/result-kit/issues/11)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifaroo-q/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md)

## Context

v2 keeps the `ResultKit` concept and the `TypedError` structured-error convention, but is a clean breaking major free to change signatures. The paradigm ([ADR 0001](./0001-v2-core-api-paradigm.md)) fixed the surrounding shape: a plain, method-less `Result<T, E>` union as the serializable source of truth, a data-first free-function core, and an opt-in fluent wrapper. The error model must fit that seam — anything the error carries has to survive serialization and cross the ESM/CJS dual-package boundary without `instanceof`.

The landscape study's #11 implication ([line 91](../research/api-packaging-landscape.md)) is the evidence base: keep `E` generic; keep `{ type, message, details?, cause? }` as an *optional* convention refined toward the Zod `ZodIssue` shape (discriminant + typed payload + message); consider an accumulating combinator with pure formatter helpers; do **not** adopt an Effect-style fully-typed channel.

## Decision

The v2 error model, at a glance:

```ts
interface TypedError<TType extends string = string, TData = Record<string, unknown>> {
  readonly type: TType;        // discriminant — narrow with `switch (err.type)`
  readonly message: string;    // guaranteed human-readable, loggable
  readonly details?: TData;    // optional typed payload (ZodIssue-style)
  readonly cause?: unknown;    // ES2022-style chaining; outside the JSON-serialization guarantee
}

declare function defineError<TType extends string, TData = void>(
  type: TType,
  defaultMessage: string | ((details: TData) => string), // always required
): ErrorCtor<TType, TData>;
declare namespace defineError {
  // curried escape hatch for payload + static message (see §4)
  function withData<TData>(): <TType extends string>(
    type: TType,
    defaultMessage: string | ((details: TData) => string),
  ) => ErrorCtor<TType, TData>;
}
// The returned constructor's call shape is CONDITIONAL on payload presence:
type ErrorCtor<TType extends string, TData> = ([TData] extends [void]
  ? (message?: string) => TypedError<TType, never>          // no payload
  : (details: TData, message?: string) => TypedError<TType, TData>) & {
  readonly type: TType;
  is(x: unknown): x is TypedError<TType, [TData] extends [void] ? never : TData>;
};

declare function isTypedError(x: unknown): x is TypedError; // narrows to the base shape
// cut: TypedErrorOf, TypedErrorUnion. err() is the single generic failure constructor.
```

### 1. `E` stays fully generic; `TypedError` is an opt-in convention

`Result<T, E>` remains generic over any `E`. `TypedError` is **not** mandated by the error channel — it is the structured convention a producer reaches for when they want tagged, discriminable errors. Plain `err("not found")` or `err(new DomainError())` stay first-class.

Rationale: none of the genre leaders (neverthrow, ts-results-es, fp-ts, true-myth) prescribe an error shape, and *"that generality drives adoption"* ([research line 46](../research/api-packaging-landscape.md)). A prescribed channel is the Effect cost the study rules out for a lean lib ([line 47](../research/api-packaging-landscape.md)). Preserves the v1 mental model (`failure`/`err` = any `E`; `fail` = the typed convention).

### 2. `TypedError` is a plain, serializable structural object — no class, no `extends Error`

`TypedError` stays a structural interface. It is never a class instance and never extends `Error`. The error rides inside `Result.error`, which ADR 0001 fixed as serializable and boundary-crossing, so the same reasoning applies: a class error would reintroduce the ESM/CJS `instanceof` dual-package hazard ADR 0001 eliminated at the union level, and would not round-trip through `JSON.stringify`/`structuredClone`.

Errors are **values** narrowed with `switch (err.type)`, not exceptions thrown. Consumers who need a real `Error` at a throw boundary construct one at the throw site or carry it in `cause`.

Rationale: consistent with ADR 0001's method-less-union thesis; Zod's `ZodIssue` (the study's gold-standard structured error) is a plain object, not a class; avoids ts-results-es's eager stack-capture-in-constructor footgun ([research lines 40, 49](../research/api-packaging-landscape.md)).

### 3. The `TypedError` shape

- **Discriminant stays `type`.** The study endorses the v1 `{ type, message, details? }` convention as "exactly result-kit's existing convention, refined" ([line 40](../research/api-packaging-landscape.md)) — the refinement is in the payload, not the name. `switch (err.type)` parallels the union's own `ok` discriminant. Rejected `_tag` (fp-ts/HKT baggage we're shedding) and `code` (reads as a Node-style error code, not a variant tag).
- **Typed payload, nested under `details`, optional with a permissive default:**

  ```ts
  interface TypedError<TType extends string = string, TData = Record<string, unknown>> {
    readonly type: TType;
    readonly message: string;
    readonly details?: TData;
    readonly cause?: unknown;
  }
  ```

  The payload's type is tied to the variant (`TypedError<'not_found', { id: string }>`) — the study's `ZodIssue` "typed payload" refinement ([lines 40, 91](../research/api-packaging-landscape.md)). **Nested, not spread:** a stable 4-field top-level shape is validatable by one guard, serializes uniformly, and avoids reserved-key collisions (a flat/spread payload breaks the moment it wants a `type`/`message`/`cause` field) and awkward `TypedError<T> & TData` intersections. **Optional with `TData = Record<string, unknown>` default:** `TypedError<'not_found'>` behaves exactly like v1; the typed payload is progressive disclosure. A *guaranteed*-present payload, if wanted, comes from the factory (§4), not the raw interface.

- **`message` stays required** — the guaranteed human-readable, loggable fallback with no formatter needed. Part of the study's gold-standard shape ([line 40](../research/api-packaging-landscape.md)). Later formatter helpers enrich presentation, never replace the authored `message`.
- **`cause?: unknown` kept, documented as outside the serialization guarantee.** Mirrors ES2022 `Error.cause` for chaining an underlying failure; `unknown` matches a caught `catch (e)`. It may hold a non-serializable value, so the JSON-safe guarantee covers `{ type, message, details }` only. **Coordination point with [#12](https://github.com/alifaroo-q/result-kit/issues/12):** serializing a `TypedError` with a populated `cause` requires the caller to sanitize/drop `cause` first; the Result union's round-trip contract documents this.
- **No top-level `path`.** Validation-specific and meaningless for most variants; it belongs inside a validation error's typed `details` payload. The study's *"optionally `path`"* reads as "not core." Shape stays four fields.

### 4. `defineError` factory + single generic `err` (no separate `fail`)

Ship a free function `defineError` that binds a `type`, a payload type, and a default message, returning a constructor that yields **plain `TypedError` values**:

```ts
const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
notFound({ id: '123' });                 // { type: 'not_found', message: 'User 123 not found', details: { id: '123' } }
notFound({ id: '123' }, 'Custom message'); // per-call message override
```

- Kills the stringly-typed `type` / forgotten-`message` footgun — the plain-object analog of Effect's class-based `Data.TaggedError`.
- Free function, tree-shakable, lives in core (ADR 0001). Default message is `string | (details) => string` (DRY + override).
- **Produces a value, not a `Result`** — single-purpose; composed via `err(notFound({ id }))`, and reusable outside a `Result` (throw, log, stash in `cause`).

**Interaction with the constructors:** because `E` is generic (§1), `err(x)` already accepts a `TypedError`. v1's separate typed `fail` (distinct from `failure`) is **redundant** and collapses into a single generic `err`; the typed convention is expressed by *what you pass*, not a second constructor. (Constructor names/signatures are formally [#12](https://github.com/alifaroo-q/result-kit/issues/12)'s to ratify — recorded here as the error-model interaction.)

**Exact signature — locked by the prototype ([#17](https://github.com/alifaroo-q/result-kit/issues/17), 2026-07-14):** a **hybrid single-call + curried `.withData`** factory, message **always required**, with a per-variant `.is()` guard.

- **Default single-call form** `defineError(type, message)`. The payload type is declared by **annotating the message function's parameter** — `defineError('not_found', (d: { id: string }) => ...)` infers `TData = { id: string }` with no explicit generics. Terse for the common case (message derives from payload) and for no-payload variants (`defineError('forbidden', 'Access denied')`).
- **Curried `.withData<TData>()(type, message)`** — the escape hatch for the one shape single-call can't infer: a payload paired with a **static** message (`defineError.withData<{ id: string }>()('conflict', 'Already exists')`). It gives the payload type explicitly **without repeating the `type` literal** (the all-or-nothing type-argument tax the single generic form would impose). Chosen over the `(_d: Payload) => 'static'` unused-parameter idiom.
- **Constructor call shape is conditional on payload presence.** No-payload variants are `(message?: string) => TypedError<TType, never>` (message is the first positional; **no `Record<string, unknown>` leak** — the factory defaults `TData = void`, so absent-payload variants carry `details?: never`, not the interface's permissive default). Payload variants are `(details: TData, message?: string) => TypedError<TType, TData>`.
- **`message` (the default) is always required** — never fully omittable, no silent fallback to the `type` string. Keeps §3's "guaranteed human-readable `message`" invariant at the constructor boundary; a per-call second argument still overrides it.
- **Per-variant `.is()` guard ships** on every constructor: `notFound.is(x): x is TypedError<'not_found', TData>`, a **tag-only** runtime check (`x.type === 'not_found'`). It cannot validate the typed payload at runtime (that needs a schema — §5), but narrows an error union cheaply. A free `isError(x, 'not_found')` equivalent remains [#13](https://github.com/alifaroo-q/result-kit/issues/13)'s to place in the API surface; the two are not mutually exclusive.
- **`ReturnType<typeof notFound>` is a clean `TypedError<'not_found', { id: string }>`** — verified by the prototype's compiler assertions — so error unions build straight from constructor return types (§5). Full prototype + call-site battery: [`prototype/define-error/`](../../prototype/define-error/README.md) (throwaway; delete once implemented).

### 5. Prune the v1 type helpers: cut `TypedErrorOf` and `TypedErrorUnion`, keep `isTypedError`

- **`TypedErrorOf<TType>` — cut.** A bare alias identical to `TypedError<TType>`; adds nothing and only muddies the new `TData` param.
- **`TypedErrorUnion<TType>` — cut.** It distributes a union of tags into same-*default*-payload variants, fighting the per-variant typed payload of §3. Error unions are now built from the factory constructors' return types, each with its own payload: `type ApiError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>`.
- **`isTypedError` — keep, unchanged name.** Narrows a caught `unknown` / generic `E` to the **base** `TypedError<string, Record<string, unknown>>` (it can't validate a specific variant's payload at runtime — that needs a schema). Runtime sibling of the `isOk`/`isErr` guard family ([#12](https://github.com/alifaroo-q/result-kit/issues/12)). Per-variant guards (factory `.is()`, `isError(x, 'not_found')`) are deferred to the prototype/[#13](https://github.com/alifaroo-q/result-kit/issues/13).

### 6. Accumulation and formatters are out of scope for the model → [#13](https://github.com/alifaroo-q/result-kit/issues/13)

The model needs **no aggregate error type and no formatter API**. Accumulation is expressible with the existing shape (a `TypedError` whose typed `details` carries `TypedError[]`, or a combinator returning `Result<T, E[]>`); the accumulating combinator itself is already in #13's inventory (`combineWithAllErrors`). Pure formatter helpers (`formatError(err): string`) are free functions *over* the model — API surface, not model. The four-field shape + typed `details` is *sufficient* for both to be built downstream. A coordination comment records formatters on #13.

### 7. Error-channel flow: plain discriminated union, `switch`-narrowed, union-accumulated

The model's contribution to how errors thread through chains:

- A `TypedError` is a plain object keyed on `type`, so a failure channel of `TypedError<'not_found'> | TypedError<'forbidden'>` is **exhaustively narrowable by `switch (err.type)` at zero runtime cost** — the study's *"~90% of the safety [of Effect's typed channel] at zero runtime cost"* ([line 47](../research/api-packaging-landscape.md)). This is the reason the model is plain and structural.
- The error type is carried unchanged through `err` → chain → `match`/`unwrap`, identically on the free-function and fluent surfaces (the wrapper delegates to the same core, ADR 0001).
- **Boundary with [#13](https://github.com/alifaroo-q/result-kit/issues/13):** this ticket owns the error *value* and *shape*; #13 owns the *combinator signatures* that move it — chains **union-accumulate** the error type (`andThen: Result<U, E | F>`), the study's most valuable inference behavior. The model imposes nothing beyond *being* a clean discriminated union so `E | F` narrows.

## Rejected alternatives

- **Prescribe `TypedError` as the error channel (Effect-style).** Would force every failure through a wrapper and pay for a fully-typed channel the lean destination rejects. Rejected — `E` stays generic (§1).
- **Class-based `TypedError` / `extends Error`.** Enables `instanceof` and free `.stack`, familiar to exception-throwing code — but reintroduces the dual-package `instanceof` hazard ADR 0001 eliminated, breaks serialization round-trips, and invites eager per-error stack capture. Rejected — plain structural object (§2).
- **Flat/spread payload (Zod/Effect field-spreading).** Ergonomic `err.id` access — but collides with reserved `type`/`message`/`cause` keys, forces `TypedError<T> & TData` intersections, and breaks the single structural guard. Rejected — nested typed `details` (§3).
- **Keep `TypedErrorOf` / `TypedErrorUnion`.** The former is a redundant alias; the latter builds same-default-payload unions that fight the per-variant typed payload. Rejected — cut both; unions come from factory return types (§5).
- **Separate typed `fail` constructor (v1's `fail` vs `failure`).** Redundant once `E` is generic and `err` accepts a `TypedError` directly. Rejected — one generic `err` (§4).
- **Bake an aggregate/`issues[]` error type or a formatter API into the model.** Over-scopes the model; both are expressible/buildable downstream. Rejected — API surface, deferred to #13 (§6).

<!-- filled as alternatives are rejected during grilling -->

- **Prescribe `TypedError` as the error channel (Effect-style).** Would force every failure through a wrapper and pay for a fully-typed channel the lean destination rejects. Rejected — `E` stays generic.
- **Class-based `TypedError` / `extends Error`.** Enables `instanceof` and free `.stack`, familiar to exception-throwing code — but reintroduces the dual-package `instanceof` hazard ADR 0001 eliminated, breaks serialization round-trips, and invites eager per-error stack capture. Rejected — plain structural object.

## Consequences

- **The `TypedError` interface gains a second generic `TData`** and prunes two type aliases — a breaking change captured in the v2 migration story (still fog, gated on #12/#13).
- **`defineError` is a new public free function** with a **locked signature** (§4): hybrid single-call + curried `.withData`, message required, per-variant `.is()` guard. Prototype: [`prototype/define-error/`](../../prototype/define-error/README.md).
- **`err` is the single failure constructor**; v1's `fail`/`failure` split is gone. Constructor names/signatures are ratified by [#12](https://github.com/alifaroo-q/result-kit/issues/12).
- **Serialization caveat on `cause`** must be documented alongside #12's Result round-trip contract: `{ type, message, details }` is JSON-safe; `cause` is not guaranteed and must be sanitized before serializing.
- **[#13](https://github.com/alifaroo-q/result-kit/issues/13) inherits** the accumulating combinator, pure formatter helpers, per-variant guards, and the `andThen` union-accumulation signature — all buildable on this model with no further model change.
- Implementation (deleting v1 helpers, adding `defineError`, updating `err`) happens in the **separate execution effort**, not now (map is planning-only).
