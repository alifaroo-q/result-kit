# Recipes

Task-oriented patterns for using `@zireal/result-kit` in a real codebase. For the API reference and concepts, see [README.md](README.md); for upgrading from 1.x, see [MIGRATION.md](MIGRATION.md).

- [Discriminated-union returns widen inside `safeTry`](#discriminated-union-returns-widen-inside-safetry)
- [Adopting `Result` in a codebase that throws](#adopting-result-in-a-codebase-that-throws)
- [Mapping a `Result` to an HTTP response](#mapping-a-result-to-an-http-response)
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

The core takes no opinion on your framework (the 1.x `/nest` adapter was removed). Map at the boundary with a small function you own. Keep the mapping in your app, not in the error shape — a `TypedError` is exactly `{ type, message, details?, cause? }`, and adding a top-level `status` field breaks its JSON round-trip contract. Switch on the discriminant instead:

```ts
import { isErr } from '@zireal/result-kit';

function errToStatus(error: BillingError): number {
  switch (error.type) {
    case 'plan_not_found':
      return 404;
    case 'missing_company_id':
      return 422;
    default:
      return 400;
  }
}

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

If a status code is genuinely *intrinsic* to an error (not a presentation choice), carry it inside the typed payload — `details.status` — rather than at the top level, so the four-field shape and its serializability are preserved.

---

## Testing code that returns `Result`

Because a `Result` is plain data — never a class, never `extends Error` — you assert on it with a structural `toEqual`, with no custom matcher and no fighting `instanceof`:

```ts
import { ok, err, defineError } from '@zireal/result-kit';

const missingBaseItem = defineError('missing_base_item', 'subscription has no base_* item');

expect(await changeSubscriptionPlan(input)).toEqual(ok({ kind: 'noop' }));
expect(await changeSubscriptionPlan(bad)).toEqual(err(missingBaseItem()));
```

To read `.value` after asserting success without `isOk`-guard boilerplate at every call site, a one-line userland helper narrows and throws a helpful message on the wrong branch:

```ts
import { isOk } from '@zireal/result-kit';
import type { Result } from '@zireal/result-kit';

function expectOk<T, E>(result: Result<T, E>): T {
  if (!isOk(result)) {
    throw new Error(`expected Ok, got Err: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// then:
const value = expectOk(await loadPlan(id));
expect(value.items).toHaveLength(2);
```
