---
name: using-result-kit
description: Write, review, or migrate TypeScript code that uses @zireal/result-kit — the Result/Ok/Err union, TypedError, matchType, safeTry, the /fluent wrapper, fromSchema, parseResult, and the /testing matchers. Use whenever a file imports from '@zireal/result-kit' (or its /fluent or /testing subpaths), whenever a function returns Result<T, E>, whenever errors are modelled as values rather than thrown, or when porting code from neverthrow, fp-ts Either, or Effect. Also use when a task says "return a Result instead of throwing" or asks for typed errors across a client/server boundary.
---

# Using @zireal/result-kit

`@zireal/result-kit` models failure as a value. A `Result` is **plain data** — no
class, no methods, no brand — which is what lets it cross a process boundary and
still be a `Result` on the other side.

**Before writing any code, read "Reflexes to unlearn". Most model-generated code
for this package is `neverthrow`-shaped and will not compile.** The two libraries
are close enough to look interchangeable and different enough that nothing works.

---

## Reflexes to unlearn

| You will reach for | Write instead | Why |
|---|---|---|
| `result.unwrapOr(0)` | `unwrapOr(result, 0)` | The core is **free functions**; methods exist only on `/fluent`. |
| `result.map(f)` | `map(result, f)` | Data-first: value is the first argument. |
| `result.match(okFn, errFn)` | `match(result, { ok, err })` | **One object**, not two positional callbacks. The most common miscompile. |
| `Result.combine([a, b])` | `combine([a, b])` | No static namespace. And ours is tuple-preserving. |
| `result._unsafeUnwrap()` | `unwrapOrThrow(result)` | `_unsafeUnwrap` does not exist. |
| `okAsync(v)` / `errAsync(e)` | *(no equivalent)* | Async is `Promise<Result>`, or `ResultAsync.from(...)` on `/fluent`. |
| `ResultAsync.fromPromise(p, fn)` | `fromPromise(p, fn)` | Free function, at the root and on `/fluent`. |
| `result.asyncMap(f)` | `.toAsync().map(f)` | Sync→async is one explicit seam, not per-method twins. |
| `fromAsyncThrowable(...)` | `fromThrowableAsync(...)` | The `Async` suffix goes **last**. |
| `yield* mightFail()` (neverthrow 8.1+) | `yield* safeUnwrap(mightFail())` | **The dangerous one** — neverthrow's `Result` is iterable from 8.1.0, ours is deliberately not, so this looks like it should work. |
| `yield* mightFail().safeUnwrap()` (≤8.0) | `yield* safeUnwrap(mightFail())` | Deprecated in neverthrow 8.1.1, still present in 8.x. |
| `err._tag` / `err.code` / `err.kind` | `err.type` | The discriminant is `type`. Always. |
| `class E extends Error` / `Data.TaggedError` | `defineError('not_found', …)` | Typed errors are **plain objects**. |
| `Option` / `Maybe` / `Some` / `None` | *(not shipped)* | Use `toNullable` / `fromNullable`. |
| `E.right(v)` / `E.left(e)` (fp-ts) | `ok(v)` / `err(e)` | |
| `import from '.../core'` | `import from '@zireal/result-kit'` | There is no `/core` subpath. The root **is** the core. |

### The one that bites hardest

**`neverthrow`'s `.isOk()` narrows. `/fluent`'s `.isOk()` does not.**

```ts
// ✗ does not narrow; `.value` is not on the wrapper
if (from(findUser(id)).isOk()) { /* … */ }

// ✓ leave the wrapper, then narrow with the free-function guard
const result = from(findUser(id)).toResult();
if (isOk(result)) result.value;   // T

// ✓ or never leave — collapse both branches
from(findUser(id)).match({ ok: (u) => u.name, err: () => 'anonymous' });
```

A method cannot emit a type predicate about its own class's generics, so
`/fluent`'s `.isOk()` / `.isErr()` return plain booleans. The root's `isOk(r)` /
`isErr(r)` *are* type predicates and do narrow. `ResultAsync` has neither.

