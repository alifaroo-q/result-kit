# @zireal/result-kit

A lean, zero-runtime-dependency TypeScript library for the `Result`/`Either` pattern: a plain, method-less `Result` union, a data-first free-function core, and an opt-in fluent wrapper.

## Language

**Result**:
A plain, method-less discriminated union `Ok<T> | Err<E>` — the serializable source of truth that crosses boundaries. Purely structural (no brand): any `{ ok: true, value }` **is** an **Ok**, any `{ ok: false, error }` **is** an **Err**, whoever built it. Generic over the success type `T` and the error type `E`. Guaranteed to round-trip through `JSON.parse(JSON.stringify(...))` when `T` and `E` are JSON-serializable — consumable with no re-wrapping, subject to spec §2.1's three carve-outs (`cause`, exit the wrapper first, and `Ok<void>`, which round-trips to a one-field object).
_Avoid_: Either (that's the fp-ts framing we're shedding), Outcome.

**Ok** / **Err**:
The two named, exported halves of the **Result** union: `Ok<T> = { readonly ok: true; readonly value: T }` and `Err<E> = { readonly ok: false; readonly error: E }`. Shallow-`readonly`, no opposite-field `never`, no runtime freeze. The narrowing targets of **isOk** / **isErr**.
_Avoid_: Success, Failure (v1 type names, renamed in v2).

**isOk** / **isErr**:
The data-first free-function guards over a **Result**, emitting type predicates (`result is Ok<T>` / `result is Err<E>`) so `if (isOk(r)) { r.value }` narrows. Runtime siblings of **isTypedError**. The fluent wrapper mirrors them as plain-boolean `.isOk()` / `.isErr()` conveniences; type-safe narrowing on the fluent side goes through `.match()` / terminals.
_Avoid_: isSuccess, isFailure.

**TypedError**:
The opt-in structured-error convention: a plain object `{ type, message, details?, cause? }`, generic over its discriminant `TType` and an optional typed payload `TData`. Not a class, never `extends Error`. Carried inside a failed **Result**'s `error`.
_Avoid_: TaggedError, AppError, DomainError (those are userland variants built *with* TypedError, not the type itself).

**type** (of a TypedError):
The stable string discriminant a **TypedError** is narrowed on (`switch (err.type)`). Not to be confused with a Node-style error `code`.
_Avoid_: tag, `_tag`, kind, code.

**details**:
A **TypedError**'s optional, variant-typed metadata payload (`TData`). Nested under one key — never spread onto the error object.
_Avoid_: data, payload, meta, context.

**defineError**:
The free-function factory that binds a `type`, a payload type, and a default message, returning a constructor that produces plain **TypedError** values. The plain-object analog of Effect's class-based `Data.TaggedError`.
_Avoid_: makeError, createError, errorType.

**err** / **ok**:
The root constructors, returning the **narrow** halves: `ok<T>(value): Ok<T>` (plus a no-arg `ok(): Ok<void>` overload for the `Result<void, E>` case) and `err<E>(error): Err<E>`. `err` is the single generic failure constructor — there is no separate typed `fail`; you pass a **TypedError** to `err`. The `/fluent` entrypoint has its own `ok`/`err` returning the wrapper.
_Avoid_: success, failure, fail (v1 names, removed in v2).

**ResultChain**:
The synchronous fluent wrapper (`/fluent`), and the **documented hero** of the consumer-facing docs. A transient ergonomic envelope around one **Result** — chain with `.map()` / `.andThen()`, then leave through `.toResult()`. Never the interchange or serialized type: the plain **Result** is the source of truth, and only it carries the JSON round-trip guarantee. Delegates one-to-one to the core free functions; it never reimplements them. Self-iterable, so `yield* chain` works inside a `/fluent` **safeTry** with no **safeUnwrap**.
_Avoid_: ResultPipeline (the v1 class this replaces), Chain, Wrapper, Builder, the fluent Result (it wraps one — it is not one).

**ResultAsync**:
The asynchronous fluent wrapper (`/fluent`), `implements PromiseLike<Result<T, E>>` — so `await resultAsync` collapses to the plain **Result**, by design rather than by accident. **ResultChain, lifted**: every value-terminal mirrored with a `Promise`-returning one, with two deliberate departures — no `.isOk()` / `.isErr()`, and a **throwing** `toJSON()`. Reached explicitly via `.toAsync()`, `fromPromise`, or `ResultAsync.from`; never implicitly, because a settled input cannot promise an asynchronous output. Terminal handlers stay synchronous; only the return is lifted.
_Avoid_: AsyncResultPipeline (the v1 class this replaces), AsyncResult, FutureResult, TaskResult, ResultPromise.

