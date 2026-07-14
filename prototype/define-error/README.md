# Prototype: lock the `defineError` signature (issue #17)

**Throwaway.** Delete once the verdict lands in ADR 0002 §4.

## Question

ADR 0002 §4 settled that `defineError` is a free function binding a `type`, a
payload type, and a default message, returning a constructor that yields plain
`TypedError<TType, TData>` values. What's open is the *exact call signature*:

1. Arg order / optionality with **no payload** vs a **required payload**.
2. Default message form (`string | (details) => string`) and whether it can be
   fully omitted (fall back to `type`).
3. Inference — `ReturnType<typeof notFound>` must be a clean
   `TypedError<'not_found', { id: string }>`, with **no** `Record<string, unknown>`
   leak into typed variants.
4. Whether a per-variant `.is()` guard is worth hanging off the constructor.

## Run

```bash
# Types — the real signal. A silent run proves every asserted inference AND
# every "this should be a compile error" (@ts-expect-error) in callsites.ts.
pnpm exec tsc --noEmit --strict --skipLibCheck \
  --target ES2022 --module ESNext --moduleResolution Bundler \
  prototype/define-error/define-error.ts prototype/define-error/callsites.ts

# Runtime — see the actual objects each candidate produces.
pnpm exec vitest run prototype/define-error/demo.test.ts
```

## The two candidates

Both produce identical values; they differ only in how the payload type is bound.

| Case | Candidate A `defineError(type, msg?)` | Candidate B `defineErrorCurried<TData>()(type, msg?)` |
|---|---|---|
| payload + fn message | `defineError('not_found', (d:{id})=>...)` ✅ terse | `defineErrorCurried<{id}>()('not_found', d=>...)` ✅ |
| payload + static message | needs `defineError<'not_found',{id}>(...)` ⚠️ repeats literal | `defineErrorCurried<{id}>()('not_found','msg')` ✅ |
| no payload | `defineError('forbidden','msg')` ✅ terse | `defineErrorCurried()('forbidden','msg')` ⚠️ empty `()` tax |

- **A** optimizes the common case (message derives from payload) and reads most
  naturally, but has one rough edge: payload + *static* message silently loses the
  payload type unless you spell out both generics.
- **B** is uniform (payload + static message just works) at the cost of an empty
  `()` on every call, payload or not.

## Verdict (locked 2026-07-14 → ADR 0002 §4)

**Hybrid single-call + curried `.withData`, message always required, `.is()` shipped.**

- **Default form** `defineError(type, message)` — single call; payload type is
  declared by annotating the message fn's param. Terse for the common case
  (message derives from payload) and for no-payload variants.
- **`.withData<TData>()(type, message)`** — curried escape hatch for the one case
  single-call can't infer: a payload paired with a **static** message. Gives the
  payload type explicitly without repeating the `type` literal. (Chosen over the
  `(_d: Payload) => 'static'` unused-param idiom.)
- **Default message is always required** (`string | (details) => string`) — never
  fully omittable. It is the guaranteed human-readable fallback (ADR 0002 §3).
- **`.is()` ships** as a tag-only per-variant guard (`notFound.is(x)` narrows a
  union; payload is not runtime-validated — needs a schema). Coordinates with #13.
- **Inference verified:** no-payload variants are `TypedError<T, never>`, payload
  variants are exactly `TypedError<T, TData>` — the permissive
  `Record<string, unknown>` interface default never leaks (factory defaults
  `TData = void`).

Both checks pass (`tsc` silent; vitest 4/4). Safe to delete once ADR 0002 §4 is
updated — the answer lives there.