---

## The union

```ts
type Result<T, E> = Ok<T> | Err<E>;

interface Ok<T>  { readonly ok: true;  readonly value: T }
interface Err<E> { readonly ok: false; readonly error: E }
```

Purely structural — no brand. Any `{ ok: true, value }` *is* an `Ok<T>`.

**Rules that follow, and that you must not violate:**

- **Exactly two fields per half.** Never add a third (no `status`, no `timestamp`).
- No `instanceof Result` — use `isOk` / `isErr` / `isResult`.
- A `Result` is not iterable.
- Never construct one by hand; use `ok(...)` / `err(...)`.

---

## Writing a function that returns a `Result`

**Always annotate the return type.** Inference works, but the annotation is what
makes the error channel a documented contract.

```ts
import { ok, err } from '@zireal/result-kit';
import type { Result } from '@zireal/result-kit';

function findUser(id: string): Result<User, NotFound> {
  const user = db.get(id);

  return user ? ok(user) : err(notFound({ id }));
}
```

Async is just `Promise<Result<T, E>>` — there is no separate async type in the
core, and no `Async`-suffixed twin of any transform.

---

## Typed errors

Opt-in convention. Plain objects, **never classes, never `extends Error`**:

```ts
{ type: string; message: string; details?: TData; cause?: unknown }
```

```ts
import { defineError, defineErrors } from '@zireal/result-kit';
import type { ErrorsOf } from '@zireal/result-kit';

const notFound = defineError('not_found', (d: { id: string }) => `No user ${d.id}`);
const forbidden = defineError('forbidden', 'Not permitted');

export const appErrors = defineErrors({ notFound, forbidden });
export type AppError = ErrorsOf<typeof appErrors>;
```

- `defineError`'s second argument is a **string** (fixed message) or a **function
  of the payload** (computed message). A payload paired with a *static* message is
  the one shape it cannot infer, and getting it wrong **fails silently**:

  ```ts
  // ✗ typechecks, then drops `details` at runtime
  defineError<'conflict', { id: string }>('conflict', 'Already exists');

  // ✓ the escape hatch
  defineError.withData<{ id: string }>()('conflict', 'Already exists');
  ```
- The payload goes under `details` — **never spread onto the error object**.
- Keep secrets out of `message`; `prettifyErrors` reads it and no formatter can
  take it back out.
- `cause` is `unknown` and is the one field that breaks serialization. Strip it at
  boundaries.

---

## Dispatching on the error

```ts
const status = matchType(error, {
  not_found: () => 404,
  forbidden: () => 403,
  conflict: (e) => (e.details!.slug ? 409 : 400),
});
```

Exhaustive by construction: a missing arm is a compile error, and so is an arm
keyed on a tag the union does not have.

**A catch-all is the third parameter, never a `_` key**, because only that
position narrows to the *residual* (unhandled) variants:

```ts
matchType(error, { not_found: () => 404 }, (e) => {
  //                                        ^? the leftovers only
  return 500;
});
```

Coming from a `Result`, compose the two — `matchType` takes the **error**, not the
`Result`:

```ts
match(result, {
  ok: () => 200,
  err: (e) => matchType(e, { not_found: () => 404, forbidden: () => 403 }),
});
```

Two constraints to respect:

- **`details` stays optional after the tag narrows.** Write `e.details!.id` or
  `e.details?.id`. This is the single most common compile failure in generated
  code.
- **Only a closed union can be exhausted.** A bare `TypedError` has an open
  `string` tag, so any set of arms satisfies it. Use `ErrorsOf` or an explicit
  union.

---

## Picking a surface

**Default to `/fluent` for application code**; use the core for libraries, hot
paths, and minimal bundles. The core is self-sufficient and never needs `/fluent`.

```ts
// core — reads inside-out
unwrapOr(mapErr(map(r, (u) => u.name), (e) => e.message), 'anon');

// /fluent — reads left-to-right
from(r).map((u) => u.name).mapErr((e) => e.message).unwrapOr('anon');
```

