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
> **Adopting it in a real codebase?** [`RECIPES.md`](RECIPES.md) covers the patterns that come up first: gradual adoption alongside throwing code, mapping to HTTP, sending typed errors across a server/client boundary, testing, and the one type gotcha to know about.

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

Both are first-class and fully supported. Pick per project, or mix per file. (A third entrypoint, [`/testing`](#vitest-matchers--zirealresult-kittesting), is test-only sugar rather than a way to write `Result` code.)

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

That property is load-bearing enough to have its own section — see [Across the wire](#across-the-wire) for what it buys, what to send it over, and the three things that do not survive the trip.

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

## Across the wire

Most error-handling libraries stop at the process boundary. A thrown `Error` does not serialize — `JSON.stringify(new Error('x'))` is `{}` — and a `Result` that is a **class instance** does not either: the methods are gone, `instanceof` is false, and what arrives is a bag of fields wearing the wrong type.

A `@zireal/result-kit` `Result` is [plain data by contract](#resultt-e), so it crosses intact and **stays a `Result`** on the other side. That turns the usual boundary ceremony — a status code, a bespoke `{ error: string }` envelope, a `try`/`catch` that flattens every failure to a message — into nothing at all: you return the value you already had.

```ts
// server
return err(seatTaken({ seatId }));

// client — the same union, narrowed
if (isErr(result)) matchType(result.error, { seat_taken: …, flight_closed: … });
```

**End-to-end typed errors, server to client, with no codegen step.** No generated client, no schema-to-type pipeline, no drift between the two: the client's types are the server's types because they are the same declarations.

The worked version of everything below is [`examples/wire.ts`](examples/wire.ts), which is type-checked by `pnpm check`.

### One pattern, two transports

The pattern is always the same — *return a `Result`, narrow it on the far side*. What differs is whether the **type** made the trip with the value.

**When the type crosses too** — a Next.js server action, a typed RPC client, tRPC, a typed worker channel — there is nothing to do. The client already has `Result<Booking, BookingError>` and narrows it directly:

```ts
const result = await bookSeat(input);

return isOk(result) ? `Booked ${result.value.seatId}` : explain(result.error);
```

Keep the framework-facing function **thin**. The action is a wrapper; the substance is an ordinary `Result`-returning function it calls:

```ts
'use server';

export async function bookSeatAction(input: unknown) {
  return createBooking(input);   // plain TypeScript, no framework in sight
}
```

That is not just tidiness. It is what keeps the pattern true on a route handler, a queue consumer and a test, without rewriting it — and it keeps your error logic out of the one file the framework owns.

**When the type is lost** — `fetch`, `postMessage`, a message queue — `response.json()` hands you `unknown`, and closing that gap with `as Result<T, E>` is an assertion nothing verifies on data you did not author. Prove it back instead, in two steps:

```ts
const envelope = parseResult(await response.json());
if (isErr(envelope)) return `Bad response (${envelope.error.details?.reason})`;

const result = envelope.value;        // Result<unknown, unknown> — envelope proven
if (isErr(result)) return renderError(result.error);

const booking = parseBooking(result.value);   // fromSchema — payload proven
```

[`parseResult`](#validating-re-entry--parseresult) proves the **envelope** and deliberately takes no generic; [`fromSchema`](#validation--fromschema) proves the **payload**. The envelope is provable and what it carries is not, so they are separate steps on purpose.

> One line worth knowing on the easy transport: a server action's return type is a *compiler* promise, not a runtime check. Across a version skew it can be wrong. `parseResult` is available there too if you want the belt as well as the braces — it is simply not the common case, and paying for it on every call is not the default worth teaching.

### The three things that do not survive

- **`cause` may hold anything.** It is the one field in the four-field [`TypedError`](#structured-errors) shape typed `unknown`, so it is the one route a non-serializable value takes into an otherwise JSON-safe `Result`. This collides head-on with [`fromSchema`](#validation--fromschema)'s `{ includeCause: true }`, which puts the **raw vendor issues** there — the rejected input included, so a cycle, a `BigInt` or a user's password can ride out in the response body. Strip `cause` at the boundary, in the one function that serializes. This package never mutates your error data to do it for you.
- **`ok()` with no argument.** The value is `{ ok: true, value: undefined }` — two fields, as always — but `JSON.stringify` omits an `undefined` property, so it arrives as `{ ok: true }` with the `value` key *gone*, not `undefined`. `parseResult` accepts that shape deliberately; code doing `'value' in parsed` will be surprised, while `parsed.value` still reads `undefined` and is usually fine.
- **The fluent wrapper.** Exit it first — serialize `chain.toResult()`, not the chain. The plain union is the interchange type; the wrapper is a transient envelope for the duration of a chain.

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

**Error matching** — dispatch over a `TypedError` union (see [below](#matching-on-the-error-type))

| | |
|---|---|
| `matchType(error, arms)` | One arm per variant, each narrowed. A missing arm is a compile error |
| `matchType(error, arms, fallback)` | Partial arms; the fallback sees only the **residual** variants |

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
| `fromSchema(schema, options?)` | Any [Standard Schema](https://standardschema.dev) validator becomes a `Result`-returning function |
| `fromSchemaAsync(schema, options?)` | The same, for a schema that validates asynchronously |
| `isResult(value)` | Type-predicate guard: is this `unknown` a `Result`? |
| `parseResult(value)` | The same check, with a typed error saying why it failed |

**Do-notation** — `safeTry`, `safeUnwrap`. See [below](#do-notation).

**Types** — `Result` `Ok` `Err` `TypedError` `ErrorCtor` `ErrorsOf` `OkTypeOf` `ErrTypeOf` `ValidationIssue` `ValidationFailed` `FromSchemaOptions` `MalformedResult` `MalformedResultReason`

#### Validation — `fromSchema`

Zod 4, Valibot, ArkType and Effect Schema all implement [Standard Schema v1](https://standardschema.dev), a **types-only** spec. So one adapter covers all of them, and the zero-dependency stance is untouched — there is no dependency to add.

```ts
import { fromSchema, isErr } from '@zireal/result-kit';

const parseUser = fromSchema(UserSchema);   // one wrap, many calls

const result = parseUser(await req.json()); // Result<User, ValidationFailed>
if (isErr(result)) {
  for (const { path, message } of result.error.details?.issues ?? []) {
    console.log(path.join('.'), message);   // "email", "invalid email"
  }
}
```

The error is a **single** `TypedError<'validation_failed', { issues }>` — one error channel, one error — so it composes with `matchType`, `groupByType` and `combineWithAllErrors` like every other typed error.

Each issue is normalized to the two fields Standard Schema *guarantees*: `message`, and `path` as an array (`[]` means the root). That keeps `details` **identical across vendors and provably JSON-safe**, which is what lets a validation error cross the wire under the [round-trip guarantee](#resultt-e). The price is deliberate and worth knowing: vendor extras — Zod's `code`, `expected`, `input` — are dropped, so you cannot branch on *what kind* of failure occurred from `details`. Pass `{ includeCause: true }` to keep the raw issues on `cause` for debugging; it is off by default because Zod attaches the rejected input, and an always-on `cause` would retain that payload inside a value people log by reflex.

One caveat worth knowing before you log an issue list: `issue.message` is the **vendor's own text, passed through untouched**, and some vendors embed the rejected value in it — Valibot's reads `Invalid email: Received "..."`. The `error.message` this package authors is a count and nothing else, precisely so the one field it controls cannot carry payload; the per-issue messages are not under that promise.

`fromSchema` is synchronous and **throws** if handed an async schema — the spec's own type says any schema *may* be async, so it cannot be caught at compile time. `fromSchemaAsync` accepts both, and is the one to reach for when you do not know statically which you have.

See [ADR 0015](docs/adr/0015-standard-schema-issue-mapping.md) for the full rationale.

#### Validating re-entry — `parseResult`

A `Result` leaves cleanly; `JSON.parse` hands it back as `unknown`. Without a check, that gap is closed with `as Result<T, E>` — an assertion nothing verifies, on data you did not author.

```ts
import { isErr, isOk, parseResult } from '@zireal/result-kit';

const parsed = parseResult(await response.json());

if (isErr(parsed)) {
  console.error(parsed.error.details?.reason); // 'not_an_object' | 'error_dropped' | …
  return;
}

const result = parsed.value;                  // Result<unknown, unknown>
if (isOk(result)) result.value;
```

The nesting is deliberate: the outer `Result` answers *was this a `Result` at all*, the inner one *did the operation succeed*. Collapsing them would make a corrupt envelope indistinguishable from a reported failure — the exact distinction the function exists to draw. Reach for `isResult` instead when you just want an `if`; it is the same check as a type predicate, with no diagnostic and no nesting.

**Both halves stay `unknown`, and there is no generic parameter.** `parseResult<User, E>(json)` would be the same unchecked assertion wearing a friendlier face — this proves the *envelope* and nothing about what it carries. Narrow the payload with [`fromSchema`](#validation--fromschema), or your own guard.

It validates and never rewrites: on success you get back **the same object**, extra properties and all — a `traceId` your gateway stamped onto the envelope rides through untouched, because §2's two-field rule governs what this package *builds*, not what it will look at.

Two rejections are worth knowing about, both about properties `JSON.stringify` drops:

- A round-tripped `ok()` is `{ ok: true }` with no `value` key, and it is **accepted** — it is the output of the form this package recommends for a void success.
- A bare `{ ok: false }` is **rejected**, with reason `'error_dropped'`. `err` has no no-arg form, so that shape only arises when a payload that is not JSON-serializable — `undefined`, a function, a symbol — was dropped in transit. Send `"error": null` for a failure with no detail. Accepting it would hand you an `Err` whose `.error` is `undefined`, which crashes `matchType`, `groupByType` and `prettifyErrors` one hop later.

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

### Matching on the error type

`switch (error.type)` narrows, but it is a *statement*, and it is not exhaustive-checked without a `never` helper in the default branch. `matchType` is the expression form, and exhaustiveness is the type — forget a variant and it does not compile:

```ts
import { matchType } from '@zireal/result-kit';

const status = matchType(error, {
  not_found: () => 404,
  forbidden: () => 403,
  conflict: (e) => (e.details!.slug ? 409 : 400),
});
//    ^? number — every arm's return type, unioned
```

Each arm receives its **own** variant, with its own payload: `conflict`'s `e.details` is `{ slug: string } | undefined`, and reaching for `e.details!.id` there is an error. Add a variant to the union later and every `matchType` call over it lights up until you handle it.

Not every call wants to enumerate everything. Pass a **fallback** as a third argument, and it sees only the variants you did not handle:

```ts
const status = matchType(error, { not_found: () => 404 }, (e) => {
  //                                                       ^? forbidden | conflict
  logUnexpected(e);
  return 500;
});
```

That residual narrowing is the reason for the third parameter rather than a `_` key inside the bag — a `_` sharing the object cannot be narrowed to the leftovers, and would hand you back the variants you just handled.

Two things worth knowing before you reach for it:

- **`details` stays optional.** Narrowing the tag does not make the payload non-optional, so arms read `e.details!.id`. That is a `TypedError` fact, not a `matchType` one.
- **Only a closed union can be exhausted.** A bare `TypedError` has an open `string` tag, so *any* set of arms satisfies it. Exhaustiveness needs a union of specific variants — the kind `ErrorsOf` or `ReturnType<typeof …> | …` gives you.

Coming from a `Result`, compose it under `match`:

```ts
const status = match(result, {
  ok: () => 200,
  err: (e) => matchType(e, { not_found: () => 404, forbidden: () => 403, conflict: () => 409 }),
});
```

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

### Vitest matchers — `@zireal/result-kit/testing`

An **optional** subpath with four `Result`-aware matchers. `vitest` is an optional peer dependency: it is never installed on your behalf, and nothing in your production bundle references it.

Register them once, in a setup file:

```ts
// vitest.setup.ts
import { expect } from 'vitest';
import { resultMatchers } from '@zireal/result-kit/testing';

expect.extend(resultMatchers);
```

Then:

```ts
expect(await loadPlan(id)).toBeOk();
expect(await loadPlan(id)).toBeOkWith({ kind: 'noop' });

expect(await loadPlan(bad)).toBeErr();
expect(await loadPlan(bad)).toBeErrWith(missingBaseItem());

// partial matching is vitest's own, not a separate matcher
expect(await loadPlan(bad)).toBeErrWith(
  expect.objectContaining({ type: 'missing_base_item' }),
);
```

Both `*With` matchers are **deep equality**, and a wrong-branch failure reports the branch you actually got — `Expected Ok, got Err: {"type":"missing_base_item",…}` — rather than a diff against the wrong half.

The matchers **assert**; they do not narrow, because a Vitest matcher cannot. Keep using `expectOk` / `expectErr` when you need the value afterwards.

See [`RECIPES.md`](RECIPES.md#testing-code-that-returns-result) for the full testing recipe.

---

## Tree-shaking

The root entrypoint is a flat barrel of standalone functions and the package is marked `sideEffects: false`. Import `map` and you ship `map`.

The fluent wrapper lives behind `/fluent` and is **never** reachable from the root bundle. That boundary is enforced by an automated test which inspects the built output — not by convention, and not by review. If you never import `/fluent`, no wrapper code reaches your bundle.

The same test covers `/testing`: no matcher code reaches the root bundle, and the shipped `/testing` chunk imports **no** bare specifier at all — so the optional `vitest` peer is never resolved by this package.

---

## Coding agents

If an LLM writes TypeScript in your repo, point it at the adoption kit. Both
files ship **inside the package**, so an agent can read them from
`node_modules/` with no network:

| File | What it is |
|---|---|
| [`llms.txt`](llms.txt) | A self-contained brief — the API, the `TypedError` convention, the gotchas. Paste it into a context window and the agent can write idiomatic code. |
| [`llms-full.txt`](llms-full.txt) | The long form: wire story, do-notation, `fromSchema`, recipes, migration, and the rationale behind the surprising decisions. |
| [`skills/using-result-kit/`](skills/using-result-kit/SKILL.md) | An [Agent Skill](https://code.claude.com/docs/en/skills) that loads on demand when the agent is actually writing `Result` code. |

```bash
# install the skill into your own repo
cp -r node_modules/@zireal/result-kit/skills/using-result-kit .claude/skills/
```

**Why this exists.** Models write `neverthrow` from training priors, and the two
libraries are close enough to look interchangeable — `result.map(f)` instead of
`map(result, f)`, `.match(okFn, errFn)` instead of `match(r, { ok, err })`,
`.isOk()` assumed to narrow when `/fluent`'s does not. The kit leads with an
explicit wrong→right table for exactly that reason.

## Documentation

- [`RECIPES.md`](RECIPES.md) — adoption patterns: gradual migration, HTTP mapping, testing, the `safeTry` widening gotcha.
- [`MIGRATION.md`](MIGRATION.md) — upgrading from 1.x.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.
- [`CONTEXT.md`](CONTEXT.md) — the project's vocabulary.
- [`docs/adr/`](docs/adr/) — the design decisions, and why they went the way they did.

## License

MIT © Ali Farooq
