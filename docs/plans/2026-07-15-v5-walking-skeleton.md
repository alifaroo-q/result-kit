# v5 Walking Skeleton Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use the repo's available execution skill when one exists (for example, `/implement` or `executing-plans`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the v1 surface and rebuild the thinnest end-to-end path — `import { ok, err, isOk, isErr } from '@zireal/result-kit'` returning a plain `Ok<T> | Err<E>` union — as an ESM-only package on the toolchain 5.0.0 will actually ship on.

**Architecture:** Teardown and rebuild in one slice, because they are entangled: dropping `fp-ts` and `@nestjs/common` is part of both. What survives is the union (spec §2), its two constructors and two guards (spec §5.1), and nothing else. Only the root `.` entrypoint exists after this ticket; `./fluent` arrives with the wrapper in [#28](https://github.com/alifarooq-zk/result-kit/issues/28), which is when `tsdown.config.ts` and `exports` get updated together per CLAUDE.md's new-entrypoint rule.

**Tech Stack:** TypeScript 7.0.2 (fallback 6.0.3) · tsdown 0.22.8 (rolldown) · Vitest 3.2.4 · publint · @arethetypeswrong/core · pnpm 11.9 · Node 24.17 (floor 22.12)

**Ticket:** [#21](https://github.com/alifarooq-zk/result-kit/issues/21) · **Spec:** [`docs/spec/v5-core-spec.md`](../spec/v5-core-spec.md) §2, §2.1, §5.1, §7 · **Decisions:** [ADR 0003](../adr/0003-v2-result-type-shape.md), [ADR 0006](../adr/0006-v2-package-layout-entrypoints.md)

---

## Assumptions

Each of these was inferred or verified during planning, not stated by the ticket. They are decisions, not open questions — but a reviewer should know they were made here.

- **`examples/` is deleted in this ticket, not in [#31](https://github.com/alifarooq-zk/result-kit/issues/31).** `tsconfig.json`'s `include` covers `examples`, and both example files import the v1 API this ticket removes. Leaving them breaks `pnpm check` from Task 1 onward. #31 still owns *authoring* the new `examples/core.ts` — it will need to re-add `examples` to `tsconfig.json`'s `include`. **This is a cross-ticket coupling; #31 has been noted.**
- **`src/core/error.ts` is deleted here**, taking v1's `TypedError` and `isTypedError` with it. v1's `TypedError` has no `TData` generic, so [#22](https://github.com/alifarooq-zk/result-kit/issues/22) rebuilds it from the prototype rather than editing it. Between this ticket and #22 the package exports no `isTypedError`. That is expected in a rewrite.
- **`package.json` `version` stays `1.2.0`.** [#32](https://github.com/alifarooq-zk/result-kit/issues/32) hand-sets `5.0.0` at release. Do not touch it here.
- **`attw` profile becomes `esmOnly`** (was `node16`). The package publishes no CJS, so `node16`'s dual-resolution checks no longer describe it.
- **Vitest stays on 3.2.4** and `vitest.config.ts` is unchanged. See *Type assertions* below.
- **`prototype/define-error/demo.test.ts` survives this entire ticket** and keeps running. `vitest.config.ts` sets no `include`, so vitest globs `**/*.{test,spec}.*` across the **whole repo** and picks up the prototype's 4 tests — even though `tsconfig.json`'s `include` (`["src", "test", …]`) never covers `prototype/`, which is why `pnpm check` ignores it. Spec §9.3 assigns deleting the prototype to the `defineError` port in [#22](https://github.com/alifarooq-zk/result-kit/issues/22), not here. **Every `pnpm test` count in this plan therefore includes those 4 tests.** Do not "fix" this by narrowing `vitest.config.ts` — the prototype is a real, passing suite until #22 ports it.

## Type assertions — read this before writing any test

Type-level acceptance criteria are carried by `expectTypeOf` in the `.spec.ts` file, **enforced by `pnpm check`, not by `pnpm test`**. This was verified on this repo, not assumed:

| Command | A deliberately wrong `expectTypeOf` assertion | Result |
|---|---|---|
| `pnpm test` (`vitest run`) | `expectTypeOf(failureResult).toEqualTypeOf<string>()` | **passes 5/5 — silently ignored** |
| `pnpm check` (`tsc --noEmit`) | same | **`error TS2344: Type 'string' does not satisfy the constraint …`** |

`tsconfig.json`'s `include` covers `test`, so `tsc` type-checks every spec file. `vitest.config.ts` has no `typecheck` config, so `expectTypeOf` is a **no-op under `vitest run`**.

**Consequences for every step in this plan:**

1. A task is only green when **both** `pnpm test` **and** `pnpm check` pass. A step that says "expect FAIL" for a type assertion means **`pnpm check` fails** — `pnpm test` may well be green and that proves nothing.
2. `@ts-expect-error` is a real assertion here: `tsc` reports `Unused '@ts-expect-error' directive` when the expected error does **not** occur. That is what makes the negative tests bite.
3. This is the pattern all twelve tickets follow. Do not add `typecheck: true` to `vitest.config.ts` — it would duplicate coverage `pnpm check` already provides, and vitest's `typecheck.include` defaults to `**/*.test-d.ts`, which would ignore every `.spec.ts` file anyway.

## File Structure

**Delete (Task 1):**

| Path | Why |
|---|---|
| `src/nest/` (`http.ts`, `index.ts`) | Adapter removed, not reworked (spec §1) |
| `src/fp-ts/index.ts`, `src/internal/fp-ts.ts` | Interop removed, not reworked (spec §1) |
| `src/core/pipeline.ts` | `ResultPipeline` / `AsyncResultPipeline` cut (spec §9.1) |
| `src/core/result-kit.ts` | Static `ResultKit` toolbox cut (spec §9.1) |
| `src/core/error.ts` | v1 `TypedError` lacks `TData`; #22 rebuilds it |
| `src/core/index.ts` | v1's `./core` entrypoint barrel; the subpath is removed (spec §7.1) |
| `test/core/fp-ts.spec.ts`, `test/core/pipeline.spec.ts`, `test/core/result-kit.spec.ts`, `test/nest/` | Tests for deleted code |
| `examples/core.ts`, `examples/nest.ts` | Both import the removed v1 API — see Assumptions |

**Create / modify:**

| Path | Responsibility | Est. lines |
|---|---|---|
| `src/core/result.ts` — **modify** | The union (§2) + `ok`/`err`/`isOk`/`isErr` (§5.1). Rename `Success`→`Ok`, `Failure`→`Err`. | ~95 |
| `src/index.ts` — **modify** | Flat root barrel. Re-exports from `./core/result`. | ~10 |
| `test/core/result.spec.ts` — **create** | Every §2 / §2.1 / §5.1 assertion. | ~150 |
| `package.json` — **modify** | Zero-dep, ESM-only, `engines`, `exports` (§7.2) | — |
| `tsdown.config.ts` — **modify** | One entry, ESM-only, `target: es2023` (§7.2) | — |
| `tsconfig.json` — **modify** | `target: ES2023`, drop nest-era options and paths | — |

`src/core/result.ts` holds the union *and* its constructors and guards. They are one concept (§2 + §5.1's first four symbols) and total ~95 lines with TSDoc — well under the 300-line split rule, and splitting a 10-line `ok`/`err` from a 10-line `isOk`/`isErr` would produce two files nobody wants. Later tickets add sibling modules per spec group (`transforms.ts`, `terminals.ts`, `collections.ts`, `interop.ts`, `error.ts`, `do-notation.ts`).

## Task order — why the toolchain jump is Task 5, not Task 1

The general rule is riskiest-first, and the toolchain jump *is* this ticket's risk. It is Task 5 anyway, deliberately:

- **TS 7 cannot break the tests.** Vitest transforms with esbuild/rolldown, never `tsc`. The only consumers of the project's TypeScript are `pnpm check` and tsdown's `.d.ts` generation. So the risk lands on Task 5 and Task 6, and writing Tasks 2–4 first costs nothing if TS 7 fails.
- **TS 7 against an empty package proves nothing.** Jumping before the union exists would validate the compiler against zero generics. Jumping *after* Tasks 2–4 tests it against overload resolution (`ok(): Ok<void>`), type predicates, and `expectTypeOf` assertions — the things we actually need it to get right.
- **Teardown first makes any TS 7 failure unambiguous.** With `fp-ts` and `@nestjs/common` gone, a Task 5 error is about *our* code, not a dependency's types.

Tasks 2–4 are sequential (each extends `src/core/result.ts` and `test/core/result.spec.ts`) and cannot be parallelised. Tasks 1→7 are a linear chain.

## Toolchain facts — verified during planning, do not re-litigate

These were checked against the live registry and `node_modules` on 2026-07-15. They resolve two things the spec worried about:

- **`typescript@latest` is `7.0.2`** and ships a native `tsc` binary (platform-specific optional deps, e.g. `@typescript/typescript-linux-x64`). **`pnpm check`'s `tsc --noEmit` script does not change.** "tsgo" was the name of the *preview* package (`@typescript/native-preview`, still at `7.0.0-dev`); it is superseded by `typescript@7`. TS `6.0.3` exists as the bridge fallback.
- **Spec §7.1's `attw` caveat is moot.** `@arethetypeswrong/core` hard-pins `typescript: "5.6.1-rc"` as a **regular dependency** and resolves it nested (confirmed: `node_modules/.pnpm/typescript@5.6.1-rc` is already on disk). It never loads the project's TypeScript, so it cannot break when we move to 7. **No TS 6 pin is needed for `attw`.** Spec §7.1 anticipated this as a risk; it is not one.
- **The real constraint is tsdown's peer range.** Installed `tsdown@0.21.4` declares `typescript: "^5.0.0"` — TS 7 violates it. `tsdown@0.22.8` declares `"^5.0.0 || ^6.0.0 || ^7.0.0"`. **The tsdown upgrade is what enables the TS 7 jump**, not an incidental bump.

---

### Task 0: Branch, and open the build-script gate

- [ ] **Step 1: Cut a branch from `main`**

The repo is currently on `main`. Do not commit this work to `main`.

```bash
git checkout -b feat/v5-walking-skeleton
```

- [ ] **Step 2: Confirm the pnpm build-script gate is open**

**This blocks every command in this plan, and it is a pre-existing repo defect — not something this ticket introduces.**

`pnpm-workspace.yaml` shipped with an unfilled pnpm prompt placeholder:

```yaml
allowBuilds:
  esbuild: set this to true or false
```

`set this to true or false` is not a boolean, so pnpm's dep-status check aborts **before running anything**. Every script fails — `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm exec` alike — with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.4` and a stack ending in `runDepsStatusCheck`. The error names esbuild and looks like a dependency problem, which is why it is worth naming here: it is a one-line config typo, and it will otherwise eat the first hour of this ticket.

Verify it reads:

```yaml
allowBuilds:
  esbuild: true
```

Then:

```bash
pnpm install
pnpm test
```
Expected: install runs esbuild's postinstall (`.../esbuild@0.27.4/node_modules/esbuild postinstall: Done`), and `pnpm test` reports **21 passed across 5 files**.

That baseline is **17 v1 tests across 4 spec files** (which Task 1 deletes) **plus 4 in `prototype/define-error/demo.test.ts`** (which survives to #22 — see *Assumptions*).

> **This fix was already applied and verified during planning** (2026-07-15), so the file may already be correct. The step is idempotent: confirm and move on. Commit it with Task 1 if it shows as modified.

---

### Task 1: Tear down the v1 surface

Deletion only — there is nothing to test-drive. The gate is a clean grep and a green typecheck, not a passing suite.

> **After this task `pnpm test` reports `Test Files 1 passed (1) / Tests 4 passed (4)`** — the surviving `prototype/define-error/demo.test.ts`, which [#22](https://github.com/alifarooq-zk/result-kit/issues/22) deletes when it ports the prototype (see *Assumptions*). Every test covering *this package's* code is gone until Task 2. That is expected: all 17 v1 tests exercise deleted code. You will not see "No test files found", and you do not need `--passWithNoTests`.

**Files:**
- Delete: `src/nest/http.ts`, `src/nest/index.ts`, `src/fp-ts/index.ts`, `src/internal/fp-ts.ts`, `src/core/pipeline.ts`, `src/core/result-kit.ts`, `src/core/error.ts`, `src/core/index.ts`
- Delete: `test/core/fp-ts.spec.ts`, `test/core/pipeline.spec.ts`, `test/core/result-kit.spec.ts`, `test/nest/http.spec.ts`
- Delete: `examples/core.ts`, `examples/nest.ts`
- Modify: `package.json`, `tsconfig.json`, `src/index.ts`

- [ ] **Step 1: Delete the v1 source, tests, and examples**

```bash
git rm -r src/nest src/fp-ts src/internal test/nest
git rm src/core/pipeline.ts src/core/result-kit.ts src/core/error.ts src/core/index.ts
git rm test/core/fp-ts.spec.ts test/core/pipeline.spec.ts test/core/result-kit.spec.ts
git rm examples/core.ts examples/nest.ts
```

`src/core/result.ts` survives — Task 2 rewrites it in place.

- [ ] **Step 2: Drop the dependencies**

```bash
pnpm remove fp-ts @nestjs/common
```

`fp-ts` was a runtime `dependency`; `@nestjs/common` was both a `devDependency` and an optional `peerDependency`. Then **hand-remove** the `peerDependencies` and `peerDependenciesMeta` blocks from `package.json` — `pnpm remove` does not strip those.

- [ ] **Step 3: Point the barrel at the surviving module**

`src/index.ts` — replace `export * from './core';`, since that directory barrel is gone:

```ts
export * from './core/result';
```

**This is deliberately transitional and must not be "improved" here.** `src/core/result.ts` still declares the v1 `Success`/`Failure` names at this point — the rename is Task 2's job. Re-exporting the *final* names now would fail this task's own typecheck gate, and aliasing them (`type Success as Ok`) would defeat Task 2's red state, which depends on `Ok` genuinely not existing yet.

Task 2 replaces this with the flat, explicit barrel spec §7.1 requires. `export *` survives exactly one task.

- [ ] **Step 4: Strip the nest era out of `tsconfig.json`**

- `paths`: reduce to `{ "@zireal/result-kit": ["./src/index.ts"] }` — the `/core` and `/nest` subpaths are removed (spec §7.1).
- Delete `"experimentalDecorators": true` — it existed only for NestJS.
- `include`: drop `"examples"`, leaving `["src", "test", "vitest.config.ts", "tsdown.config.ts"]`. **#31 re-adds it** when it authors the new `examples/core.ts`.

Leave `target` alone for now — Task 5 sets `ES2023`.

- [ ] **Step 5: Verify the teardown is total**

```bash
git grep -nE "fp-ts|fpTs|nestjs|NestJS|HttpException|ResultKit|ResultPipeline" -- src test examples ; echo "exit=$?"
```
Expected: **no output, `exit=1`** (grep found nothing). Any hit is a leftover reference.

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.** `src/core/result.ts` is types-only and self-contained, so it must typecheck cleanly on its own.

```bash
cat package.json | grep -cE '"fp-ts"|"@nestjs/common"|peerDependencies'
```
Expected: **`0`**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m '`REFACTOR`: - removes the v1 nest adapter, fp-ts interop, pipeline classes and ResultKit toolbox
  - drops the fp-ts dependency and the @nestjs/common peer, making the package zero-dependency
  - clears the surface so the v5 core can be rebuilt against the spec rather than edited into shape'
```

---

### Task 2: The `Result` union

**Files:**
- Modify: `src/core/result.ts` (rename `Success`→`Ok`, `Failure`→`Err`)
- Modify: `src/index.ts`
- Test: `test/core/result.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/core/result.spec.ts`. These assertions encode spec §2's invariant table and §2.1's public contract — each one is load-bearing, not decoration.

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Err, Ok, Result } from '../../src/index';

/**
 * Launders a Result through a function boundary so TypeScript cannot apply
 * assignment narrowing from the initializer.
 *
 * WHY THIS EXISTS — do not inline it away. Writing
 * `const r: Result<number, string> = ok(1)` lets TS narrow `r` to `Ok<number>`
 * at every use, which makes the `else` branch `never`. The narrowing tests
 * would then pass while asserting nothing, and the `expectTypeOf` in the
 * negative branch would error against `never`. Passing through a function
 * parameter keeps the union genuinely wide, which is the only way these tests
 * prove the guard did the narrowing.
 */
const asResult = <T, E>(r: Result<T, E>): Result<T, E> => r;

describe('Result union', () => {
  // §2 invariant: no brand, symbol, or nominal tag.
  // This is what makes the §2.1 round-trip provable and lets a cross-boundary
  // object flow straight in. If a brand ever appears, these two fail first.
  it('accepts a hand-built object literal as Ok', () => {
    const hand: Ok<number> = { ok: true, value: 1 };
    expect(hand).toEqual({ ok: true, value: 1 });
  });

  it('accepts a hand-built object literal as Err', () => {
    const hand: Err<string> = { ok: false, error: 'boom' };
    expect(hand).toEqual({ ok: false, error: 'boom' });
  });

  // §2 invariant: exactly two fields per half — no `error?: never` on Ok,
  // no `value?: never` on Err. `ok` is already a complete discriminant.
  it('has no opposite-field never on either half', () => {
    const okHalf: Ok<number> = { ok: true, value: 1 };
    // @ts-expect-error — `error` is not a member of Ok<T>
    okHalf.error;

    const errHalf: Err<string> = { ok: false, error: 'boom' };
    // @ts-expect-error — `value` is not a member of Err<E>
    errHalf.value;
  });

  // §2: the `ok` boolean is a complete discriminant — narrowing works on the
  // raw union with no guard function at all.
  it('narrows on the ok discriminant alone', () => {
    const r = asResult<number, string>({ ok: true, value: 1 });
    if (r.ok) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      expect(r.value).toBe(1);
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      throw new Error('unreachable');
    }
  });

  // §2.1 the JSON round-trip guarantee — the public contract.
  it('round-trips an Ok through JSON', () => {
    const original: Result<{ id: string }, string> = { ok: true, value: { id: '123' } };
    const revived = JSON.parse(JSON.stringify(original)) as Result<{ id: string }, string>;

    expect(revived).toEqual({ ok: true, value: { id: '123' } });
    expect(revived.ok).toBe(true);
    if (!revived.ok) throw new Error('unreachable');
    expect(revived.value.id).toBe('123');
  });

  it('round-trips an Err through JSON', () => {
    const original: Result<number, { type: string; message: string }> = {
      ok: false,
      error: { type: 'not_found', message: 'User not found' },
    };
    const revived = JSON.parse(JSON.stringify(original)) as typeof original;

    expect(revived).toEqual({ ok: false, error: { type: 'not_found', message: 'User not found' } });
    if (revived.ok) throw new Error('unreachable');
    expect(revived.error.type).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2305: Module '"../../src/index"' has no exported member 'Ok'` (and the same for `'Err'`). **This is the red state for this task.**

You will also see two `error TS2578: Unused '@ts-expect-error' directive.` from the `has no opposite-field never on either half` test. **That is correct and self-resolving** — `Ok`/`Err` currently resolve to error types, so `okHalf.error` raises no error and the directives go unused. All four errors disappear together at Step 3. Do not "fix" the test file.

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **PASS — and that proves nothing.**

> **This task's red is the typecheck, not the test run — read this before you conclude the test is wrong.**
>
> Everything Task 2 adds is a *type*. The spec file imports `Ok`/`Err`/`Result` with `import type`, which erases at runtime, and the bodies are object literals and `expectTypeOf` calls (a runtime no-op). So all six tests go green under `vitest run` whether or not `Ok` exists.
>
> That is exactly the false-confidence gap the *Type assertions* section documents, showing up on the very first TDD task. `tsc --noEmit` is the assertion engine here. Tasks 3 and 4 import `ok`/`err`/`isOk`/`isErr` as **values**, so their red shows up in both commands.

- [ ] **Step 3: Write the minimal implementation**

Rewrite `src/core/result.ts`. This is the rename ADR 0003 mandates (`Success`/`Failure` are v1 names) plus the §2 shape.

```ts
/**
 * The successful half of a {@link Result}.
 *
 * Purely structural: any `{ ok: true, value }` **is** an `Ok<T>`, whoever built
 * it. There is no brand, so a value parsed from JSON or received across a
 * boundary flows straight in.
 */
export interface Ok<T> {
  /** Discriminant. Complete on its own — narrow with `if (result.ok)`. */
  readonly ok: true;

  /** The value produced by the successful operation. */
  readonly value: T;
}

/**
 * The failed half of a {@link Result}.
 *
 * Carries error *data*, not an exception. `E` is fully generic — the
 * `TypedError` convention is opt-in, never mandated by this channel.
 */
export interface Err<E> {
  /** Discriminant. Complete on its own — narrow with `if (result.ok)`. */
  readonly ok: false;

  /** The error payload carried by the failed operation. */
  readonly error: E;
}

/**
 * An operation that either succeeded with a `T` or failed with an `E`.
 *
 * The package's serializable source of truth. When `T` and `E` are
 * JSON-serializable, `JSON.parse(JSON.stringify(result))` is a valid,
 * structurally-identical `Result<T, E>` consumable with no re-wrapping — so a
 * `Result` may be an HTTP body, a queue message, or a `postMessage` payload.
 *
 * Two carve-outs: a populated `cause` on a `TypedError` may not be
 * JSON-safe (sanitize it before serializing), and a fluent wrapper must be
 * unwrapped with `.toResult()` before serializing.
 */
export type Result<T, E> = Ok<T> | Err<E>;
```

Note the `readonly` is **shallow** — no `DeepReadonly<T>`, per §2. Task 3 asserts that.

Update `src/index.ts`:

```ts
export { type Err, type Ok, type Result } from './core/result';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **PASS** — 6 tests: `accepts a hand-built object literal as Ok`, `accepts a hand-built object literal as Err`, `has no opposite-field never on either half`, `narrows on the ok discriminant alone`, `round-trips an Ok through JSON`, `round-trips an Err through JSON`.

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.** This is what actually proves the `@ts-expect-error` and `expectTypeOf` assertions.

- [ ] **Step 5: Verify the negative assertions are real**

A `@ts-expect-error` that never fires is a silently dead test. Prove both bite:

Temporarily delete the `// @ts-expect-error` line above `okHalf.error` and run `pnpm exec tsc --noEmit`.
Expected: **FAIL** with `error TS2339: Property 'error' does not exist on type 'Ok<number>'`. Restore the line.

Then temporarily add `error?: never;` to the `Ok` interface and run `pnpm exec tsc --noEmit`.
Expected: **FAIL** with `Unused '@ts-expect-error' directive` — proving the test defends the no-opposite-field invariant. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/core/result.ts src/index.ts test/core/result.spec.ts
git commit -m '`FEAT`: - renames the Result halves from Success/Failure to Ok/Err and reshapes them per ADR 0003
  - keeps the union purely structural with no brand, so any matching object literal is a valid Result
  - asserts the JSON round-trip guarantee, the contract that lets a Result cross an HTTP or queue boundary'
```

---

### Task 3: `ok` / `err` constructors with narrow returns

**Depends on Task 2** — extends `src/core/result.ts` and `test/core/result.spec.ts`.

**Files:**
- Modify: `src/core/result.ts`, `src/index.ts`
- Test: `test/core/result.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/core/result.spec.ts`. Task 2's file has only a type-only import, so add a **new value import** beside it — this is the first time the spec file imports anything at runtime:

```ts
import { err, ok } from '../../src/index';   // new line; keep the existing `import type { ... }`

describe('ok / err constructors', () => {
  // §5.1: narrow returns. `ok` returns Ok<T>, NOT Result<T, never>.
  // Narrow is strictly more precise — it still widens into any Result
  // annotation for free, while keeping .value reachable without narrowing.
  it('returns the narrow Ok half', () => {
    const r = ok(1);
    expectTypeOf(r).toEqualTypeOf<Ok<number>>();
    expectTypeOf(r.value).toEqualTypeOf<number>();
    expect(r).toEqual({ ok: true, value: 1 });

    const widened: Result<number, string> = r; // widening is free
    expect(widened.ok).toBe(true);
  });

  it('returns the narrow Err half', () => {
    const e = err('boom');
    expectTypeOf(e).toEqualTypeOf<Err<string>>();
    expectTypeOf(e.error).toEqualTypeOf<string>();
    expect(e).toEqual({ ok: false, error: 'boom' });

    const widened: Result<number, string> = e;
    expect(widened.ok).toBe(false);
  });

  // §5.1: the no-arg overload for the common Result<void, E> success.
  // `return ok()` beats `ok(undefined)`.
  it('constructs a void Ok with no argument', () => {
    const r = ok();
    expectTypeOf(r).toEqualTypeOf<Ok<void>>();
    expect(r).toEqual({ ok: true, value: undefined });
  });

  // §2 invariant: exactly two fields per half, at runtime too.
  it('builds exactly two fields per half', () => {
    expect(Object.keys(ok(1))).toEqual(['ok', 'value']);
    expect(Object.keys(err('boom'))).toEqual(['ok', 'error']);
    expect(Object.keys(ok())).toEqual(['ok', 'value']);
  });

  // §2 invariant: shallow readonly only — no DeepReadonly, no Object.freeze.
  // The contained value's mutability is its own business.
  it('is shallow readonly and never frozen', () => {
    const r = ok({ n: 1 });

    // @ts-expect-error — the `ok` discriminant is readonly
    r.ok = false;

    r.value.n = 2; // shallow: the contained value stays mutable
    expect(r.value.n).toBe(2);
    expect(Object.isFrozen(r)).toBe(false);
  });

  // Edge cases: the constructors are generic and must not special-case falsy
  // or nullish payloads.
  it('carries falsy and nullish payloads unchanged', () => {
    expect(ok(0)).toEqual({ ok: true, value: 0 });
    expect(ok('')).toEqual({ ok: true, value: '' });
    expect(ok(null)).toEqual({ ok: true, value: null });
    expect(err(null)).toEqual({ ok: false, error: null });
    expect(err(undefined)).toEqual({ ok: false, error: undefined });
  });

  it('carries an Error instance in the error channel', () => {
    const boom = new Error('kaboom');
    const e = err(boom);
    expectTypeOf(e).toEqualTypeOf<Err<Error>>();
    expect(e.error).toBe(boom);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **FAIL** — `SyntaxError: The requested module '../../src/index' does not provide an export named 'ok'`.

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2305: Module '"../../src/index"' has no exported member 'ok'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/core/result.ts`:

```ts
/**
 * Builds a successful {@link Result}.
 *
 * The no-arg overload covers the common `Result<void, E>` success: prefer
 * `return ok()` over `ok(undefined)`.
 *
 * Returns the **narrow** `Ok<T>` rather than `Result<T, never>` — strictly more
 * precise, and it still assigns into any `Result<T, E>` annotation.
 */
export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | void> {
  return { ok: true, value: value as T };
}

/**
 * Builds a failed {@link Result}.
 *
 * The single generic failure constructor — there is no separate typed `fail`.
 * The `TypedError` convention is expressed by *what you pass*, not by a second
 * constructor.
 *
 * Returns the **narrow** `Err<E>` rather than `Result<never, E>`.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
```

Update `src/index.ts`:

```ts
export { err, ok, type Err, type Ok, type Result } from './core/result';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **PASS** — 13 tests. New: `returns the narrow Ok half`, `returns the narrow Err half`, `constructs a void Ok with no argument`, `builds exactly two fields per half`, `is shallow readonly and never frozen`, `carries falsy and nullish payloads unchanged`, `carries an Error instance in the error channel`.

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

- [ ] **Step 5: Verify the narrow-return assertion is real**

The narrow return is the whole point of §5.1's first bullet, and `toEqualTypeOf` is what defends it. Temporarily widen the **overload declaration** — the second one, not the implementation:

```ts
export function ok<T>(value: T): Result<T, never>;   // was: Ok<T>
```
Run `pnpm exec tsc --noEmit`.
Expected: **FAIL** — `expectTypeOf(r).toEqualTypeOf<Ok<number>>()` rejects the widened type. Restore.

> **Mutate the overload declaration, not the implementation signature.** Changing the implementation to `Result<T | void, never>` looks equivalent and is not: callers resolve against the *overload declarations*, so `ok(1)` still yields `Ok<number>`, the assertion still passes, and TypeScript's overload-implementation compatibility check is loose enough not to flag it. `tsc` exits clean and you learn nothing. This is the only mutation in the plan where the obvious target is the wrong one.

- [ ] **Step 6: Commit**

```bash
git add src/core/result.ts src/index.ts test/core/result.spec.ts
git commit -m '`FEAT`: - adds the ok and err constructors returning the narrow Ok and Err halves
  - keeps .value and .error reachable without narrowing while still widening into any Result annotation
  - adds the no-arg ok() overload so the common Result<void, E> success reads as return ok()'
```

---

### Task 4: `isOk` / `isErr` type predicates

**Depends on Task 3** — extends the same two files.

**Files:**
- Modify: `src/core/result.ts`, `src/index.ts`
- Test: `test/core/result.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/core/result.spec.ts`, adding `isErr, isOk` to the value import:

```ts
describe('isOk / isErr guards', () => {
  // §5.1: guards emit type predicates, not plain booleans.
  // `if (isOk(r)) { r.value }` must narrow — that is the acceptance criterion.
  it('narrows to Ok', () => {
    const r = asResult<number, string>(ok(1));
    if (isOk(r)) {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      expect(r.value).toBe(1);
    } else {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      throw new Error('unreachable');
    }
  });

  it('narrows to Err', () => {
    const r = asResult<number, string>(err('boom'));
    if (isErr(r)) {
      expectTypeOf(r).toEqualTypeOf<Err<string>>();
      expect(r.error).toBe('boom');
    } else {
      expectTypeOf(r).toEqualTypeOf<Ok<number>>();
      throw new Error('unreachable');
    }
  });

  it('returns the right boolean for both halves', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('boom'))).toBe(false);
    expect(isErr(err('boom'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  // Guards must key off the discriminant, not truthiness of the payload.
  it('reports ok for a falsy success value', () => {
    expect(isOk(ok(0))).toBe(true);
    expect(isOk(ok(null))).toBe(true);
    expect(isOk(ok())).toBe(true);
    expect(isErr(err(undefined))).toBe(true);
  });

  // §2.1 + §2 together: the guards work on an object that was never built by
  // `ok()` — this is the no-brand invariant paying off end to end, and it is
  // the ticket's headline acceptance criterion.
  it('narrows a JSON-revived result with no re-wrapping', () => {
    const wire = JSON.stringify(ok({ id: '123' }));
    const revived = JSON.parse(wire) as Result<{ id: string }, string>;

    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) throw new Error('unreachable');
    expectTypeOf(revived).toEqualTypeOf<Ok<{ id: string }>>();
    expect(revived.value.id).toBe('123');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **FAIL** — `does not provide an export named 'isOk'`.

```bash
pnpm exec tsc --noEmit
```
Expected: **FAIL** with `error TS2305: Module '"../../src/index"' has no exported member 'isOk'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/core/result.ts`:

```ts
/**
 * Narrows a {@link Result} to its successful half.
 *
 * Emits a type predicate, so `if (isOk(r)) { r.value }` narrows. Works on any
 * structurally-valid `Result` — including one parsed from JSON — because the
 * union carries no brand.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Narrows a {@link Result} to its failed half.
 *
 * Emits a type predicate, so `if (isErr(r)) { r.error }` narrows.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
```

Update `src/index.ts` — this is the complete walking-skeleton barrel:

```ts
export {
  err,
  isErr,
  isOk,
  ok,
  type Err,
  type Ok,
  type Result,
} from './core/result';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run test/core/result.spec.ts
```
Expected: **PASS** — 18 tests. New: `narrows to Ok`, `narrows to Err`, `returns the right boolean for both halves`, `reports ok for a falsy success value`, `narrows a JSON-revived result with no re-wrapping`.

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

- [ ] **Step 5: Verify the predicate assertion is real**

Temporarily change `isOk`'s return type from `result is Ok<T>` to `boolean` and run `pnpm exec tsc --noEmit`.
Expected: **FAIL** — inside `if (isOk(r))`, `r` stays `Result<number, string>`, so `expectTypeOf(r).toEqualTypeOf<Ok<number>>()` errors and `r.value` becomes inaccessible. This proves the test defends the predicate, not just the boolean. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/core/result.ts src/index.ts test/core/result.spec.ts
git commit -m '`FEAT`: - adds the isOk and isErr guards emitting type predicates rather than plain booleans
  - lets if (isOk(r)) narrow to the Ok half so .value is reachable without a cast
  - proves the no-brand invariant by narrowing a JSON-revived result that ok() never built'
```

---

### Task 5: The TypeScript 7 toolchain jump

The ticket's headline risk. Read *Toolchain facts* above first — two of the three things the spec worried about are already resolved, and the third (tsdown's peer range) is what this task is really about.

**Files:**
- Modify: `package.json` (devDependencies), `tsconfig.json` (`target`)

- [ ] **Step 1: Record the baseline**

```bash
pnpm exec tsc --version
```
Expected: `Version 5.9.3`.

- [ ] **Step 2: Upgrade tsdown first — it is the gate**

```bash
pnpm add -D tsdown@^0.22.8 @arethetypeswrong/core@^0.18.5
pnpm exec tsdown --help > /dev/null && echo "tsdown ok"
```
Expected: `tsdown ok`.

`tsdown@0.21.4`'s `typescript` peer is `^5.0.0`, which TS 7 violates; `0.22.8` widens it to `^5.0.0 || ^6.0.0 || ^7.0.0`. Doing this bump *before* the TypeScript one keeps pnpm from reporting a peer conflict that would obscure a genuine TS 7 failure.

- [ ] **Step 3: Jump to TypeScript 7**

```bash
pnpm add -D typescript@^7.0.2
pnpm exec tsc --version
```
Expected: `Version 7.0.2`.

The `tsc` binary name is unchanged, so **`package.json`'s `"check": "tsc --noEmit"` script needs no edit.** TS 7 is the native (Go) compiler — the artifact the spec calls "tsgo".

- [ ] **Step 4: Set the emit target**

`tsconfig.json`: `"target": "ES2022"` → `"target": "ES2023"`.

All of ES2023 is native on the Node 22.12 floor, so there is no downleveling (spec §7.1). This matters more than it looks: **generator and async-iterator emit differs by target**, and [#23](https://github.com/alifarooq-zk/result-kit/issues/23) (`safeTry`) and [#29](https://github.com/alifarooq-zk/result-kit/issues/29) (`ResultAsync`) are built directly on those. Settling the target now is why this ticket exists before them.

- [ ] **Step 5: Verify the full toolchain on TS 7**

```bash
pnpm exec tsc --noEmit
```
Expected: **PASS, no output.**

```bash
pnpm exec vitest run
```
Expected: **PASS — 22 tests across 2 files**: 18 in `test/core/result.spec.ts` plus the 4 in `prototype/define-error/demo.test.ts` (see *Assumptions*). Vitest transforms with rolldown/esbuild and never invokes `tsc`, so the TypeScript jump should not move this number at all. If it did, the cause is elsewhere.

```bash
pnpm build
```
Expected: **PASS**, emitting `dist/index.js` and `dist/index.d.ts`.

> **This is the step that can actually fail.** tsdown generates `.d.ts` via `rolldown-plugin-dts`, which is the one part of the pipeline that may embed the TypeScript compiler API — and spec §7.1 notes TS 7 has no stable programmatic API until 7.1. `pnpm check` and `pnpm test` passing while `pnpm build` fails on `.d.ts` generation is the expected failure signature.

- [ ] **Step 6: Fall back to TypeScript 6 only if Step 5 fails**

Per the locked decision, TS 7 is attempted and TS 6 is the fallback. Do **not** fall back for a fixable error in our own code.

```bash
pnpm add -D typescript@^6.0.3
pnpm exec tsc --version   # expect: Version 6.0.3
pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm build
```

If the fallback is taken, **comment on [#21](https://github.com/alifarooq-zk/result-kit/issues/21)** with the exact failing command and error, and note that spec §7.1's stated dev toolchain is unmet pending TS 7.1. The consumer-types floor is **6.0+** either way (spec §7.1), so a TS 6 dev toolchain still satisfies the package's actual commitment — TS 7 buys typecheck speed, not correctness. This is a recorded deviation, not a silent one.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git commit -m '`BUILD`: - moves the dev toolchain to TypeScript 7 and raises the emit target to ES2023
  - upgrades tsdown first because its 0.21 peer range excludes TypeScript 7 entirely
  - settles generator and async-iterator emit before safeTry and ResultAsync are built on it'
```

---

### Task 6: ESM-only packaging

**Files:**
- Modify: `tsdown.config.ts`, `package.json`

- [ ] **Step 1: Reduce the build to one ESM entry**

Rewrite `tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
  outDir: 'dist',
  treeshake: true,
  exports: true,
  publint: true,
  attw: {
    profile: 'esmOnly',
    level: 'error',
  },
});
```

Changes from v1: the `core`/`fp-ts`/`nest` entries are gone; `format` drops `cjs`; `target` is `es2023`; the `deps.neverBundle` block for `@nestjs/common` is gone; the `attw` profile moves from `node16` to `esmOnly` (the package publishes no CJS, so `node16`'s dual-resolution checks no longer describe it).

The `./fluent` entry is **not** added here — [#28](https://github.com/alifarooq-zk/result-kit/issues/28) adds it together with the `exports` change, per CLAUDE.md's new-entrypoint rule.

- [ ] **Step 2: Set the manifest to the §7.2 shape**

`package.json`:

- `"engines": { "node": ">=22.12" }` — raised from `>=20.0.0`, aligning with unflagged `require(esm)` so *every* supported Node can load an ESM-only package.
- `"module": "./dist/index.js"` — was `./dist/index.mjs`.
- `"types": "./dist/index.d.ts"` — was `./dist/index.d.cts`. A single `.d.ts`; the masquerading-types hazard cannot occur without a CJS build.
- **Delete `"main"` entirely.** Declaring one invites a tool to `require()` an ESM file as CJS.
- `"exports"`: reduce to the two surviving keys, `types` first in every branch:

```jsonc
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./package.json": "./package.json"
}
```

Leave `"type": "module"` and `"sideEffects": false` as they are — both are already correct.

> `tsdown.config.ts` sets `exports: true`, so tsdown **rewrites** `package.json`'s `exports` on build. Write the block by hand anyway, then confirm in Step 3 that what tsdown generates matches §7.2. If it diverges (for example by re-adding an `import`/`require` condition pair), that is a real finding — fix it via tsdown config, not by hand-editing a generated field.

- [ ] **Step 3: Build and verify the artifact shape**

```bash
pnpm build
```
Expected: **PASS**, with publint and attw both clean.

```bash
ls dist
```
Expected: exactly `index.js`, `index.js.map`, `index.d.ts` (plus `index.d.ts.map` if declaration maps are emitted). **No `.cjs`, no `.mjs`, no `.d.cts`, no `.d.mts`, and no `core/`, `fp-ts/`, or `nest/` directories.**

```bash
node -e "const p=require('./package.json'); if(p.main) throw new Error('main must not exist'); const e=p.exports['.']; if(Object.keys(e)[0]!=='types') throw new Error('types must come first'); console.log('manifest ok');"
```
Expected: `manifest ok`.

- [ ] **Step 4: Verify the package actually loads both ways**

The ESM-only decision rests on a CJS consumer reaching 5.0.0 via `require(esm)`, guaranteed by the Node floor. Prove it rather than assume it:

```bash
node -e "import('./dist/index.js').then(m => { const r = m.ok(1); if (!m.isOk(r) || r.value !== 1) throw new Error('esm import broken'); console.log('esm import ok'); })"
```
Expected: `esm import ok`.

```bash
node -e "const m = require('./dist/index.js'); const r = m.ok(1); if (!m.isOk(r) || r.value !== 1) throw new Error('require(esm) broken'); console.log('require(esm) ok');"
```
Expected: `require(esm) ok`. (This exercises `require(esm)` — unflagged from Node 22.12; the dev machine is on 24.17.)

- [ ] **Step 5: Verify the built types resolve**

```bash
pnpm exec attw --pack . --profile esmOnly
```
Expected: **no problems found**, reporting a clean ESM-only resolution.

```bash
pnpm exec publint
```
Expected: **`All good!`**

- [ ] **Step 6: Commit**

```bash
git add tsdown.config.ts package.json
git commit -m '`BUILD`: - ships the package as ESM-only with a single root entrypoint and one .d.ts
  - drops main and the CJS output so no tool can require an ESM file as CJS
  - raises the Node floor to 22.12 so every supported runtime can load it via require(esm)'
```

---

### Task 7: Full verification against the ticket

No new code. This is the acceptance gate for [#21](https://github.com/alifarooq-zk/result-kit/issues/21).

- [ ] **Step 1: Run the three project commands clean**

```bash
pnpm clean && pnpm install && pnpm build && pnpm test && pnpm check
```
Expected: all green. `pnpm check` prints nothing. `pnpm test` reports **22 passed across 2 files** — 18 in `test/core/result.spec.ts` (this ticket's suite) plus 4 in `prototype/define-error/demo.test.ts`.

> **22, not 18.** The prototype suite is globbed by vitest and survives until [#22](https://github.com/alifarooq-zk/result-kit/issues/22) ports it (see *Assumptions*). **18 is the number that matters here** — it is this ticket's entire suite. If `test/core/result.spec.ts` reports anything other than 18, that is drift worth chasing; the trailing 4 are not.

- [ ] **Step 2: Confirm the barrel exports exactly the skeleton surface**

```bash
node -e "import('./dist/index.js').then(m => { const got = Object.keys(m).sort().join(','); const want = 'err,isErr,isOk,ok'; if (got !== want) throw new Error('barrel drift: got ' + got + ' want ' + want); console.log('barrel ok'); })"
```
Expected: `barrel ok`. Types erase at runtime, so only the four values appear. Anything extra means dead v1 surface survived the teardown.

- [ ] **Step 3: Confirm zero dependencies**

```bash
node -e "const p=require('./package.json'); for (const k of ['dependencies','peerDependencies','peerDependenciesMeta']) { const v=p[k]; if (v && Object.keys(v).length) throw new Error(k + ' must be empty, found: ' + Object.keys(v)); } console.log('zero-dep ok');"
```
Expected: `zero-dep ok`. Spec §7.2 requires the package be zero-dependency **and** zero-peerDependency.

- [ ] **Step 4: Walk the ticket's acceptance criteria**

Tick each box on [#21](https://github.com/alifarooq-zk/result-kit/issues/21) against the evidence above. Every criterion maps to a command in this plan:

| Ticket criterion | Proven by |
|---|---|
| v1 surface gone | Task 1 Step 5 grep; Task 7 Step 2 barrel check |
| Zero-dep / zero-peerDep | Task 7 Step 3 |
| §2 invariants held | Task 2 Steps 4–5; Task 3 `is shallow readonly and never frozen`, `builds exactly two fields per half` |
| Narrow returns | Task 3 `returns the narrow Ok half` / `returns the narrow Err half` + Step 5 |
| `ok(): Ok<void>` | Task 3 `constructs a void Ok with no argument` |
| Type predicates narrow | Task 4 `narrows to Ok` / `narrows to Err` + Step 5 |
| §2.1 round-trip + no-brand | Task 2 round-trip tests; Task 4 `narrows a JSON-revived result with no re-wrapping` |
| ESM-only, no `main`, types first, single `.d.ts` | Task 6 Steps 3–4 |
| `engines.node >=22.12`, `ES2023` | Task 5 Step 4; Task 6 Step 2 |
| publint + attw green | Task 6 Step 5 |
| build/test/check green | Task 7 Step 1 |

- [ ] **Step 5: Report the toolchain outcome on the ticket**

Comment on [#21](https://github.com/alifarooq-zk/result-kit/issues/21) stating which TypeScript line landed (7.0.2, or 6.0.3 with the failing command and error). Downstream tickets — especially [#23](https://github.com/alifarooq-zk/result-kit/issues/23) and [#29](https://github.com/alifarooq-zk/result-kit/issues/29), which depend on generator and async-iterator emit — need to know which compiler they are building against.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/v5-walking-skeleton
gh pr create --title "Walking skeleton: ESM-only package on the target toolchain, with the Result union" --body "Closes #21"
```

---

## Notes for the next ticket

- **[#31](https://github.com/alifarooq-zk/result-kit/issues/31) must re-add `"examples"` to `tsconfig.json`'s `include`** when it authors the new `examples/core.ts`. This ticket removed it along with the v1 example files. See *Assumptions*.
- **Spec §7.1's `attw`/TS 7 caveat can be closed** — `@arethetypeswrong/core` pins its own `typescript@5.6.1-rc` as a regular dependency and never loads the project's. Worth a note on the spec once #21 lands, so no later ticket re-investigates it.
- **The `.d.ts` generation path is the only place TS 7 can bite** (`rolldown-plugin-dts`). If Task 5 fell back to TS 6, that is the thing to re-test when TS 7.1 ships its stable programmatic API.
