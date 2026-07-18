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

## Relationships

- A failed **Result** carries an `error` of type `E`; when the producer opts into the convention, that `E` is a **TypedError**.
- **defineError** produces **TypedError** values; **err** wraps any `E` (including a **TypedError**) into a failed **Result**.
- An error union is built from **defineError** constructors' return types (`ReturnType<typeof notFound> | …`), each with its own typed **details**.

## Example dialogue

> **Dev:** "When a lookup misses, do we throw or return a **TypedError**?"
> **Maintainer:** "Return one. `err(notFound({ id }))` — `notFound` is a **defineError** constructor, so `type` is baked in and `details` is typed. The caller narrows with `switch (err.type)`."
> **Dev:** "And if I need a real `Error` to throw at the HTTP boundary?"
> **Maintainer:** "Construct it there, or stash the original in `cause`. The **TypedError** itself stays a plain value."

## Flagged ambiguities

- "error" was used to mean both the **Result**'s `error` channel (any `E`) and the **TypedError** convention — resolved: `E` is fully generic; **TypedError** is the opt-in structured shape you may put in it.
- "fail" (v1's typed failure constructor) is retired — folded into the single generic **err**.