**The plain union is the source of truth.** A wrapper is a transient envelope for
one chain: never store it, never serialize it, never return it across a boundary.
Leave with `.toResult()`.

**Array-shaped helpers are root-only** — `combine`, `combineWithAllErrors`,
`partition`, `fromNullable`, `fromPredicate`, `fromThrowable`. Re-enter the
wrapper with `from(...)`:

```ts
from(combine([a, b])).map(sum).unwrapOr(0);
```

### Async on `/fluent`

```ts
const name = await ResultAsync.from(loadUser(id))
  .andThen(requireActive)
  .map((user) => user.name)
  .match({ ok: (n) => n, err: () => 'anonymous' });
```

`ResultAsync` implements `PromiseLike`, so `await` collapses it to the plain
`Result`. Crossing sync→async is **always explicit**, via `.toAsync()`,
`fromPromise`, or `ResultAsync.from`.

Do not pass an `async` callback to a **sync** chain. A settled `Result` cannot
promise an asynchronous output — a transform that short-circuits never runs its
callback, so on the `Err` branch there is nothing to await. `.andThen()` /
`.orElse()` reject it outright; `.map()` / `.mapErr()` / `.inspect()` /
`.inspectErr()` cannot, so they widen the return to `ResultChain | ResultAsync`
instead. Call `.toAsync()` first either way.

---

## Do-notation

For branches, early exits, or a step needing a value from two steps back:

```ts
import { ok, safeTry, safeUnwrap } from '@zireal/result-kit';

const total = safeTry(function* () {
  const user = yield* safeUnwrap(findUser(id));      // an Err short-circuits the block
  const order = yield* safeUnwrap(loadOrder(user));

  return ok(user.credit + order.total);              // return a Result EXPLICITLY
});
//    ^? Result<number, NotFound | OrderMissing> — the error channel accumulates
```

- The body **returns a `Result`**, never a bare value.
- `async function*` gives the async shape. There is no `safeTryAsync`.
- On `/fluent` there is **no `safeUnwrap`** — wrappers are self-iterable, so
  `yield* from(findUser(id))` directly.

**Gotcha:** a discriminated-union return **widens** inside the generator, because
its return type is inferred before it is checked against your union.

```ts
return ok({ kind: 'noop' });                    // ✗ 'noop' widens to string
return ok({ kind: 'noop' } satisfies MyUnion);  // ✓
```

---

## Across a boundary

**When the type crosses with the value** (server action, tRPC, typed RPC, typed
worker channel) — nothing to do. The client already has the union and narrows it.

Keep the framework-facing function thin; the substance is an ordinary
`Result`-returning function it calls.

**When the type is lost** (`fetch`, `postMessage`, a queue) — never close the gap
with `as Result<T, E>`. Prove it in two steps:

```ts
const envelope = parseResult(await response.json());
if (isErr(envelope)) return `Bad response (${envelope.error.details?.reason})`;

const result = envelope.value;                 // Result<unknown, unknown> — envelope proven
if (isErr(result)) return renderError(result.error);

const booking = parseBooking(result.value);    // fromSchema — payload proven
```

`parseResult` proves the **envelope** and is deliberately **not generic**;
`fromSchema` proves the **payload**. The nesting is intentional: the outer
`Result` answers *was this a `Result` at all*, the inner one *did it succeed*.

Reach for `isResult` when you just want an `if` and no diagnostic.

**Three things do not survive the trip:** `cause` (may hold anything — strip it),
a no-arg `ok()` (arrives as `{ ok: true }` with the `value` key gone), and the
fluent wrapper (exit it first).

---

## Validating input

```ts
const parseUser = fromSchema(UserSchema);   // wrap once, call many times
const result = parseUser(await req.json()); // Result<User, ValidationFailed>
```

Works with any Standard Schema validator — Zod 4, Valibot, ArkType, Effect Schema
— with no dependency added.

