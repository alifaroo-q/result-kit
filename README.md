# @zireal/result-kit

Type-safe `Result` handling for TypeScript. Model failure as a value instead of throwing through your service layer.

- **Plain data.** A `Result` is `{ ok: true, value }` or `{ ok: false, error }` — no class, no methods, no hidden brand. It survives `JSON.stringify` and crosses process boundaries intact.
- **Zero dependencies.** No runtime dependencies, no peer dependencies.
- **Two surfaces, one implementation.** A fluent wrapper for ergonomics, and a free-function core for bundle size. The wrapper delegates to the core; it is not a second codebase.
- **Genuinely tree-shakable.** Import three functions and ship three functions. The fluent wrapper lives behind a separate entrypoint, so it costs nothing unless you import it.

```ts
import { ok } from '@zireal/result-kit/fluent';

const greeting = ok(user)
  .map((u) => u.name)
  .match({ ok: (name) => `Hello, ${name}`, err: () => 'Hello, stranger' });
```

> **Upgrading from 1.x?** See [`MIGRATION.md`](MIGRATION.md). It is a full rework — most names moved, and one of them (`unwrapOrThrow`) breaks *silently*.
>
> **Adopting it in a real codebase?** [`RECIPES.md`](RECIPES.md) covers the patterns that come up first: gradual adoption alongside throwing code, mapping to HTTP, testing, and the one type gotcha to know about.

---

## Installation

```bash
pnpm add @zireal/result-kit
```

| Requirement | Version |
|---|---|
| Node | `>=22.12` |
| TypeScript | `>=6.0` |
| Module format | **ESM only** — no CJS build |

`moduleResolution` must be `"bundler"`, `"node16"`, or `"nodenext"`. On CommonJS, load it with `require('@zireal/result-kit')` (Node 22.12+ supports requiring ESM) or `await import(...)`.

---

## The two surfaces

Both are first-class and fully supported. Pick per project, or mix per file.

| | `@zireal/result-kit/fluent` | `@zireal/result-kit` |
|---|---|---|
| Style | chained methods | free functions |
| Reads like | `ok(x).map(f).unwrapOr(0)` | `unwrapOr(map(ok(x), f), 0)` |
| Best for | application code, linear pipelines | libraries, hot paths, minimal bundles |
| Bundle cost | the wrapper class | only the functions you import |

**Start with `/fluent`.** It is the more comfortable surface and what most application code should use. Reach for the core when bundle size matters, or when you are writing a library and would rather not impose a wrapper on your callers.

The core is **self-sufficient** — it never needs `/fluent`. That is the point of the split, and it is something a class-based library structurally cannot offer, because there the methods and the data are the same object.

---

## Quick start

### The fluent surface

```ts
import { from } from '@zireal/result-kit/fluent';

const label = from(findUser('u1'))
  .map((user) => user.name)
  .mapErr((e) => e.message)
  .unwrapOr('anonymous');
```

`from(...)` lifts a plain `Result` into the wrapper; `.toResult()` takes you back out. **The plain union is the source of truth** — the wrapper is a transient envelope for the duration of a chain, not something to store or serialize.

### The core surface

The same thing, without the wrapper:

```ts
import { map, mapErr, unwrapOr } from '@zireal/result-kit';

const named = map(findUser('u1'), (user) => user.name);
const label = unwrapOr(mapErr(named, (e) => e.message), 'anonymous');
```

