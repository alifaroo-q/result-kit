# Migrating to `@zireal/result-kit` 5.0.0

5.0.0 is a full rework. The `Result` union itself is unchanged in shape — `{ ok: true, value }` / `{ ok: false, error }` — but almost every name around it moved, the static `ResultKit` toolbox is gone, and the package is now ESM-only.

**There is no codemod.** The [rename table](#2-rename-table) is the migration tool: it is written to be complete enough to drive a find-and-replace. Work top to bottom — the sections are ordered by how badly they break you, not by how interesting they are.

> ### ⚠️ Read [§5](#5-removed-entrypoints) before you finish
>
> One rename in this migration is **silent**: `unwrapOrThrow` exists in both versions, with different behaviour, and survives find-and-replace without a type error. If you used the NestJS adapter, that section is the one that matters most.

---

## 1. Before you start — the platform jump

**This outranks every rename below: it decides whether the package loads at all.**

| | v1 | 5.0.0 |
|---|---|---|
| Module format | dual ESM + CJS | **ESM-only** — no CJS build ships |
| Node | `>=20.0.0` | **`>=22.12`** |
| TypeScript | 5.x | **`>=6.0`** |
| Runtime dependencies | `fp-ts` | **none** |
| Peer dependencies | `@nestjs/common` (optional) | **none** |

### If you are on CommonJS

No `require()` build exists. Load it with either:

```js
// Node 22.12+ — synchronous require of an ESM graph
const { ok, err } = require('@zireal/result-kit');

// or, anywhere
const { ok, err } = await import('@zireal/result-kit');
```

The first works because Node 22.12 supports `require(esm)`. That is exactly why the floor is `22.12` and not `22.0`.

### TypeScript config

`moduleResolution` must be `"bundler"`, `"node16"`, or `"nodenext"`. The legacy `"node"` (Node10) resolution **cannot read the `exports` map** and will not find the types.

### `fp-ts` is no longer installed for you

v1 declared `fp-ts` as a real `dependency`, so it was on your disk whether you imported it or not. 5.0.0 has none. If your own code imports `fp-ts`, add it to your `package.json` yourself — this is the one break that can surface as a missing module in code that never touched this library's API.

---

## 2. Rename table

Every v1 name that still exists under a different name. Case-sensitive; the whole-word forms are what you want in a find-and-replace.

### Types

| v1 | 5.0.0 | Notes |
|---|---|---|
| `Success<T>` | `Ok<T>` | Shape unchanged: `{ readonly ok: true; readonly value: T }` |
| `Failure<E>` | `Err<E>` | Shape unchanged: `{ readonly ok: false; readonly error: E }` |
| `Result<T, E>` | `Result<T, E>` | **Unchanged** |
| `TypedError<TType>` | `TypedError<TType, TData>` | Same name; gained a second, optional type parameter for the `details` payload |
| `TypedErrorOf<TType>` | — | **Cut.** It was an alias for `TypedError<TType>`; use that |
| `TypedErrorUnion<TType>` | — | **Cut.** Build the union from `defineError` constructors: `ReturnType<typeof notFound> \| ReturnType<typeof forbidden>` |

### Constructors and guards

| v1 | 5.0.0 | Notes |
|---|---|---|
| `ResultKit.success(v)` | `ok(v)` | Also gains a no-arg `ok()` for `Result<void, E>` |
| `ResultKit.failure(e)` | `err(e)` | |
| `ResultKit.fail(typedError)` | `err(typedError)` | The separate typed-error constructor is gone — `err` takes any `E` |
| `ResultKit.isSuccess(r)` | `isOk(r)` | Still a type predicate |
| `ResultKit.isFailure(r)` | `isErr(r)` | Still a type predicate |
| `ResultKit.isTypedError(e)` | `isTypedError(e)` | Name unchanged; now a free function |

### Transforms and terminals

| v1 | 5.0.0 | Notes |
|---|---|---|
| `ResultKit.map` | `map` | |
| `ResultKit.mapError` | `mapErr` | **Renamed**, not just unnested |
| `ResultKit.andThen` | `andThen` | **Behaviour change** — see below |
| `ResultKit.orElse` | `orElse` | |
| `ResultKit.match` | `match` | **Key rename** — see below |
| `ResultKit.unwrapOr` | `unwrapOr` | |
| `ResultKit.unwrapOrElse` | `unwrapOrElse` | |
| `ResultKit.toNullable` | `toNullable` | |
| `ResultKit.combine` | `combine` | **Type change** — see below |
| `ResultKit.combineWithAllErrors` | `combineWithAllErrors` | **Type change** — tuple-preserving on the success side, exactly as `combine` is. The error side is still an array |
| `ResultKit.partition` | `partition` | |
| `ResultKit.fromNullable` | `fromNullable` | |
| `ResultKit.fromPredicate` | `fromPredicate` | Gained a type-guard overload (net-new capability) |
| `ResultKit.fromThrowable` | `fromThrowable` | |
| `ResultKit.fromThrowableAsync` | `fromThrowableAsync` | **Survives — do not delete it.** See the note in [§3](#3-what-was-cut) |
| `ResultKit.fromPromise` | `fromPromise` | |

### `match` — the cases object keys changed

```ts
// v1
ResultKit.match(result, {
  onSuccess: (value) => ...,
  onFailure: (error) => ...,
});

// 5.0.0
match(result, {
  ok: (value) => ...,
  err: (error) => ...,
});
```

> **Find-and-replace hazard.** `onSuccess` / `onFailure` were **also** the keys of v1's `tap` (and `tapAsync`, and both pipeline classes' `tap`), where they were optional. A blind `onSuccess` → `ok` replace will corrupt those call sites. `tap` has no object-form successor — it became `inspect` / `inspectErr`, which take a bare function. Migrate `tap` first ([§3](#3-what-was-cut)), then rename `match`'s keys.

### `andThen` now widens the error channel

```ts
// v1: fn had to return the SAME error type
static andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E>

// 5.0.0: the channels accumulate
andThen<T, U, E, F>(result: Result<T, E>, fn: (value: T) => Result<U, F>): Result<U, E | F>
```

This is strictly more permissive, so existing call sites keep compiling. What changes is the *inferred* error type: it is now a union. If you annotated an intermediate binding with a single error type, widen it. (v1's `ResultPipeline.andThen` already widened this way — only the static did not.)

### `combine` is now tuple-preserving

```ts
// v1: homogeneous array in, array out
static combine<T, E>(results: Result<T, E>[]): Result<T[], E>

// 5.0.0: heterogeneous tuple in, typed tuple out
combine<T extends readonly Result<unknown, unknown>[]>(results: readonly [...T]):
  Result<{ [K in keyof T]: OkTypeOf<T[K]> }, ErrTypeOf<T[number]>>
```

Passing an array still works and still gives you an array. The gain is that `combine([ok(1), ok('a')])` is now `Result<[number, string], never>` instead of `Result<(number | string)[], never>`.

---

## 3. What was cut

### The ten cut methods

| v1 | Replacement |
|---|---|
| `bimap(r, onOk, onErr)` | `mapErr(map(r, onOk), onErr)` |
| `flatten(r)` | `andThen(r, (x) => x)` |
| `unwrap(r)` → `T \| undefined` | `toNullable(r)` for value-or-empty; `unwrapOrThrow(r)` to throw. **See the `null` note below** |
| `unwrapSuccess(r)` | Field access after narrowing: `if (isOk(r)) r.value` |
| `unwrapFailure(r)` | Field access after narrowing: `if (isErr(r)) r.error` |
| `tap(r, { onSuccess, onFailure })` | `inspect(r, fn)` / `inspectErr(r, fn)` — one side each, bare functions |
| `filterSuccesses(rs)` | `partition(rs)[0]` |
| `filterFailures(rs)` | `partition(rs)[1]` |
| `pipe(x)` | See [§4](#4-pipe--pipeasync) |
| `pipeAsync(x)` | See [§4](#4-pipe--pipeasync) |
| `ResultPipeline<T, E>` | The type `pipe` returned. `ResultChain<T, E>` from `/fluent` — see [§4](#4-pipe--pipeasync) |
| `AsyncResultPipeline<T, E>` | The type `pipeAsync` returned. `ResultAsync<T, E>` from `/fluent` — see [§4](#4-pipe--pipeasync) |

> **`unwrap` → `toNullable` changes the empty value from `undefined` to `null`.** v1's `unwrap` returned `T | undefined`; `toNullable` returns `T | null`. A call site testing `=== undefined`, or using `??` against a `undefined`-specific branch, will silently stop matching. This is the one cut with a runtime behaviour difference rather than a compile error — `typeof x === 'undefined'` checks are worth grepping for.

### The `xAsync` doubles

All nine are gone. The transforms now take a value **or** a promise in the same signature, so the async twin has nothing left to do:

`mapAsync` · `mapErrorAsync` · `andThenAsync` · `orElseAsync` · `matchAsync` · `unwrapOrElseAsync` · `tapAsync` · `combineAsync` · `combineWithAllErrorsAsync`

```ts
// v1
const r = await ResultKit.mapAsync(result, async (v) => fetchName(v));

// 5.0.0 — same function, the overload absorbs it
const r = await map(result, async (v) => fetchName(v));
```

`pipeAsync` is also gone, as part of the `pipe` removal ([§4](#4-pipe--pipeasync)).

> **`fromThrowableAsync` is NOT cut** — despite the `Async` suffix. It survives in 5.0.0 and is exported from both entrypoints. It is not a double: it has no sync twin that absorbs it, because wrapping a *throwing async function* is a genuinely different job from wrapping a throwing sync one. Leave those call sites alone.

---

## 4. `pipe` / `pipeAsync`

`ResultKit.pipe` and `ResultKit.pipeAsync` — and the `ResultPipeline` / `AsyncResultPipeline` classes they returned — are removed. They were backed by `fp-ts` internally, which is the dependency 5.0.0 exists to shed.

**This is a per-site design call, not a substitution.** There are two successors and they suit different shapes; picking one mechanically will produce worse code than the original.

### Option A — the fluent wrapper, for a linear chain

Closest to what a pipeline looked like. Import from `/fluent`:

```ts
// v1
const total = ResultKit.pipe(findUser(id))
  .andThen((user) => loadOrder(user))
  .map((order) => order.total)
  .match({ onSuccess: (t) => t, onFailure: () => 0 });

// 5.0.0
import { from } from '@zireal/result-kit/fluent';

const total = from(findUser(id))
  .andThen(loadOrder)
  .map((order) => order.total)
  .match({ ok: (t) => t, err: () => 0 });
```

`.done()` becomes `.toResult()`. The async class becomes `ResultAsync`, reached explicitly:

```ts
// v1
const total = await ResultKit.pipeAsync(findUserRemote(id))
  .andThen((user) => loadOrderRemote(user))
  .match({ onSuccess: (o) => o.total, onFailure: () => 0 });

// 5.0.0
import { ResultAsync } from '@zireal/result-kit/fluent';

const total = await ResultAsync.from(findUserRemote(id))
  .andThen(loadOrderRemote)
  .match({ ok: (o) => o.total, err: () => 0 });
```

> **`pipeAsync` accepted four input shapes** — a bare value, a promise, a `Result`, or a promise of one — and sniffed at runtime. The replacements are explicit instead: `ResultAsync.from(promiseOfResult)` for a promise that is already a `Result`, `fromPromise(rawPromise, onReject)` for one that can reject, and `.toAsync()` on a `ResultChain` you already hold. Pick per call site; there is no single drop-in.

### Option B — `safeTry`, when the steps are not a straight line

If the pipeline had branching, early returns, or steps that needed an earlier value, do-notation reads better than a chain — each step binds a name, and any `Err` exits the block:

```ts
import { ok, safeTry, safeUnwrap } from '@zireal/result-kit';

const total = safeTry(function* () {
  const user = yield* safeUnwrap(findUser(id));
  const order = yield* safeUnwrap(loadOrder(user));

  // a branch a chain could not express without nesting
  if (order.total > user.credit) return err(overdrawn({ short: order.total - user.credit }));

  return ok(user.credit + order.total);
});
```

**Rule of thumb:** a chain where every step feeds only the next one → Option A. Anything that needed an intermediate binding, a conditional, or two values at once → Option B.

---

## 5. Removed entrypoints

Three subpaths are gone. Only the root `.` and `./fluent` remain.

### `@zireal/result-kit/core` → `@zireal/result-kit`

**The easiest one to miss.** In v1, `src/index.ts` was just `export * from './core'` — the root and `/core` exposed an *identical* surface, so many codebases used them interchangeably.

Only the **specifier** is a find-and-replace, though. What you were importing from it — `ResultKit`, `ResultPipeline`, `AsyncResultPipeline`, `Success` / `Failure` — moved too, so each call site still needs the rest of this guide:

```diff
- import { ResultKit } from '@zireal/result-kit/core';
+ import { ok, err } from '@zireal/result-kit';
```

### `@zireal/result-kit/fp-ts` → convert at your own boundary

Removed with no replacement, and no `fp-ts` devDependency is retained to typecheck one. It provided `toEither`, `fromEither`, `toTaskEither`, `fromTaskEither`. Note the argument order flips — `Result<T, E>` ↔ `Either<E, T>`:

```ts
import { err, isOk, ok } from '@zireal/result-kit';
import type { Result } from '@zireal/result-kit';
import { isRight, left, right } from 'fp-ts/Either';
import type { Either } from 'fp-ts/Either';

const toEither = <T, E>(r: Result<T, E>): Either<E, T> =>
  isOk(r) ? right(r.value) : left(r.error);

const fromEither = <T, E>(e: Either<E, T>): Result<T, E> =>
  isRight(e) ? ok(e.right) : err(e.left);
```

For `toTaskEither`, remember v1 accepted **either a promise or a thunk returning one**; a replacement needs to handle whichever form your call sites use. `fromTaskEither` is `async (te) => fromEither(await te())`.

### `@zireal/result-kit/nest` → map to HTTP yourself

Removed with no replacement. It provided `toHttpException`, `unwrapOrThrow`, `unwrapPromise`, and the `HttpExceptionDescriptor` / `NestErrorOptions` types. Map a `Result` to HTTP in your own exception filter or interceptor — this library no longer takes an opinion on your framework.

> ### ⚠️ The `unwrapOrThrow` collision — the migration's only silent breakage
>
> | | v1 `/nest` `unwrapOrThrow` | 5.0.0 core `unwrapOrThrow` |
> |---|---|---|
> | Signature | `(result, options?: NestErrorOptions<E>)` | `(result, message?: string)` |
> | Throws | a NestJS **`HttpException`** | a plain **`Error`**, with the original in `cause` |
> | Purpose | HTTP boundary mapping | an honest extractor |
>
> **The name survives find-and-replace, still typechecks, and silently stops producing HTTP responses.**
>
> Both take a `Result` first and an optional second argument. Delete the `/nest` import, let your editor auto-import `unwrapOrThrow` from the root, and you get code that compiles cleanly and throws a plain `Error` where it used to throw a `404`. Nest's default filter turns that into a `500` — so a handled not-found becomes an unhandled server error, in production, with no compile-time signal.
>
> Every other break in this migration is loud: a missing export, or a type error. **This one is not.** Grep for `unwrapOrThrow` before you finish, and check each call site for whether it was doing HTTP mapping.
>
> The v1 behaviour, if you need to reimplement it: `toHttpException` resolved in order — `options.mapError` returning an `HttpException` (used as-is) or a descriptor (built into one); an `error` already `instanceof HttpException`; a `TypedError` (→ `InternalServerErrorException` with the `type` upper-snake-cased as `code`); an `Error` (→ its `message`); then a fallback.

---

## 6. Net-new in 5.0.0

Most of this has no v1 equivalent, so it is not a rename — and several items are why a migration is worth doing rather than merely survivable. (`partition` is the exception: it existed in v1, and is listed here only because it is now the single answer for what two separate filters used to do.)

| | What it gives you |
|---|---|
| **`/fluent` entrypoint** | `ResultChain` / `ResultAsync` — the chaining ergonomics of v1's pipelines, without `fp-ts`, and tree-shaken out entirely if you never import them |
| **`safeTry` / `safeUnwrap`** | Do-notation: flat, sequential code with `Err` short-circuiting. The closest thing to Rust's `?` |
| **`defineError`** | A factory binding a `type`, a typed `details` payload, and a default message — replacing hand-written `TypedError` object literals |
| **`unwrapOrThrow`** | An honest extractor that throws a real `Error` on `Err`. **Not** v1's `/nest` function — see the warning above |
| **`inspect` / `inspectErr`** | One-sided tees, replacing `tap`'s two-optional-handlers object |
| **`fromPredicate` type-guard overload** | Narrows `T` when the predicate is a type guard |
| **`ok()` no-arg overload** | For the `Result<void, E>` case |
| **`partition`** | Present in v1, but now the documented single answer for what `filterSuccesses` / `filterFailures` did separately |
| **`groupByType` / `prettifyErrors`** | Presentation over the `TypedError[]` that `combineWithAllErrors` accumulates — group by discriminant (keeping each variant's narrowed type), or render one `✖ type: message` line per error |

---

## Getting help

- [`README.md`](README.md) — the 5.0.0 API surface and usage.
- [`CHANGELOG.md`](CHANGELOG.md) — release history. The `5.0.0` entry explains why the version jumps from 1.x straight to 5: `2.0.0`–`4.0.0` were published briefly and unpublished, and npm retires a version number permanently, so `5.0.0` is the only release above every stale `^2` / `^3` / `^4` range.
- [Issues](https://github.com/alifaroo-q/result-kit/issues) — if a rename in this table turns out to be wrong or incomplete, that is a bug in the migration tool. Please report it.