**safeTry**:
The do-notation runner: it drives a generator whose body reads as flat, sequential code, where any **Err** short-circuits the whole block. The generator returns a **Result** explicitly (`return ok(v)`, or an early `return err(e)`) — never a bare value. Its error channel is **union-accumulated**, the same rule `andThen` uses, because do-notation *is* `andThen` chaining with nicer syntax; there is no Rust-style `From` coercion. One overloaded runner covers both worlds — a `function*` returns the sync shape, an `async function*` the async one — so there is no `safeTryAsync`. Exists at both entrypoints (a **dual constructor**): root returns a plain **Result**, `/fluent` returns a wrapper.
_Avoid_: gen (Effect's name), doNotation, attempt, tryCatch, safeTryAsync (no such double exists).

**safeUnwrap**:
The **root-only** adapter that makes a plain **Result** `yield*`-able inside a **safeTry** block: it yields the **Err** that short-circuits and returns the unwrapped value, so `const v = yield* safeUnwrap(r)` binds `T`. Iterability lives here rather than on the union — putting `[Symbol.iterator]` on what `ok()` / `err()` produce would reopen the no-brand guarantee, and with it the JSON round-trip, for the sake of optional sugar. `/fluent` has **no** `safeUnwrap`, because **ResultChain** and **ResultAsync** are self-iterable; root's still works inside a fluent block for unwrapping a *plain* union.
_Avoid_: unwrap (that token means "throws" across the genre and is deliberately unused), bind, yieldResult, $ (neverthrow deprecated its `safeUnwrap` in favour of iterable data — we did not, and the reasoning differs: their data is already a class).

**groupByType**:
The formatter that keys an accumulated `TypedError[]` by each error's **type** discriminant, returning a **partial** record whose groups keep their narrowed variant. Partial because a variant that did not occur has no key — typing an absent group as present would hand back `undefined` under a type that promised an array. Pure: the grouped errors are the same objects, and input order survives within a group.
_Avoid_: groupBy, byType, format (that's the zod-v3 name for a *tree*, which we cannot build), flatten (zod's name for a `path`-keyed shape we have no `path` for).

**prettifyErrors**:
The formatter that renders an accumulated `TypedError[]` as one human-readable line per error — `✖ <type>: <message>`. Reads **type** and **message** only, never **details**; an empty input gives an empty string rather than a placeholder, so the output composes into a larger message. Not a redaction mechanism: a variant's **message** may already have been computed from its payload.
_Avoid_: prettifyError (zod's name; ours takes the array, not an error object), format, toString, render, stringify.

## Relationships

- A failed **Result** carries an `error` of type `E`; when the producer opts into the convention, that `E` is a **TypedError**.
- **defineError** produces **TypedError** values; **err** wraps any `E` (including a **TypedError**) into a failed **Result**.
- An error union is built from **defineError** constructors' return types (`ReturnType<typeof notFound> | …`), each with its own typed **details**.
- **ResultChain** and **ResultAsync** wrap a **Result**; `.toResult()` is the way back out, and the plain union is what crosses a boundary. `.toAsync()` is the one explicit seam from the sync wrapper to the async one.
- **safeTry** consumes what **safeUnwrap** (or a self-iterable wrapper) yields. The two are always used together: **safeUnwrap** only ever appears inside a **safeTry** block.
- **combineWithAllErrors** produces the accumulated `TypedError[]` that **groupByType** and **prettifyErrors** consume, and is their motivating source. It is not the only one: `partition`'s second half is also an error array, and is equally valid input.
- The wrappers are **opt-in ergonomics**, never a requirement — the free-function core is self-sufficient and never needs `/fluent`. That split is what makes the core tree-shakable.

## Example dialogue

> **Dev:** "When a lookup misses, do we throw or return a **TypedError**?"
> **Maintainer:** "Return one. `err(notFound({ id }))` — `notFound` is a **defineError** constructor, so `type` is baked in and `details` is typed. The caller narrows with `switch (err.type)`."
> **Dev:** "And if I need a real `Error` to throw at the HTTP boundary?"
> **Maintainer:** "Construct it there, or stash the original in `cause`. The **TypedError** itself stays a plain value."

## Flagged ambiguities

- "error" was used to mean both the **Result**'s `error` channel (any `E`) and the **TypedError** convention — resolved: `E` is fully generic; **TypedError** is the opt-in structured shape you may put in it.
- "fail" (v1's typed failure constructor) is retired — folded into the single generic **err**.
- "the wrapper" was used across the ADRs for what this glossary now calls **ResultChain** — the name was fixed by the spec, not by any ADR, so an ADR saying "the wrapper" means **ResultChain** unless it is plainly discussing the async one. The pair reads asymmetrically (**ResultChain** / **ResultAsync**) and that is an accepted, recorded cost.
- "pipeline" (v1's `ResultPipeline` / `AsyncResultPipeline`) is retired. It named both the *class* and the *`pipe` composition helper*, which were different things; **ResultChain** / **ResultAsync** replace the classes, and `pipe` has no direct replacement — it is a per-site design call between the wrapper and **safeTry**.