The error is a **single** `TypedError<'validation_failed', { issues }>`. Each issue
keeps `message` and `path` only; vendor extras (Zod's `code`, `expected`, `input`)
are dropped so `details` stays identical across vendors and JSON-safe. Read them
as `result.error.details?.issues ?? []` — `details` is optional.

`fromSchema` is synchronous and **throws** on an async schema. Use
`fromSchemaAsync` when you do not know statically which you have.

`{ includeCause: true }` puts the raw vendor issues on `cause` — including the
**rejected input**. Off by default for that reason; never enable it on a value
that crosses the wire.

---

## Mapping to HTTP

Map at the boundary with a function you own. **Never put a `status` field on the
`TypedError`** — that breaks the two/four-field shape. Dispatch on the
discriminant:

```ts
const errToStatus = (error: BillingError): number =>
  matchType(error, { plan_not_found: () => 404, missing_company_id: () => 422 });

if (isErr(result)) {
  return Response.json(
    { error: result.error.message, type: result.error.type },
    { status: errToStatus(result.error) },
  );
}
```

`matchType` is exhaustive, which is the point: add a variant and this stops
compiling. A `switch` with `default: return 400` quietly maps every new error to
`400` forever.

---

## Adopting it in throwing code

`unwrapOrThrow` is the boundary adapter for a strangler migration — it returns the
value on `Ok`, and on `Err` throws a real `Error` with the original in `cause`:

```ts
async function changePlanOrThrow(input: Input): Promise<PlanChange> {
  return unwrapOrThrow(await changePlan(input));
}
```

Point unconverted callers at the `…OrThrow` wrapper; delete it when the last one
is gone. Going the other way, wrap throwing dependencies with `fromThrowable` /
`fromPromise`.

---

## Testing

A `Result` is plain data, so assert structurally:

```ts
expect(await changePlan(input)).toEqual(ok({ kind: 'noop' }));
```

To read the value after asserting the branch, use the extracting assertions from
the root barrel (no test runner needed) — they throw on the wrong branch and
**return** `T` / `E`:

```ts
import { expectOk, expectErr } from '@zireal/result-kit';

const value = expectOk(await loadPlan(id));
const error = expectErr(await failingCall());
```

Optional Vitest matchers live at `@zireal/result-kit/testing` and must be
registered **explicitly** — importing does not register them:

```ts
import { expect } from 'vitest';
import { resultMatchers } from '@zireal/result-kit/testing';

expect.extend(resultMatchers);
```

`toBeOk` / `toBeOkWith` / `toBeErr` / `toBeErrWith`. Both `*With` forms are deep
equality; use `expect.objectContaining` for partial matching. **The matchers
assert but do not narrow** — keep `expectOk` / `expectErr` for reading the value.

---

## Checklist before finishing

- [ ] No `.map()` / `.unwrapOr()` / `.match()` called on a **plain** `Result`.
- [ ] `match` is called with **one object** `{ ok, err }`, not two callbacks.
- [ ] Every `Result`-returning function has an **annotated return type**.
- [ ] `details` is accessed with `?.` or `!` — never bare.
- [ ] The error discriminant is `type`, not `_tag` / `code` / `kind`.
- [ ] No typed error is a class or `extends Error`.
- [ ] No third field added to a `Result` or a fifth to a `TypedError`.
- [ ] No wrapper is stored, serialized, or returned across a boundary.
- [ ] `safeTry` bodies `return ok(v)`, not a bare value.
- [ ] Imports come from `@zireal/result-kit`, `/fluent`, or `/testing` — never
      `/core`, `/fp-ts`, or `/nest`.

---

## Reference

- Full brief: [`llms.txt`](../../llms.txt) and [`llms-full.txt`](../../llms-full.txt)
- [README](https://github.com/alifaroo-q/result-kit#readme) ·
  [RECIPES](https://github.com/alifaroo-q/result-kit/blob/main/RECIPES.md) ·
  [MIGRATION](https://github.com/alifaroo-q/result-kit/blob/main/MIGRATION.md)