Read inside-out rather than left-to-right. If that nesting bothers you, that is exactly what `/fluent` and [`safeTry`](#do-notation) are for.

### Producing a `Result`

```ts
import { ok, err } from '@zireal/result-kit';
import type { Result } from '@zireal/result-kit';

function findUser(id: string): Result<User, NotFound> {
  const user = db.get(id);

  return user ? ok(user) : err({ type: 'not_found', message: `No user ${id}` });
}
```

### Async

One `await` at the front, a terminal at the end, no ceremony in between:

```ts
import { ResultAsync } from '@zireal/result-kit/fluent';

const name = await ResultAsync.from(loadUser(id))
  .andThen(requireActive)
  .map((user) => user.name)
  .match({ ok: (n) => n, err: () => 'anonymous' });
```

`ResultAsync` implements `PromiseLike`, so `await resultAsync` gives you the plain `Result` — awaiting *is* the sanctioned way out. It also means a floating un-`await`ed chain is caught by the standard `no-floating-promises` lint rule, for free.

In the core, async is just `Promise<Result<T, E>>`. There is no new type, and no `Async`-suffixed twin of anything — the transforms take a value or a promise in the same signature:

```ts
const upper = await map(loadUser(id), (user) => user.name.toUpperCase());
```

---

## Core concepts

### `Result<T, E>`

```ts
type Result<T, E> = Ok<T> | Err<E>;

interface Ok<T>  { readonly ok: true;  readonly value: T }
interface Err<E> { readonly ok: false; readonly error: E }
```

Purely structural — there is no brand. Any `{ ok: true, value }` **is** an `Ok<T>`, whoever built it. That is a deliberate guarantee rather than an accident: it is what lets a `Result` round-trip through JSON, cross an HTTP boundary, or come back from a worker and still be a `Result`.

```ts
const parsed = JSON.parse(JSON.stringify(result)); // still a usable Result
```

Three caveats on that round-trip:

- A `cause` may hold something non-serializable.
- Exit the fluent wrapper first — serialize `chain.toResult()`, not the chain.
- **`ok()` with no argument does not survive it.** The value is `{ ok: true, value: undefined }` — two fields, as always — but `JSON.stringify` omits an `undefined` property, so it round-trips to `{ ok: true }` and the `value` key is *gone*, not `undefined`. Code doing `'value' in parsed` will be surprised; `parsed.value` still reads `undefined` and is usually fine.

### Narrowing

`isOk` / `isErr` are type predicates, so the field access after them is checked:

```ts
import { isOk } from '@zireal/result-kit';

if (isOk(result)) {
  result.value;   // T
} else {
  result.error;   // E
}
```

On the fluent side, `.isOk()` / `.isErr()` return **plain booleans** and buy you no narrowing — a method cannot emit a predicate about its own class's generics. Narrow with `.match()` or a terminal instead, or leave the wrapper with `.toResult()` first.

---

## API

### Root — `@zireal/result-kit`

**Constructors and guards**

| | |
|---|---|
| `ok(value)` / `ok()` | Build an `Ok`. The no-arg form is for `Result<void, E>` |
| `err(error)` | Build an `Err` |
| `isOk(r)` / `isErr(r)` | Type-predicate guards |
| `isTypedError(e)` | Whether a value follows the `TypedError` convention |
| `defineError(type, message)` | Build a typed-error constructor — see [below](#structured-errors) |
| `defineErrors(registry)` | Group constructors so their union derives with `ErrorsOf` — see [below](#structured-errors) |

**Transforms** — each takes a `Result` *or* a `Promise<Result>`

| | |
|---|---|
| `map(r, fn)` | Transform the value; pass `Err` through |
| `mapErr(r, fn)` | Transform the error; pass `Ok` through |
| `andThen(r, fn)` | Chain a fallible step; accumulates the error channel to `E \| F` |
| `orElse(r, fn)` | Recover from an error |
| `inspect(r, fn)` / `inspectErr(r, fn)` | Tee one side for a side effect; returns the input unchanged |

**Terminals** — these leave the `Result` world

| | |
|---|---|
| `match(r, { ok, err })` | Collapse both branches to one value. Exhaustive by construction |
| `unwrapOr(r, default)` | The value, or a fallback |
| `unwrapOrElse(r, fn)` | The value, or a fallback computed from the error |
| `unwrapOrThrow(r, message?)` | The value, or **throw** a real `Error` with the original in `cause` |
| `toNullable(r)` | The value, or `null` |

**Collections**

| | |
|---|---|
| `combine(results)` | All-or-nothing; preserves the tuple type. First `Err` wins |
| `combineWithAllErrors(results)` | Same, but collects *every* error into an array |
| `partition(results)` | Split into `[values, errors]` — both halves, always |

**Formatters** — presentation over the `TypedError[]` that `combineWithAllErrors` accumulates

| | |
|---|---|
| `groupByType(errors)` | Group by the `type` discriminant; each group keeps its narrowed variant |
| `prettifyErrors(errors)` | One `✖ type: message` line per error |

**Interop**

| | |
|---|---|
| `fromNullable(value, error)` | `null` / `undefined` becomes an `Err` |
| `fromPredicate(value, pred, error)` | Narrows `T` when `pred` is a type guard |
| `fromThrowable(fn, onThrow)` | Wrap a throwing function into a `Result`-returning one |
| `fromPromise(promise, onReject)` | Catch a **rejection** into the error channel |
| `fromThrowableAsync(fn, onReject)` | The lazy, reusable form of `fromPromise` |

**Do-notation** — `safeTry`, `safeUnwrap`. See [below](#do-notation).

**Types** — `Result` `Ok` `Err` `TypedError` `ErrorCtor` `ErrorsOf` `OkTypeOf` `ErrTypeOf`

### `/fluent` — `@zireal/result-kit/fluent`

Exports `ok` `err` `from` `safeTry` `fromPromise` `fromThrowableAsync` `ResultAsync`, plus the `ResultChain` type.

`ok` / `err` / `safeTry` / `fromPromise` / `fromThrowableAsync` exist at **both** entrypoints under the same names — the root's return plain data, these return wrappers. That is deliberate: you should not have to learn two vocabularies.

**`ResultChain<T, E>`** mirrors the core one-to-one: `.map()` `.mapErr()` `.andThen()` `.orElse()` `.inspect()` `.inspectErr()` `.match()` `.unwrapOr()` `.unwrapOrElse()` `.unwrapOrThrow()` `.toNullable()` `.isOk()` `.isErr()` `.toResult()` `.toAsync()`.

**`ResultAsync<T, E>`** is `ResultChain` lifted — every value-terminal returns a `Promise`. Two deliberate differences: there is no `.isOk()` / `.isErr()` (an always-truthy `if (ra.isOk())` is a footgun, and narrowing needs the plain union anyway), and `.toJSON()` **throws** rather than silently serializing `{}` for a value that has not arrived yet.

**Array-shaped helpers stay root-only** — `combine`, `combineWithAllErrors`, `partition`, and the three sync constructors `fromNullable` / `fromPredicate` / `fromThrowable`. They take arrays or non-`Result` inputs, so there is no single instance for a method to hang off. Re-enter with `from(...)`:

```ts
from(combine([a, b])).map(sum).unwrapOr(0);
```

**Crossing from sync to async is explicit**, via `.toAsync()`:

```ts
ok(user).map(validate).toAsync().andThen(saveRemote).match({
  ok: (saved) => saved.id,
  err: (e) => e.message,
});
```

It is explicit on purpose. A settled `Result` cannot promise an asynchronous output — a transform that short-circuits never runs its callback at all, so on the `Err` branch there would be nothing to await.

---

## Do-notation

For flows where chaining gets awkward — branches, early exits, or a step needing a value from two steps back. Any `Err` exits the whole block:

```ts
import { ok, safeTry, safeUnwrap } from '@zireal/result-kit';

const total = safeTry(function* () {
  const user = yield* safeUnwrap(findUser(id));      // an Err here short-circuits
  const order = yield* safeUnwrap(loadOrder(user));  // each binds its own type

  return ok(user.credit + order.total);              // return a Result explicitly
});
```

The error channel accumulates — that block is `Result<number, NotFound | OrderMissing>`.

It works with promises too. Inside an `async function*`, a `Promise<Result>` unwraps with no `await`:

```ts
const total = await safeTry(async function* () {
  const user = yield* safeUnwrap(fetchUser(id));

  return ok(user.credit);
});
```

On `/fluent` there is **no `safeUnwrap`** — the wrappers are self-iterable, so you `yield*` them directly, and the block hands back a wrapper so the chain continues:

```ts
import { ok, safeTry, from } from '@zireal/result-kit/fluent';

const total = safeTry(function* () {
  const user = yield* from(findUser(id));

  return ok(user.credit);
}).unwrapOr(0);
```

> **Gotcha — returning a discriminated union from a `safeTry` body.** `return ok({ kind: 'noop' })` inside a generator widens `'noop'` to `string`, because the generator's return type is inferred before it is checked against your union. Pin the literal with `ok({ kind: 'noop' } satisfies MyUnion)` (or `as const`, or `ok<MyUnion>({ … })`). Full explanation and trade-offs in [`RECIPES.md`](RECIPES.md#discriminated-union-returns-widen-inside-safetry).

---

## Structured errors

`E` is fully generic — a `Result`'s error can be a string, an `Error`, or anything else. `TypedError` is an **opt-in** convention for when you want errors you can narrow on:

```ts
import { defineError, err } from '@zireal/result-kit';

const notFound = defineError('not_found', (d: { id: string }) => `No user ${d.id}`);
const forbidden = defineError('forbidden', 'Not permitted');

type AppError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>;

const failure = err(notFound({ id: 'u1' }));
//    ^? Err<TypedError<'not_found', { id: string }>>
```

Once you have more than a couple, group them with `defineErrors` and derive the union in one line with `ErrorsOf` instead of spelling out every `ReturnType`:

```ts
import { defineErrors } from '@zireal/result-kit';
import type { ErrorsOf } from '@zireal/result-kit';

export const appErrors = defineErrors({ notFound, forbidden });

export type AppError = ErrorsOf<typeof appErrors>;
//          ^? TypedError<'not_found', { id: string }> | TypedError<'forbidden', never>
```

`defineErrors` returns the object unchanged — its job is purely to type-check the bag, so a non-constructor entry is caught where you write it, not later. Each variant keeps its own payload, so a `switch (error.type)` still narrows exhaustively. The manual `ReturnType<typeof a> | …` form stays fully supported; reach for the registry when you want one named home for the set.

The values are plain objects — `{ type, message, details?, cause? }` — never classes, never `extends Error`. They serialize, and they narrow:

```ts
switch (error.type) {
  case 'not_found': return error.details?.id;
  case 'forbidden': return null;
}
```

Each constructor also carries `.type`, readable without building a value, and a `.is()` guard for narrowing a union at runtime.

### Presenting accumulated errors

`combineWithAllErrors` collects *every* failure rather than stopping at the first, which is the shape you want for form validation or a batch job. Two helpers turn that array into something you can use:

```ts
import { combineWithAllErrors, groupByType, prettifyErrors } from '@zireal/result-kit';

const combined = combineWithAllErrors([checkName(input), checkAge(input), checkEmail(input)]);

if (!combined.ok) {
  console.error(prettifyErrors(combined.error));
  // ✖ too_short: Name must be at least 2 characters
  // ✖ out_of_range: Age must be between 13 and 120

  const groups = groupByType(combined.error);
  groups.too_short?.forEach((e) => highlight(e.details?.field));
  //     ^? TooShort[] — the variant's own `details`, not the union's
}
```

`groupByType`'s keys are **optional**, because a variant that did not occur has no key — `groups.out_of_range` is `OutOfRange[] | undefined`. That is deliberate: typing an absent group as present would hand you `undefined` under a type promising an array.

`prettifyErrors` reads only `type` and `message`, never `details`. That is **not** a redaction guarantee, though: a variant whose message is computed from its payload (`(d) => \`No user ${d.id}\``) has already put that data in `message`. Keep anything sensitive out of `message` — no formatter can take it back out.

---

## Testing

A `Result` is plain data — never a class, never `extends Error` — so you assert on it with a structural `toEqual`, no custom matcher and no fighting `instanceof`:

```ts
expect(await changePlan(input)).toEqual(ok({ kind: 'noop' }));
expect(await changePlan(bad)).toEqual(err(missingBaseItem()));
```

To read `.value` (or `.error`) after asserting the branch, without `isOk`-guard boilerplate at each call site, use the built-in `expectOk` / `expectErr` — narrowing assertions that throw a descriptive error on the wrong branch:

```ts
import { expectOk, expectErr } from '@zireal/result-kit';

const value = expectOk(await loadPlan(id));
expect(value.items).toHaveLength(2);

const error = expectErr(await failingCall());
expect(error.type).toBe('not_found');
```

See [`RECIPES.md`](RECIPES.md#testing-code-that-returns-result) for the full testing recipe.

---

## Tree-shaking

The root entrypoint is a flat barrel of standalone functions and the package is marked `sideEffects: false`. Import `map` and you ship `map`.

The fluent wrapper lives behind `/fluent` and is **never** reachable from the root bundle. That boundary is enforced by an automated test which inspects the built output — not by convention, and not by review. If you never import `/fluent`, no wrapper code reaches your bundle.

---

## Documentation

- [`RECIPES.md`](RECIPES.md) — adoption patterns: gradual migration, HTTP mapping, testing, the `safeTry` widening gotcha.
- [`MIGRATION.md`](MIGRATION.md) — upgrading from 1.x.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.
- [`CONTEXT.md`](CONTEXT.md) — the project's vocabulary.
- [`docs/adr/`](docs/adr/) — the design decisions, and why they went the way they did.

## License

MIT © Ali Farooq
