# Recipes

Task-oriented patterns for using `@zireal/result-kit` in a real codebase. For the API reference and concepts, see [README.md](README.md); for upgrading from 1.x, see [MIGRATION.md](MIGRATION.md).

- [Discriminated-union returns widen inside `safeTry`](#discriminated-union-returns-widen-inside-safetry)
- [Adopting `Result` in a codebase that throws](#adopting-result-in-a-codebase-that-throws)
- [Mapping a `Result` to an HTTP response](#mapping-a-result-to-an-http-response)
- [Sending a `Result` across a server/client boundary](#sending-a-result-across-a-serverclient-boundary)
- [Testing code that returns `Result`](#testing-code-that-returns-result)

---

## Discriminated-union returns widen inside `safeTry`

When you `return ok({ ... })` **inside a `safeTry` generator body**, a bare object literal widens its string-literal fields, and the result no longer matches your union:

```ts
type PlanChange =
  | { kind: 'upgrade'; effectiveAt: null }
  | { kind: 'noop' };

function changePlan(): Result<PlanChange, BillingError> {
  return safeTry(function* () {
    // ...
    return ok({ kind: 'noop' });
    //         ^ inferred Ok<{ kind: string }> — 'noop' widened to string.
    //           Result<{ kind: string }, …> is not assignable to Result<PlanChange, …>
  });
}
```

**Why this happens here and not elsewhere.** A generator's return type is inferred *bottom-up* from its `return` expressions and only then checked against the surrounding type, so the enclosing `Result<PlanChange, …>` never flows back into the `ok(...)` call as a contextual type. Widening happens at the `ok(...)` call site, and inside a generator there is nothing there to stop it. (Outside a generator — e.g. `return ok({ kind: 'noop' })` from a function with a declared `Result<PlanChange, E>` return type — the return type *does* flow in, and there is no widening.)

No signature on `ok` or `safeTry` can fix this, because the widening precedes the check. Fix it at the literal instead. Three options, all verified against TypeScript 5.x / `tsgo`:

### 1. `satisfies YourUnion` — recommended default

```ts
return ok({ kind: 'noop' } satisfies PlanChange);
```

`satisfies` gives the literal a contextual type (killing the widening) **without** making anything `readonly`. Prefer it when a payload anywhere in your unions contains an array or an otherwise-mutable field — see the caveat on `as const` below.

### 2. `as const` — terse, for flat unions only

```ts
return ok({ kind: 'noop' } as const);
```

Cleanest when the payload is flat. **Caveat:** `as const` is deep — it also makes nested arrays and objects `readonly`, so `ok({ items } as const)` yields `readonly Item[]`, which will not assign to a consumer expecting `Item[]`. Reach for `satisfies` when that bites.

### 3. Explicit type argument

```ts
return ok<PlanChange>({ kind: 'noop' });
```

Most explicit, most verbose. Handy when you'd rather name the type at the call than at the value.

---

## Adopting `Result` in a codebase that throws

You do not have to convert a whole codebase at once. `Result` interoperates cleanly with throwing code in both directions, so you can flip one function at a time (a "strangler" migration).

**`unwrapOrThrow` is the boundary adapter.** Convert a leaf function to return a `Result`, and let callers you haven't converted yet keep their throwing contract:

```ts
import { unwrapOrThrow } from '@zireal/result-kit';

// Newly converted — returns a Result.
async function changeSubscriptionPlan(input: Input): Promise<Result<PlanChange, BillingError>> {
  // ...
}

// A throwing wrapper for callers not yet converted. One line, one leaf.
async function changeSubscriptionPlanOrThrow(input: Input): Promise<PlanChange> {
  return unwrapOrThrow(await changeSubscriptionPlan(input));
}
```

`unwrapOrThrow` returns the value on `Ok`, and on `Err` throws a real `Error` carrying the original error in `cause`, so nothing is lost at the boundary. Point your still-throwing callers at the `…OrThrow` wrapper; point converted callers at the `Result`-returning function. Delete the wrapper when the last throwing caller is gone.

> ⚠️ If you are coming from the 1.x `/nest` adapter, `unwrapOrThrow` is a **silent** behavioural change — it now throws a plain `Error`, not an HTTP exception. See the collision warning in [MIGRATION.md](MIGRATION.md#the-unwraporthrow-collision--the-migrations-only-silent-breakage).

Going the other way — wrapping a throwing dependency *into* a `Result` — use `fromThrowable` / `fromPromise` (see the README's Interop section).

---

## Mapping a `Result` to an HTTP response

The core takes no opinion on your framework (the 1.x `/nest` adapter was removed). Map at the boundary with a small function you own. Keep the mapping in your app, not in the error shape — a `TypedError` is exactly `{ type, message, details?, cause? }`, and adding a top-level `status` field breaks its JSON round-trip contract. Dispatch on the discriminant instead:

```ts
import { isErr, matchType } from '@zireal/result-kit';

const errToStatus = (error: BillingError): number =>
  matchType(error, {
    plan_not_found: () => 404,
    missing_company_id: () => 422,
    missing_base_item: () => 409,
    missing_swap_item: () => 409,
  });

// Next.js Route Handler
export async function POST(req: Request) {
  const result = await changeSubscriptionPlan(await req.json());

  if (isErr(result)) {
    return Response.json(
      { error: result.error.message, type: result.error.type },
      { status: errToStatus(result.error) },
    );
  }

  return Response.json(result.value);
}
```

`matchType` is exhaustive by construction, which is the point here: add a variant to `BillingError` and this mapping stops compiling until you give it a status. A `switch` with a `default: return 400` looks tidier and quietly maps every new error to `400` forever.

When you genuinely do want a catch-all, pass it as a **third argument** rather than a `default` branch — it is typed to the variants you left out, so you can still see what is landing there:

```ts
const errToStatus = (error: BillingError): number =>
  matchType(error, { plan_not_found: () => 404, missing_company_id: () => 422 }, (e) => {
    logger.warn({ type: e.type }, 'unmapped billing error');
    //             ^? the leftover variants only
    return 400;
  });
```

If a status code is genuinely *intrinsic* to an error (not a presentation choice), carry it inside the typed payload — `details.status` — rather than at the top level, so the four-field shape and its serializability are preserved.

---

## Sending a `Result` across a server/client boundary

A `Result` is plain data, so it survives `JSON.stringify` and arrives on the far side **still a `Result`** — which means a server can return `err(...)` and a client can narrow it with the same typed union, with no envelope format, no status-code encoding and no codegen step in between. This recipe is the whole of that pattern.

Every snippet here is quoted from [`examples/wire.ts`](examples/wire.ts), which is type-checked by `pnpm check`. Claims about types surviving a boundary should compile.

### The shape: one contract, one server function, two clients

Start with a module **both sides import**. Not a copy on each side, not a generated mirror — the same declarations:

```ts
// contract.ts
export const BookingInput = z.object({ seatId: z.string().min(1), passengerEmail: z.email() });

const seatTaken = defineError('seat_taken', (d: { seatId: string }) => `Seat ${d.seatId} is already booked`);
const flightClosed = defineError('flight_closed', 'Check-in has closed for this flight');

export const bookingErrors = defineErrors({ seatTaken, flightClosed });
export type BookingError = ErrorsOf<typeof bookingErrors> | ValidationFailed;
```

`ValidationFailed` belongs in that union. Validation runs server-side and its failure is reported like every other failure — one error channel, rather than a separate "bad request" path the client has to remember to check.

Then one server function, returning a `Result` and throwing nothing:

```ts
export async function createBooking(input: unknown): Promise<Result<Booking, BookingError>> {
  const parsed = parseBookingInput(input);      // fromSchema(BookingInput)
  if (isErr(parsed)) return parsed;

  const { seatId } = parsed.value;
  if (TAKEN_SEATS.has(seatId)) return err(bookingErrors.seatTaken({ seatId }));

  return ok({ id: 'bk_1', seatId });
}
```

It takes `unknown` because `unknown` is what actually arrives at a boundary. Validating before trusting is the entire reason the input crosses through [`fromSchema`](README.md#validation--fromschema) rather than a cast.

### Transport 1 — the type crosses with the value

A Next.js server action, a typed RPC client, tRPC, a typed worker channel. The transport carries the *return type* along with the value, so the client already has `Result<Booking, BookingError>` and there is **no parse step**:

```ts
const result = await bookSeatAction(input);

return isOk(result) ? `Booked ${result.value.seatId}` : explain(result.error);
```

The action itself stays one line:

```ts
'use server';

import { createBooking } from './contract';

export async function bookSeatAction(input: unknown) {
  return createBooking(input);
}
```

**Keep it that thin deliberately.** Everything specific to the framework is the `'use server'` directive and the signature; the substance is a plain function that works identically in a route handler, a queue consumer and a unit test. It is also the only shape that survives you changing frameworks.

Rendering the failure is exhaustive, and the same function runs on either side because the error is plain data:

```ts
export function explain(error: BookingError): string {
  return matchType(error, {
    seat_taken: (e) => `Pick another seat — ${e.details?.seatId ?? 'that one'} is gone.`,
    flight_closed: (e) => e.message,
    validation_failed: (e) =>
      (e.details?.issues ?? []).map(({ path, message }) => `${path.join('.') || 'input'}: ${message}`).join('\n'),
  });
}
```

Add a variant to `BookingError` and this stops compiling until you give it a message — which is the point of returning a union rather than a string.

> **The parse step is only needed when the type is lost.** That is the hinge of this whole recipe, and it is why the next section looks different. One caveat on this transport: the client's type is a *compiler* promise, not a runtime check, so a version skew between deployed server and cached client can hand you a shape that does not match. `parseResult` below works here too if you want the guarantee; it is not the default because paying for it on every call buys nothing in the common case.

### Transport 2 — the type is lost

`fetch`, `postMessage`, a message queue. `response.json()` is `unknown`, and the return type did not come with it. Closing that gap with `as Result<Booking, BookingError>` is an assertion nothing verifies, on data you did not author — the exact lie the round-trip guarantee would otherwise be encouraging.

Prove it back instead, in two steps that stay separate on purpose:

```ts
const envelope = parseResult(await response.json());

// 1. The envelope: was this a `Result` at all? A proxy error page, a truncated
//    body and a gateway that rewrote the shape all land here — distinct from a
//    booking that legitimately failed.
if (isErr(envelope)) return `Bad response (${envelope.error.details?.reason})`;

const result = envelope.value;   // Result<unknown, unknown>

if (isErr(result)) return renderUnknownError(result.error);

// 2. The payload: `parseResult` leaves both halves `unknown` and takes no
//    generic, because the envelope is provable and what it carries is not.
const booking = parseBooking(result.value);

return isOk(booking) ? `Booked ${booking.value.seatId}` : 'Unrecognized booking';
```

The error half needs proving too, and a tag check is enough — the client only has to recognize the vocabulary it knows how to render:

```ts
function renderUnknownError(error: unknown): string {
  const isKnown =
    typeof error === 'object' && error !== null && 'type' in error &&
    (error.type === 'seat_taken' || error.type === 'flight_closed' || error.type === 'validation_failed');

  return isKnown ? explain(error as BookingError) : 'Booking failed';
}
```

### Two things that do not survive the trip

**`cause` may hold anything.** It is the one field in the four-field `TypedError` shape typed `unknown`, so it is the one route a non-serializable value takes into an otherwise JSON-safe `Result`.

This collides head-on with [`fromSchema`](README.md#validation--fromschema)'s `{ includeCause: true }`, and the wire is where the two features meet: that flag puts the **raw vendor issues** on `cause` — the rejected input included — so a cycle, a `BigInt` or a user's password can ride out in your response body. It is off by default for exactly this reason.

Strip it at the boundary, in the one function that serializes. This package will never mutate your error data to do it for you:

```ts
export function forTransport<T, E extends { readonly cause?: unknown }>(
  result: Result<T, E>,
): Result<T, Omit<E, 'cause'>> {
  if (isOk(result)) return result;

  const { cause: _dropped, ...rest } = result.error;

  return err(rest);
}
```

**`ok()` with no argument.** The value is `{ ok: true, value: undefined }` — two fields, as always — but `JSON.stringify` omits an `undefined` property, so it arrives as `{ ok: true }` with the `value` key *gone*, not `undefined`. `parseResult` accepts that shape deliberately (it is the output of the void-success form this package recommends). Code doing `'value' in parsed` will be surprised; `parsed.value` still reads `undefined` and is usually fine.

---

## Testing code that returns `Result`

Because a `Result` is plain data — never a class, never `extends Error` — you assert on it with a structural `toEqual`, with no custom matcher and no fighting `instanceof`:

```ts
import { ok, err, defineError } from '@zireal/result-kit';

const missingBaseItem = defineError('missing_base_item', 'subscription has no base_* item');

expect(await changeSubscriptionPlan(input)).toEqual(ok({ kind: 'noop' }));
expect(await changeSubscriptionPlan(bad)).toEqual(err(missingBaseItem()));
```

To read `.value` after asserting success without `isOk`-guard boilerplate at every call site, use the built-in `expectOk` / `expectErr` — narrowing assertions that throw a descriptive error on the wrong branch:

```ts
import { expectOk, expectErr } from '@zireal/result-kit';

const value = expectOk(await loadPlan(id));
expect(value.items).toHaveLength(2);

const error = expectErr(await failingCall());
expect(error.type).toBe('not_found');
```

### Matchers, if you are on Vitest

`@zireal/result-kit/testing` adds `toBeOk` / `toBeOkWith` / `toBeErr` / `toBeErrWith`. `vitest` is an *optional* peer dependency — declared, never installed on your behalf, and absent from the shipped chunk's imports.

```ts
// vitest.setup.ts
import { expect } from 'vitest';
import { resultMatchers } from '@zireal/result-kit/testing';

expect.extend(resultMatchers);
```

```ts
expect(await changeSubscriptionPlan(input)).toBeOkWith({ kind: 'noop' });
expect(await changeSubscriptionPlan(bad)).toBeErrWith(missingBaseItem());
expect(await changeSubscriptionPlan(bad)).toBeErrWith(
  expect.objectContaining({ type: 'missing_base_item' }),
);
```

Three things worth knowing before you reach for them:

- **They do not replace `toEqual`.** `expect(r).toEqual(err(missingBaseItem()))` is still correct and still reads well; the matchers buy a better failure message on the *wrong branch* — `Expected Ok, got Err: {…}` instead of a diff between two dissimilar objects.
- **They do not narrow.** A Vitest matcher cannot say anything about its subject's type, so `expectOk` / `expectErr` remain the way to read `.value` afterwards.
- **`toBeOkWith` / `toBeErrWith` are deep equality**, symmetric on both halves. Partial matching is Vitest's own `expect.objectContaining`, which they honour — there is no third matcher to learn.

On Jest, or on any other runner, `expectOk` / `expectErr` above are the supported path; the matchers are Vitest-only for now.
