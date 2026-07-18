# v5 TypedError + defineError Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the repo's available execution skill when one exists (for example, `/implement` or `executing-plans`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the locked `defineError` prototype into the package as `src/core/error.ts`, add the `isTypedError` base guard, and delete the prototype — so a consumer declares an error variant once and gets a constructor producing plain, serializable `TypedError` values with a typed `details` payload.

**Architecture:** `TypedError` is an **opt-in convention**, never mandated by the error channel — `E` in `Result<T, E>` stays fully generic and `err("not found")` / `err(new DomainError())` remain first-class. The signature is already locked by [ADR 0002 §4](../adr/0002-v2-typederror-model.md) and the [`prototype/define-error/`](../../prototype/define-error/README.md) battery ([#17](https://github.com/alifaroo-q/result-kit/issues/17)), so this ticket is a **port, not a design**. The one thing it must genuinely decide is the runtime payload disambiguation, which the prototype explicitly punted on — see *The one real decision* below.

**Tech Stack:** TypeScript 7.0.2 (or 6.0.3 if [#21](https://github.com/alifaroo-q/result-kit/issues/21) fell back) · Vitest 3.2.4 · tsdown · pnpm 11.9 · Node 24.17

**Ticket:** [#22](https://github.com/alifaroo-q/result-kit/issues/22) · **Spec:** [`docs/spec/v5-core-spec.md`](../spec/v5-core-spec.md) §3, §3.1, §3.2, §3.3, §5.1, §10.3 · **Decision:** [ADR 0002](../adr/0002-v2-typederror-model.md) · **Prototype:** [`prototype/define-error/`](../../prototype/define-error/README.md) · **Blocked by:** [#21](https://github.com/alifaroo-q/result-kit/issues/21)

---

## Prerequisites — what #21 left behind

This ticket is blocked by [#21](https://github.com/alifaroo-q/result-kit/issues/21) and assumes it merged. Before starting, confirm:

```bash
git checkout main && git pull
ls src/core/          # expect: result.ts only — v1's error.ts was deleted by #21
pnpm test             # expect: 22 passed across 2 files (18 result.spec.ts + 4 prototype)
pnpm check            # expect: exit 0, no output
```

If `pnpm test` reports anything else, stop — #21 has drifted and this plan's baseline is wrong.

**Read [#21](https://github.com/alifaroo-q/result-kit/issues/21)'s closing comment first** to learn whether the toolchain landed on TypeScript **7.0.2** or fell back to **6.0.3**. Nothing in this ticket depends on the difference — there are no generators or async iterators here — but the plan's expected `tsc` output assumes one of the two is installed and green.

## The one real decision — the prototype's runtime is broken, and the port must fix it

The prototype disambiguates its two call shapes by **sniffing the first argument's type at call time**:

```ts
// prototype/define-error/define-error.ts — the shipped-as-throwaway version
const hasPayload = first !== undefined && typeof first !== 'string';
```

Its own comment concedes this is *"Prototype-grade"* and that *"real code would not need this because the public type already forbids the wrong shape."* **That reasoning is wrong, and the bug is real.** The public type does **not** forbid a `string` payload: `ErrorCtor` types a payload variant as `(details: TData, message?: string)`, and nothing constrains `TData` to an object.

Verified against the prototype on 2026-07-15:

```ts
const bad = defineError.withData<string>()('bad', 'Static message');
bad('my-payload');
// EXPECTED: { type: 'bad', message: 'Static message', details: 'my-payload' }
// ACTUAL:   { type: 'bad', message: 'my-payload' }        ← details silently dropped
```

The payload is swallowed as the message override and `details` disappears. **It typechecks perfectly**, so the failure is silent — the worst kind. (`string[]` payloads happen to survive, because `typeof [] !== 'string'`; only `string` and string-union payloads are hit. A `details` of `string` is unusual but entirely legal, and "unusual but legal and silently wrong" is exactly what a port should not carry forward.)

**Decision: decide `hasPayload` once at *definition* time, never by sniffing call arguments.** It is knowable there, and the two entry points each know the answer for free:

| Definition form | `hasPayload` | Why it is known |
|---|---|---|
| `defineError(type, 'static string')` | `false` | A static message means `TData` takes its `void` default |
| `defineError(type, (d: X) => …)` | `true` | The message function's parameter **is** the payload declaration |
| `defineError.withData<X>()(type, …)` | `true` | `.withData` exists precisely to declare a payload |

This was verified before writing this plan: the fix makes the string-payload case correct **and** still passes the prototype's entire `callsites.ts` type battery at **exit 0** — every `Expect<Equal<…>>` and every `@ts-expect-error` still holds. **The public signature does not change at all**; ADR 0002 §4 and spec §3.1 are untouched. This is a pure runtime correction.

**Known limitation, accepted:** `defineError<'conflict', { id: string }>('conflict', 'Already exists')` — explicit type arguments, payload plus *static* message — would compute `hasPayload = false` and misbehave. That call shape is **exactly the one ADR 0002 §4 created `.withData` to replace**, describing it as the "all-or-nothing type-argument tax" and the shape "single-call can't infer". The prototype's sniffing happened to tolerate it; the definition-time flag does not. Accepted rather than worked around: supporting a call form the ADR explicitly rejected, at the cost of a real silent bug in a form it endorses, is the wrong trade. Task 4 documents this in the TSDoc.

## Assumptions

- **`isTypedError` keeps v1's runtime thoroughness.** Spec §5.1 and §10.3 fix its *signature* (`x is TypedError`, ADR 0002's form) but not its validation depth. v1 checked that `type` and `message` are strings and that `details`, when present, is a non-null non-array object. That is retained — it is what makes the guard's narrowing to `TypedError<string, Record<string, unknown>>` honest, since an array or `null` is not a `Record`.
- **`prototype/define-error/` is deleted by this ticket** (spec §9.3: "port from the prototype, then **delete the prototype** (it is throwaway)"). That removes 4 tests from `pnpm test`, so every count below accounts for it. The prototype's README records the verdict; ADR 0002 §4 already carries it, so nothing is lost.
- **The `.is()` guard is tag-only and stays that way.** It cannot validate the payload at runtime — that needs a schema (ADR 0002 §5). Task 5 asserts the limitation rather than hiding it.
- **`TypedError`'s interface default stays `TData = Record<string, unknown>` while the factory defaults `TData = void`.** This asymmetry is deliberate (spec §3.1 behaviour 4) and load-bearing: the interface default keeps a hand-written `TypedError<'not_found'>` behaving as it did in v1, while the factory default is what stops `Record<string, unknown>` leaking into no-payload variants.
- **No `cause` is set by the factory.** ADR 0002 §3 keeps `cause?: unknown` on the interface for ES2022-style chaining, but `defineError`'s constructors never populate it — a caller attaches it at the throw/catch site. No spec text asks the factory to.

## Type assertions — the same rule as #21

Carried forward from [`2026-07-15-v5-walking-skeleton.md`](./2026-07-15-v5-walking-skeleton.md), unchanged and re-verified for this ticket's assertions:

**`expectTypeOf` is enforced by `pnpm check` (`tsc --noEmit`), NOT by `pnpm test`.** `vitest.config.ts` sets no `typecheck`, so `expectTypeOf` is a **no-op** under `vitest run`; `tsconfig.json`'s `include` covers `test`, so `tsc` checks every spec file. A step saying "expect FAIL" for a type assertion means **`pnpm check` fails** — `pnpm test` may be green and prove nothing.

`@ts-expect-error` is a real assertion: `tsc` reports `Unused '@ts-expect-error' directive` (TS2578) when the expected error does not occur. This ticket leans on that heavily — **five** of its assertions are negative, and each was verified to fire for the intended reason rather than incidentally:

| Directive | The error it consumes |
|---|---|
| `forbidden({ id: '1' })` | `TS2345` — `{ id: string }` is not assignable to `string` |
| `defineError('timeout')` | `TS2554` — expected 2 arguments, got 1 |
| `notFound()` | `TS2554` — expected 1-2 arguments, got 0 |
| `notFound({ nope: 1 })` | `TS2353` — `'nope'` does not exist in `{ id: string }` |
| `defineError('bad', (d) => …)` | `TS2339` — `'id'` does not exist on type `void` |

That last one is the mechanism worth understanding: it fires on `void` — the factory's `TData` default — not on `noImplicitAny`. The unannotated parameter has nothing to infer from, so the payload stays `void`. That is what "the parameter annotation **is** the payload declaration" means concretely.

Both forms were verified against this exact code before writing: `expectTypeOf<ReturnType<typeof forbidden>>().toEqualTypeOf<TypedError<'forbidden', never>>()` compiles clean, and asserting `Record<string, unknown>` instead fails with `TS2344`. The no-leak test genuinely bites.

## File Structure

| Path | Action | Responsibility | Est. lines |
|---|---|---|---|
| `src/core/error.ts` | **Create** | `TypedError`, `ErrorCtor`, `defineError` (+ `.withData`), `isTypedError` | ~150 |
| `src/index.ts` | **Modify** | Add the four error exports to the flat barrel | +4 |
| `test/core/error.spec.ts` | **Create** | All 29 assertions | ~260 |
| `prototype/define-error/` | **Delete** | 4 files — throwaway, superseded by the port | — |

`src/core/error.ts` is one file at ~150 lines — under the 300-line split rule, and `TypedError` / `ErrorCtor` / `defineError` / `isTypedError` are one concept (spec §3 in its entirety). It sits beside `src/core/result.ts` following the per-spec-group layout #21 established.

**Tasks 1→5 all extend `src/core/error.ts` and `test/core/error.spec.ts`, so they are strictly sequential.** Task 2 introduces the shared `build` helper that Tasks 3–5 depend on. No task here can be parallelised.

## Task order

The prototype already de-risked the type-level design — that is why this ticket was pulled early, as the low-risk slice that proves the harness before the hard inference work in [#23](https://github.com/alifaroo-q/result-kit/issues/23) and [#24](https://github.com/alifaroo-q/result-kit/issues/24). So "riskiest first" resolves differently here:

1. **`TypedError` + `isTypedError` first** — a genuine dependency, not a preference: `ErrorCtor` references `TypedError` in its return type, so nothing else compiles without it.
2. **Task 2 carries this ticket's only real risk** — it introduces `build` with the definition-time `hasPayload` flag, the one thing the prototype did not settle.
3. **Task 4 is where the fix pays off** — the non-object payload test is the regression test for the bug documented above. If Task 2 is done wrong, Task 4 is where it surfaces.

---

### Task 0: Branch

- [ ] **Step 1: Cut a branch from `main`**

```bash
git checkout main && git pull
git checkout -b feat/v5-typed-error
```

- [ ] **Step 2: Confirm the baseline**

```bash
pnpm test && pnpm check
```
Expected: **22 passed across 2 files** (18 in `test/core/result.spec.ts`, 4 in `prototype/define-error/demo.test.ts`); `pnpm check` exits 0 silently.

If `pnpm test` dies with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.4`, `pnpm-workspace.yaml` has regressed to its placeholder — it must read `allowBuilds: { esbuild: true }`. See #21's Task 0 Step 2.

---

### Task 1: `TypedError` and the `isTypedError` base guard

**Files:**
- Create: `src/core/error.ts`
- Modify: `src/index.ts`
- Test: `test/core/error.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/core/error.spec.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';

import { isTypedError, type TypedError } from '../../src/index';

describe('TypedError', () => {
  // §3: a plain structural object — never a class, never `extends Error`.
  // Any matching literal IS a TypedError, which is what lets it ride inside a
  // Result across a serialization boundary.
  it('accepts a hand-built literal', () => {
    const e: TypedError<'not_found', { id: string }> = {
      type: 'not_found',
      message: 'User not found',
      details: { id: '123' },
    };
    expect(e).toEqual({ type: 'not_found', message: 'User not found', details: { id: '123' } });
  });

  it('is a plain object, never an Error instance', () => {
    const e: TypedError = { type: 'boom', message: 'Boom' };
    expect(e).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(e)).toBe(Object.prototype);
    expect('stack' in e).toBe(false);
  });

  // §2.1 carve-out: { type, message, details } is JSON-safe. `cause` is not,
  // and the caller sanitizes it — the core never silently strips it.
  it('round-trips type, message and details through JSON', () => {
    const e: TypedError<'not_found', { id: string }> = {
      type: 'not_found',
      message: 'User not found',
      details: { id: '123' },
    };
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});

describe('isTypedError', () => {
  it('narrows an unknown to the base shape', () => {
    const caught: unknown = { type: 'not_found', message: 'User not found' };
    if (!isTypedError(caught)) throw new Error('unreachable');
    expectTypeOf(caught).toEqualTypeOf<TypedError>();
    expect(caught.type).toBe('not_found');
    expect(caught.message).toBe('User not found');
  });

  it('accepts an error with no details', () => {
    expect(isTypedError({ type: 'forbidden', message: 'Access denied' })).toBe(true);
    expect(isTypedError({ type: 'forbidden', message: 'Access denied', details: undefined })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isTypedError(null)).toBe(false);
    expect(isTypedError(undefined)).toBe(false);
    expect(isTypedError('not_found')).toBe(false);
    expect(isTypedError(42)).toBe(false);
    expect(isTypedError(true)).toBe(false);
  });

  it('rejects a missing or non-string type', () => {
    expect(isTypedError({ message: 'no type' })).toBe(false);
    expect(isTypedError({ type: 42, message: 'numeric type' })).toBe(false);
  });

  it('rejects a missing or non-string message', () => {
    expect(isTypedError({ type: 'not_found' })).toBe(false);
    expect(isTypedError({ type: 'not_found', message: 42 })).toBe(false);
  });

  // details must be Record-like, because the guard narrows TData to the
  // interface default Record<string, unknown> — null and arrays are not.
  it('rejects details that are null or an array', () => {
    expect(isTypedError({ type: 't', message: 'm', details: null })).toBe(false);
    expect(isTypedError({ type: 't', message: 'm', details: ['a'] })).toBe(false);
    expect(isTypedError({ type: 't', message: 'm', details: { ok: true } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2305: Module '"../../src/index"' has no exported member 'isTypedError'` (and `'TypedError'`). **This is the red state.**

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **FAIL** — `does not provide an export named 'isTypedError'`. (Unlike #21's Task 2, this file imports a **value**, so vitest sees the red too.)

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/error.ts`:

```ts
/**
 * The opt-in structured-error convention.
 *
 * A plain object — **never a class, never `extends Error`**, no eager stack
 * capture. Errors are *values* narrowed with `switch (err.type)`, not exceptions
 * thrown. A consumer needing a real `Error` at a throw boundary constructs one
 * there, or carries the original in `cause`.
 *
 * `E` in `Result<T, E>` stays fully generic — this convention is never mandated
 * by the error channel. `err('not found')` and `err(new DomainError())` are
 * equally first-class.
 *
 * @typeParam TType - the discriminant, narrowed with `switch (err.type)`
 * @typeParam TData - the optional typed payload, nested under `details`
 */
export interface TypedError<
  TType extends string = string,
  TData = Record<string, unknown>,
> {
  /** Stable discriminant. Not a Node-style error `code`. */
  readonly type: TType;

  /** Guaranteed human-readable and loggable. Always present. */
  readonly message: string;

  /** Optional typed payload. Nested under one key — never spread onto the error. */
  readonly details?: TData;

  /**
   * ES2022-style cause chaining.
   *
   * **Outside the JSON round-trip guarantee.** `{ type, message, details }` is
   * JSON-safe; a populated `cause` may not be. Sanitize or drop it before
   * serializing — the core never silently mutates error data to strip it.
   */
  readonly cause?: unknown;
}

/**
 * Narrows a caught `unknown` (or a generic `E`) to the base {@link TypedError}
 * shape.
 *
 * Cannot validate a specific variant's payload — that needs a schema. For a
 * per-variant tag check, prefer the constructor's own `.is()`.
 */
export function isTypedError(x: unknown): x is TypedError {
  if (!x || typeof x !== 'object') {
    return false;
  }

  const candidate = x as { type?: unknown; message?: unknown; details?: unknown };

  if (typeof candidate.type !== 'string' || typeof candidate.message !== 'string') {
    return false;
  }

  // `details`, when present, must be Record-like: this guard narrows TData to
  // the interface default Record<string, unknown>, and null/arrays are not that.
  if (
    'details' in candidate &&
    candidate.details !== undefined &&
    (candidate.details === null ||
      typeof candidate.details !== 'object' ||
      Array.isArray(candidate.details))
  ) {
    return false;
  }

  return true;
}
```

Add to `src/index.ts`, keeping the barrel flat and alphabetical:

```ts
export { isTypedError, type TypedError } from './core/error';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **PASS — 9 tests**: `accepts a hand-built literal`, `is a plain object, never an Error instance`, `round-trips type, message and details through JSON`, `narrows an unknown to the base shape`, `accepts an error with no details`, `rejects non-objects`, `rejects a missing or non-string type`, `rejects a missing or non-string message`, `rejects details that are null or an array`.

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

- [ ] **Step 5: Commit**

```bash
git add src/core/error.ts src/index.ts test/core/error.spec.ts
git commit -m '`FEAT`: - adds the plain structural TypedError shape and the isTypedError base guard
  - keeps errors as serializable values narrowed on type rather than classes thrown as exceptions
  - documents the cause carve-out so callers sanitize it before crossing a JSON boundary'
```

---

### Task 2: `defineError` — the no-payload variant

**Depends on Task 1.** Introduces the shared `build` helper and **the definition-time `hasPayload` flag** — this ticket's one real decision. Read *The one real decision* above before writing any code here.

**Files:**
- Modify: `src/core/error.ts`, `src/index.ts`
- Test: `test/core/error.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/core/error.spec.ts`, adding `defineError` to the imports (a plain value import alongside the existing one).

> **The `typeOnly` idiom below is mandatory for every negative assertion in this file — read this before writing one.**
>
> **`@ts-expect-error` suppresses the *diagnostic*, not the *statement*.** The call still executes under `vitest run`. That is harmless for some of these (`defineError('timeout')` just builds a constructor) but fatal for others: `notFound()` with no payload runs the message function against `undefined` and throws `TypeError: Cannot read properties of undefined`. `tsc` stays perfectly green, so the suite goes red with no type-level clue why.
>
> Parking every forbidden call inside an **uninvoked closure** keeps the assertion where it belongs — type-level — while `tsc` still checks the body in full. The mutations in Tasks 3 and 5 still produce their `TS2578` exactly as specified. Use `void (() => { … });` uniformly, even where the call would be benign, so nobody has to work out case by case which negatives are safe to execute.

```ts
describe('defineError — no-payload variant', () => {
  const forbidden = defineError('forbidden', 'Access denied');

  it('builds from its default message', () => {
    expect(forbidden()).toEqual({ type: 'forbidden', message: 'Access denied' });
  });

  // No payload slot, so the message override is the FIRST positional.
  it('overrides the message with the first positional argument', () => {
    expect(forbidden('You may not')).toEqual({ type: 'forbidden', message: 'You may not' });
  });

  // §3: the shape stays exactly four fields, and `details` is absent —
  // not present-and-undefined. Object.keys is the honest check.
  it('omits details entirely', () => {
    expect(Object.keys(forbidden())).toEqual(['type', 'message']);
    expect('details' in forbidden()).toBe(false);
  });

  it('exposes the bound type without constructing a value', () => {
    expect(forbidden.type).toBe('forbidden');
    expectTypeOf(forbidden.type).toEqualTypeOf<'forbidden'>();
  });

  // §3.1 behaviour 4 — THE no-leak assertion. The factory defaults TData = void,
  // so an absent-payload variant is TypedError<T, never>, NOT the interface's
  // permissive Record<string, unknown> default.
  it('types the payload as never, not Record<string, unknown>', () => {
    expectTypeOf<ReturnType<typeof forbidden>>().toEqualTypeOf<TypedError<'forbidden', never>>();

    // Never invoked — the directive IS the assertion. See the typeOnly note above.
    void (() => {
      // @ts-expect-error — a no-payload variant takes no payload object
      forbidden({ id: '1' });
    });
  });

  // §3.1 behaviour 3 — message is always required at definition; there is no
  // silent fallback to the `type` string.
  it('requires a default message', () => {
    void (() => {
      // @ts-expect-error — a default message is mandatory
      defineError('timeout');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2305: Module '"../../src/index"' has no exported member 'defineError'`.

You will also see `TS2578: Unused '@ts-expect-error' directive` from the two negative assertions — expected, and they clear at Step 3 once `defineError` exists and the directives have a real error to swallow.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/core/error.ts`:

```ts
/** A default message: static, or derived from the payload (DRY, still overridable). */
type MessageArg<TData> = string | ((details: TData) => string);

/**
 * The constructor {@link defineError} returns.
 *
 * The call shape is **conditional on payload presence** — that is the whole
 * design. A no-payload variant takes the message first; a payload variant takes
 * the payload first.
 */
export type ErrorCtor<TType extends string, TData> = ([TData] extends [void]
  ? (message?: string) => TypedError<TType, never>
  : (details: TData, message?: string) => TypedError<TType, TData>) & {
  /** The bound discriminant, readable without constructing a value. */
  readonly type: TType;
  /** Tag-only per-variant guard. Does not validate the payload — that needs a schema. */
  is(x: unknown): x is TypedError<TType, [TData] extends [void] ? never : TData>;
};

/**
 * Shared constructor builder.
 *
 * `hasPayload` is decided ONCE at definition time and never re-derived from the
 * call arguments. This is deliberate and load-bearing: the prototype sniffed
 * `typeof first !== 'string'` per call, which silently swallowed any `string`
 * payload as the message override and dropped `details` entirely. The payload's
 * presence is knowable at definition, so it is decided there.
 */
function build<TType extends string, TData>(
  type: TType,
  defaultMessage: MessageArg<TData>,
  hasPayload: boolean,
): ErrorCtor<TType, TData> {
  const ctor = (first?: unknown, second?: string): TypedError<TType, TData> => {
    const payload = hasPayload ? (first as TData) : undefined;
    const override = hasPayload ? second : (first as string | undefined);
    const message =
      override ??
      (typeof defaultMessage === 'function'
        ? defaultMessage(payload as TData)
        : defaultMessage);

    return {
      type,
      message,
      ...(hasPayload ? { details: payload as TData } : {}),
    };
  };

  Object.assign(ctor, {
    type,
    is: (x: unknown): boolean =>
      !!x && typeof x === 'object' && (x as { type?: unknown }).type === type,
  });

  return ctor as unknown as ErrorCtor<TType, TData>;
}

function defineErrorBase<TType extends string, TData = void>(
  type: TType,
  defaultMessage: MessageArg<TData>,
): ErrorCtor<TType, TData> {
  // A message FUNCTION declares a payload (its parameter is the declaration).
  // A static STRING message means TData took its `void` default — no payload.
  return build(type, defaultMessage, typeof defaultMessage === 'function');
}
```

Do **not** export `defineError` yet — `.withData` is attached in Task 4, and exporting a half-built factory would let Task 4's red state pass. Add a temporary export of the base so Task 2's tests can run:

```ts
export const defineError = defineErrorBase;
```

Add to `src/index.ts`:

```ts
export { defineError, isTypedError, type ErrorCtor, type TypedError } from './core/error';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **PASS — 15 tests** (9 from Task 1 + 6 new: `builds from its default message`, `overrides the message with the first positional argument`, `omits details entirely`, `exposes the bound type without constructing a value`, `types the payload as never, not Record<string, unknown>`, `requires a default message`).

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

- [ ] **Step 5: Verify the no-leak assertion is real**

This is the assertion ADR 0002 §4 and spec §3.1 behaviour 4 both single out, so prove it bites. Temporarily change the factory's default from `void`:

```ts
function defineErrorBase<TType extends string, TData = Record<string, unknown>>(
```
Run `pnpm exec tsc --noEmit`.

Expected: **FAIL, loudly and in several places at once.** Every no-payload variant becomes a payload variant, so the errors cascade rather than landing on one line:

- `TS2554: Expected 1-2 arguments, but got 0` at each `forbidden()` call — it now demands a payload
- `TS2345` at `forbidden('You may not')` — the string is now read as the payload slot
- `TS2554` at the `types the payload as never…` `expectTypeOf` line
- `TS2578: Unused '@ts-expect-error' directive` at `forbidden({ id: '1' })` — that call is now legal

**Do not expect a single tidy `TS2344`.** The cascade *is* the signal: the `void` default is what keeps `Record<string, unknown>` out of every no-payload variant, so removing it breaks the whole no-payload surface at once. Restore `TData = void`.

- [ ] **Step 6: Commit**

```bash
git add src/core/error.ts src/index.ts test/core/error.spec.ts
git commit -m '`FEAT`: - adds the defineError factory for no-payload variants with an always-required message
  - decides payload presence at definition time rather than sniffing call arguments
  - defaults the factory to TData void so no Record<string, unknown> leaks into untyped variants'
```

---

### Task 3: `defineError` — the payload variant

**Depends on Task 2.**

**Files:**
- Modify: `test/core/error.spec.ts` only (the implementation from Task 2 already covers this path)

> **Expect Step 2's red to be partial.** `build` already handles payload variants, so most of these tests pass immediately. That is correct and not a TDD violation: Task 2's `hasPayload` flag is what implements this, and these tests exist to pin the **inference** — which no Task 2 test covers. Step 2 names exactly which assertion must be red.

- [ ] **Step 1: Write the failing test**

Append to `test/core/error.spec.ts`, adding `err`, `isOk` and `type Err` to the imports:

```ts
describe('defineError — payload variant', () => {
  const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);

  // §3.1 behaviour 1 — the payload type is inferred from the message function's
  // parameter annotation, with NO explicit type argument. This is the headline
  // ergonomic; it is what makes the single-call form worth having.
  it("infers the payload type from the message function's parameter", () => {
    expectTypeOf<ReturnType<typeof notFound>>().toEqualTypeOf<
      TypedError<'not_found', { id: string }>
    >();
  });

  it('derives the message from the payload', () => {
    expect(notFound({ id: '123' })).toEqual({
      type: 'not_found',
      message: 'User 123 not found',
      details: { id: '123' },
    });
  });

  // Payload occupies the first slot, so the override is the SECOND positional.
  it('overrides the message with the second positional argument', () => {
    const e = notFound({ id: '123' }, 'Custom message');
    expect(e.message).toBe('Custom message');
    expect(e.details).toEqual({ id: '123' });
  });

  // §3: nested under `details`, NEVER spread. A spread payload would collide
  // with the reserved type/message/cause keys and break the single guard.
  it('nests the payload under details', () => {
    expect(Object.keys(notFound({ id: '123' }))).toEqual(['type', 'message', 'details']);
    expect('id' in notFound({ id: '123' })).toBe(false);
  });

  // These MUST stay inside the uninvoked closure. `@ts-expect-error` does not
  // remove the statement: an executed `notFound()` runs the message fn against
  // an undefined payload and throws `Cannot read properties of undefined`,
  // while tsc stays green. See the typeOnly note in the no-payload describe.
  it('requires the payload and enforces its shape', () => {
    void (() => {
      // @ts-expect-error — payload is required for a payload variant
      notFound();
      // @ts-expect-error — payload shape is enforced
      notFound({ nope: 1 });
    });

    // the positive counterpart, executed
    expect(notFound({ id: '1' }).details).toEqual({ id: '1' });
  });

  it('rejects an unannotated message function parameter', () => {
    void (() => {
      // @ts-expect-error — the parameter annotation IS the payload declaration
      defineError('bad', (d) => `${d.id}`);
    });
  });

  // §3 / ADR 0002 §4: defineError produces a VALUE, not a Result. It composes
  // with the generic `err` — there is no separate typed `fail` constructor.
  it('composes with err into a failed Result', () => {
    const result = err(notFound({ id: '123' }));
    expectTypeOf(result).toEqualTypeOf<Err<TypedError<'not_found', { id: string }>>>();
    expect(isOk(result)).toBe(false);
    expect(result.error.type).toBe('not_found');
    expect(result.error.details).toEqual({ id: '123' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `TS2578: Unused '@ts-expect-error' directive` at the `notFound({ nope: 1 })` line **only if** the payload type failed to infer — which is the whole point. On a correct Task 2 this file compiles clean and the red is the *absence* of these tests, not a failure.

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **PASS — 22 tests.**

> If both commands are green immediately, that is the expected outcome for this task. Do not invent a failure to satisfy red-green. The prototype already proved this path; these tests exist to **lock the inference against regression**, and Step 3 below is where you prove they can fail.
>
> **One failure mode to read correctly rather than "fix".** If you see `TypeError: Cannot read properties of undefined (reading 'id')` at `src/core/error.ts` while `tsc` stays green, you dropped the `void (() => { … })` wrapper around the negative assertions — `notFound()` executed and ran the message function against an undefined payload. **`build` is not wrong; the test is.** Restore the wrapper. This trap is the reason the idiom is mandatory, and it is exactly the sort of thing a green `tsc` will not save you from.

- [ ] **Step 3: Verify the inference assertions are real**

Because Step 2 is green on arrival, this step *is* this task's red-green signal. Prove each assertion bites.

Temporarily widen `ErrorCtor`'s payload arm:

```ts
: (details: Record<string, unknown>, message?: string) => TypedError<TType, TData>) & {
```
Run `pnpm exec tsc --noEmit`.
Expected: **FAIL** with `TS2578: Unused '@ts-expect-error' directive` at `notFound({ nope: 1 })` — the payload shape is no longer enforced, so the forbidden call compiles and the directive goes unused. Restore.

Then temporarily break the return type:

```ts
: (details: TData, message?: string) => TypedError<TType, Record<string, unknown>>) & {
```
Run `pnpm exec tsc --noEmit`.
Expected: **FAIL** with `TS2344` at the `infers the payload type…` assertion. Restore.

- [ ] **Step 4: Commit**

```bash
git add test/core/error.spec.ts
git commit -m '`TEST`: - pins defineError payload-variant inference against regression
  - asserts the payload type is inferred from the message function parameter with no explicit generics
  - asserts the payload nests under details rather than spreading onto the error object'
```

---

### Task 4: `defineError.withData` — the escape hatch

**Depends on Task 3.** This is where the Task 2 fix pays off — the non-object payload test is the regression test for the prototype's silent bug.

**Files:**
- Modify: `src/core/error.ts`, `test/core/error.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/core/error.spec.ts`:

```ts
describe('defineError.withData — the escape hatch', () => {
  // §3.1 behaviour 2 — the ONE shape single-call cannot infer: a payload paired
  // with a STATIC message. Supplies TData explicitly WITHOUT repeating the
  // `type` literal, which is the tax the plain generic form would impose.
  it('supplies the payload type alongside a static message', () => {
    const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');

    expectTypeOf<ReturnType<typeof conflict>>().toEqualTypeOf<
      TypedError<'conflict', { id: string }>
    >();
    expect(conflict({ id: '9' })).toEqual({
      type: 'conflict',
      message: 'Already exists',
      details: { id: '9' },
    });
    expect(conflict({ id: '9' }, 'override').message).toBe('override');
  });

  it('carries a function message with an explicit payload type', () => {
    const conflict2 = defineError.withData<{ id: string }>()(
      'conflict',
      (d) => `Conflict on ${d.id}`,
    );
    expectTypeOf<ReturnType<typeof conflict2>>().toEqualTypeOf<
      TypedError<'conflict', { id: string }>
    >();
    expect(conflict2({ id: '9' }).message).toBe('Conflict on 9');
  });

  // REGRESSION TEST for the prototype's silent bug. Its per-call sniffing
  // (`typeof first !== 'string'`) swallowed a string payload as the message
  // override and dropped `details` entirely — while typechecking perfectly.
  // The definition-time hasPayload flag is what fixes this.
  it('carries a non-object payload', () => {
    const bad = defineError.withData<string>()('bad', 'Static message');
    expect(bad('my-payload')).toEqual({
      type: 'bad',
      message: 'Static message',
      details: 'my-payload',
    });
    expect(bad('my-payload', 'override')).toEqual({
      type: 'bad',
      message: 'override',
      details: 'my-payload',
    });

    const many = defineError.withData<string[]>()('many', 'Static');
    expect(many(['a', 'b']).details).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2339: Property 'withData' does not exist on type ...` — Task 2 exported the bare `defineErrorBase`.

- [ ] **Step 3: Write the minimal implementation**

In `src/core/error.ts`, add `withData` and replace Task 2's temporary export:

```ts
/**
 * Curried escape hatch for the one shape the single-call form cannot infer:
 * a payload paired with a **static** message.
 *
 * Gives the payload type explicitly without repeating the `type` literal:
 *
 * ```ts
 * const conflict = defineError.withData<{ id: string }>()('conflict', 'Already exists');
 * ```
 */
function withData<TData>() {
  return <TType extends string>(
    type: TType,
    defaultMessage: MessageArg<TData>,
  ): ErrorCtor<TType, TData> =>
    // `.withData` exists to declare a payload, so it always has one.
    build<TType, TData>(type, defaultMessage, true);
}

/**
 * Binds a `type`, a payload type, and a default message, returning a
 * constructor that produces plain {@link TypedError} values.
 *
 * The payload type is declared by **annotating the message function's
 * parameter** — no explicit type arguments:
 *
 * ```ts
 * const notFound  = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
 * const forbidden = defineError('forbidden', 'Access denied');   // no payload
 * ```
 *
 * For a payload with a *static* message, use {@link withData} — passing explicit
 * type arguments here (`defineError<'conflict', { id: string }>('conflict', 'msg')`)
 * is **not supported**: payload presence is determined from the message's form,
 * so a static message is always read as a no-payload variant.
 */
export const defineError = Object.assign(defineErrorBase, { withData });
```

Replace the temporary `export const defineError = defineErrorBase;` from Task 2 — do not leave both.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **PASS — 25 tests** (22 + `supplies the payload type alongside a static message`, `carries a function message with an explicit payload type`, `carries a non-object payload`).

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

- [ ] **Step 5: Verify the regression test actually catches the prototype's bug**

The `carries a non-object payload` test only earns its place if it fails against the broken implementation. Temporarily restore the prototype's sniffing inside `build`:

```ts
const hasPayloadAtCall = first !== undefined && typeof first !== 'string';
const payload = hasPayloadAtCall ? (first as TData) : undefined;
const override = hasPayloadAtCall ? second : (first as string | undefined);
```
(and use `hasPayloadAtCall` in the spread).

Run `pnpm exec vitest run test/core/error.spec.ts`.
Expected: **FAIL** on `carries a non-object payload` — received `{ type: 'bad', message: 'my-payload' }`, `details` missing. **Note `pnpm exec tsc --noEmit` stays green throughout** — which is precisely why this bug needed a runtime test to catch it. Restore the definition-time flag.

- [ ] **Step 6: Commit**

```bash
git add src/core/error.ts test/core/error.spec.ts
git commit -m '`FEAT`: - adds defineError.withData for declaring a payload alongside a static message
  - supplies the payload type without repeating the type literal at the call site
  - fixes the prototype bug that silently swallowed a string payload as the message override'
```

---

### Task 5: The per-variant `.is()` guard

**Depends on Task 4.**

**Files:**
- Modify: `test/core/error.spec.ts` only (`build` already attaches `.is`)

- [ ] **Step 1: Write the failing test**

Append to `test/core/error.spec.ts`:

```ts
describe('per-variant .is() guard', () => {
  const notFound = defineError('not_found', (d: { id: string }) => `User ${d.id} not found`);
  const forbidden = defineError('forbidden', 'Access denied');

  type ApiError = ReturnType<typeof notFound> | ReturnType<typeof forbidden>;

  // ADR 0002 §5: error unions are built from constructor RETURN TYPES, each with
  // its own payload. This is what replaced the cut TypedErrorUnion helper.
  it('narrows an error union by tag', () => {
    const handle = (e: ApiError): string => {
      if (notFound.is(e)) {
        expectTypeOf(e).toEqualTypeOf<TypedError<'not_found', { id: string }>>();
        return `404: ${e.details?.id ?? '?'}`;
      }
      return `403: ${e.message}`;
    };

    expect(handle(notFound({ id: '1' }))).toBe('404: 1');
    expect(handle(forbidden())).toBe('403: Access denied');
  });

  it('returns false for a different variant', () => {
    expect(notFound.is(forbidden())).toBe(false);
    expect(forbidden.is(notFound({ id: '1' }))).toBe(false);
    expect(notFound.is(notFound({ id: '1' }))).toBe(true);
  });

  // §3.2: tag-only. It CANNOT validate the payload at runtime — that needs a
  // schema. Asserted rather than left implicit, so the limitation is discoverable.
  it('is tag-only and does not validate the payload', () => {
    expect(notFound.is({ type: 'not_found', message: 'x' })).toBe(true);
    expect(notFound.is({ type: 'not_found', message: 'x', details: { wrong: true } })).toBe(true);
    expect(notFound.is({ type: 'not_found' })).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(notFound.is(null)).toBe(false);
    expect(notFound.is(undefined)).toBe(false);
    expect(notFound.is('not_found')).toBe(false);
    expect(notFound.is(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run test/core/error.spec.ts
```
Expected: **PASS — 29 tests.** `build` already attaches `.is`, so this task is green on arrival for the same reason as Task 3. Step 3 is its red-green signal.

- [ ] **Step 3: Verify the narrowing assertion is real**

Temporarily weaken `ErrorCtor`'s guard from a type predicate to a boolean:

```ts
is(x: unknown): boolean;
```
Run `pnpm exec tsc --noEmit`.
Expected: **FAIL** with `TS2344` at the `expectTypeOf(e).toEqualTypeOf<TypedError<'not_found', { id: string }>>()` line — without the predicate, `e` stays `ApiError` inside the `if`.

That single error is the whole signal. Note that `e.details?.id` keeps compiling, because **both** `ApiError` arms declare `details?` — so field access is *not* what proves the narrowing here, and the `expectTypeOf` is doing the real work. Restore.

- [ ] **Step 4: Commit**

```bash
git add test/core/error.spec.ts
git commit -m '`TEST`: - pins the per-variant .is() guard narrowing an error union by tag
  - documents that the guard is tag-only and never validates the details payload
  - covers building an error union from constructor return types per ADR 0002'
```

---

### Task 6: Delete the prototype

**Depends on Task 5** — do not delete until the port is proven green.

**Files:**
- Delete: `prototype/define-error/define-error.ts`, `callsites.ts`, `demo.test.ts`, `README.md`

- [ ] **Step 1: Confirm the port supersedes the prototype**

Every prototype assertion must now live in `test/core/error.spec.ts`. Walk the mapping before deleting — this is the last moment the original is available to check against:

| Prototype assertion | Ported to |
|---|---|
| `_1` — payload variant `ReturnType` | Task 3 `infers the payload type from the message function's parameter` |
| `_2` — no-payload is `never`, no `Record` leak | Task 2 `types the payload as never, not Record<string, unknown>` |
| `_4` / `_4b` — `.withData` static + fn message | Task 4 `supplies the payload type alongside a static message`, `carries a function message with an explicit payload type` |
| `@ts-expect-error notFound()` / `notFound({ nope: 1 })` | Task 3 `requires the payload and enforces its shape` |
| `@ts-expect-error defineError('bad', (d) => …)` | Task 3 `rejects an unannotated message function parameter` |
| `@ts-expect-error defineError('timeout')` | Task 2 `requires a default message` |
| `@ts-expect-error forbidden({ id: '1' })` | Task 2 `types the payload as never, not Record<string, unknown>` |
| `ApiError` union + `handle()` narrowing | Task 5 `narrows an error union by tag` |
| demo: default + override message | Task 3 `derives the message from the payload`, `overrides the message with the second positional argument` |
| demo: no-payload static + override | Task 2 `builds from its default message`, `overrides the message with the first positional argument` |
| demo: `.withData` payload + static | Task 4 `supplies the payload type alongside a static message` |
| demo: `.is()` tag-only | Task 5 `is tag-only and does not validate the payload`, `returns false for a different variant` |

**Nothing in the prototype is unported.** The verdict itself already lives in [ADR 0002 §4](../adr/0002-v2-typederror-model.md), which is append-only — so deleting the prototype loses no decision record.

- [ ] **Step 2: Delete it**

```bash
git rm -r prototype/define-error
rmdir prototype 2>/dev/null || true
```

Spec §9.3 is explicit: "port from the prototype, then **delete the prototype** (it is throwaway)". Its own README says the same. Do not keep it "just in case" — a second copy of a locked signature is the thing that drifts.

- [ ] **Step 3: Verify**

```bash
pnpm test
```
Expected: **47 passed across 2 files** — 18 in `test/core/result.spec.ts` + 29 in `test/core/error.spec.ts`. The prototype's 4 tests are gone, so the total moves 22 → 47.

```bash
pnpm check
```
Expected: exit 0, no output. (`tsconfig.json`'s `include` never covered `prototype/`, so this number does not move for that reason.)

```bash
git grep -n "prototype/define-error" -- . ':!docs/adr' ':!docs/plans' ':!docs/spec' ; echo "exit=$?"
```
Expected: **no output, `exit=1`.** References surviving in `docs/adr/`, `docs/spec/` and `docs/plans/` are correct and must stay — the ADRs are append-only history and the spec cites the prototype as the signature's provenance.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m '`CHORE`: - deletes the throwaway defineError prototype now that the port is green
  - keeps ADR 0002 as the single record of the locked signature and its rationale
  - removes the second copy of a locked design before it can drift from the implementation'
```

---

### Task 7: Full verification against the ticket

No new code. This is the acceptance gate for [#22](https://github.com/alifaroo-q/result-kit/issues/22).

- [ ] **Step 1: Run the three project commands clean**

```bash
pnpm clean && pnpm install && pnpm build && pnpm test && pnpm check
```
Expected: all green. `pnpm test` reports **47 passed across 2 files**; `pnpm check` prints nothing; `pnpm build` stays publint- and attw-clean.

- [ ] **Step 2: Confirm the barrel exports exactly the expected surface**

```bash
node -e "import('./dist/index.js').then(m => { const got = Object.keys(m).sort().join(','); const want = 'defineError,err,isErr,isOk,isTypedError,ok'; if (got !== want) throw new Error('barrel drift: got ' + got + ' want ' + want); console.log('barrel ok'); })"
```
Expected: `barrel ok`. Six values — #21's four plus `defineError` and `isTypedError`. `TypedError` and `ErrorCtor` are types and erase at runtime.

- [ ] **Step 3: Confirm the v1 helpers stayed cut**

```bash
git grep -nE "TypedErrorOf|TypedErrorUnion" -- src test ; echo "exit=$?"
```
Expected: **no output, `exit=1`.** ADR 0002 §5 cut both: `TypedErrorOf` was a redundant alias, and `TypedErrorUnion` distributed tags into same-*default*-payload variants, fighting the per-variant typed payload. Error unions now come from constructor return types (Task 5).

- [ ] **Step 4: Confirm the package is still zero-dependency**

```bash
node -e "const p=require('./package.json'); for (const k of ['dependencies','peerDependencies','peerDependenciesMeta']) { const v=p[k]; if (v && Object.keys(v).length) throw new Error(k + ' must be empty, found: ' + Object.keys(v)); } console.log('zero-dep ok');"
```
Expected: `zero-dep ok`. This ticket adds no dependency; the check guards against one sneaking in.

- [ ] **Step 5: Walk the ticket's acceptance criteria**

Tick each box on [#22](https://github.com/alifaroo-q/result-kit/issues/22) against the evidence:

| Ticket criterion | Proven by |
|---|---|
| Plain structural object, four fields, never a class | Task 1 `is a plain object, never an Error instance`, `accepts a hand-built literal` |
| Payload inferred from the message fn's parameter | Task 3 `infers the payload type from the message function's parameter` + Step 3 mutation |
| `.withData` supplies `TData` without repeating the tag | Task 4 `supplies the payload type alongside a static message` |
| `message` always required, no `type` fallback | Task 2 `requires a default message` |
| No-payload variant is `TypedError<T, never>`, no `Record` leak | Task 2 `types the payload as never, not Record<string, unknown>` + Step 5 mutation |
| `ReturnType` resolves to a clean `TypedError<'tag', Payload>` | Task 3 + Task 4 type assertions |
| `.is()` narrows by tag, tag-only | Task 5 `narrows an error union by tag`, `is tag-only and does not validate the payload` |
| `isTypedError(x): x is TypedError` (ADR 0002's form) | Task 1 `narrows an unknown to the base shape` |
| `TypedErrorOf` / `TypedErrorUnion` cut, `isTypedError` kept | Task 7 Step 3; Task 1 |
| Values JSON-serializable, `cause` carve-out documented | Task 1 `round-trips type, message and details through JSON`; TSDoc on `cause` |
| Prototype deleted | Task 6 |

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/v5-typed-error
gh pr create --title "TypedError + defineError: the opt-in structured-error convention" --body "Closes #22"
```

---

## Notes for the next ticket

- **The prototype's silent bug is worth remembering when [#23](https://github.com/alifaroo-q/result-kit/issues/23) builds `safeTry`.** It typechecked perfectly and still dropped data, because the *types* were right and the *runtime* sniffed its arguments. #23 has no prototype at all and is the most inference-sensitive thing in the spec — a green `tsc` there will prove even less than it did here. Pair every type assertion with a runtime one.
- **`ErrorCtor` is now exported** and appears in `defineError`'s public signature (spec §10.2 decided all three helper types are public). [#31](https://github.com/alifaroo-q/result-kit/issues/31) should document it in the README alongside `defineError`.
- **`CONTEXT.md` already defines `TypedError`, `type`, `details`, and `defineError`** with `_Avoid_` lines, and this implementation matches them exactly — no glossary change is needed from this ticket. #31 still owes entries for `ResultChain`, `ResultAsync`, `safeTry`, and `safeUnwrap`.
