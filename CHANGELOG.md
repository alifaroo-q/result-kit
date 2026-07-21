# @zireal/result-kit

## 5.3.0

### Minor Changes

- bc02d97: Add `expectOk` / `expectErr` assertion helpers to the root barrel

  `expectOk(result)` narrows a `Result` to its value, throwing a descriptive error
  on `Err`. `expectErr(result)` narrows a `Result` to its error, throwing on `Ok`.

  Both use `JSON.stringify` in their error messages for readability. They are
  pure, framework-agnostic functions — no peer dependency, no test-framework
  coupling. The existing userland helper in `RECIPES.md` is replaced by the
  built-in.

## 5.2.0

### Minor Changes

- 56a5443: Add `defineErrors` and the `ErrorsOf<T>` type — the canonical way to declare a registry of error constructors and derive the union of their outputs in one line, instead of hand-writing `ReturnType<typeof a> | ReturnType<typeof b> | …`.

  ```ts
  import { defineErrors } from "@zireal/result-kit";
  import type { ErrorsOf } from "@zireal/result-kit";

  const appErrors = defineErrors({ notFound, forbidden });
  type AppError = ErrorsOf<typeof appErrors>;
  ```

  `ErrorsOf` is constructor-based, so every variant keeps its own typed payload and the discriminant stays literal for exhaustive `switch (error.type)` narrowing. `defineErrors` is a constrained identity — it type-checks the bag so a non-constructor entry is caught at the registration site. Both are additive: the manual `ReturnType<…>` union stays fully supported, and `ErrorsOf` also accepts a plain object literal of constructors.

### Patch Changes

- bfb4d38: Add `RECIPES.md`, a task-oriented adoption cookbook shipped in the package: gradual adoption alongside throwing code (`unwrapOrThrow` as the boundary adapter), mapping a `Result` to an HTTP response without changing the `TypedError` shape, testing with plain-data `toEqual`, and the discriminated-union widening gotcha inside `safeTry` bodies with the `satisfies` / `as const` / explicit-type-arg fixes. README now links to it and carries a short widening-gotcha callout.

## 5.1.0

### Minor Changes

- 7558fb8: Add `defineErrors` and the `ErrorsOf<T>` type — the canonical way to declare a registry of error constructors and derive the union of their outputs in one line, instead of hand-writing `ReturnType<typeof a> | ReturnType<typeof b> | …`.

  ```ts
  import { defineErrors } from "@zireal/result-kit";
  import type { ErrorsOf } from "@zireal/result-kit";

  const appErrors = defineErrors({ notFound, forbidden });
  type AppError = ErrorsOf<typeof appErrors>;
  ```

  `ErrorsOf` is constructor-based, so every variant keeps its own typed payload and the discriminant stays literal for exhaustive `switch (error.type)` narrowing. `defineErrors` is a constrained identity — it type-checks the bag so a non-constructor entry is caught at the registration site. Both are additive: the manual `ReturnType<…>` union stays fully supported, and `ErrorsOf` also accepts a plain object literal of constructors.

### Patch Changes

- 1cafc4d: Add `RECIPES.md`, a task-oriented adoption cookbook shipped in the package: gradual adoption alongside throwing code (`unwrapOrThrow` as the boundary adapter), mapping a `Result` to an HTTP response without changing the `TypedError` shape, testing with plain-data `toEqual`, and the discriminated-union widening gotcha inside `safeTry` bodies with the `satisfies` / `as const` / explicit-type-arg fixes. README now links to it and carries a short widening-gotcha callout.

## 5.0.2

### Patch Changes

- 3dc7a69: Point the package metadata at its new home. The repository moved from
  `alifarooq-zk/result-kit` to `alifaroo-q/result-kit`, so `repository.url` — which
  npm serves and which the provenance attestation binds to — now names the repo
  that actually builds the package. `bugs` and `homepage` are added alongside it,
  having been absent.

  Consumer-visible beyond the registry listing in one place: the `combineWithAllErrors`
  JSDoc links to the tracking issue for the accumulated-error formatters, and that link
  ships in `dist/index.d.ts` where an editor tooltip resolves it.

  No API, runtime, or type change. Every GitHub URL in the repo was rewritten rather
  than left to the redirect, which lapses the moment anything is created at the old path.

## 5.0.1

### Patch Changes

- 51b4912: Ship `MIGRATION.md` inside the published package.

  `README.md` links to it as the upgrade path from 1.x, but `.npmignore` allowed only `dist/`, and npm's automatic inclusions cover just `README.md`, `LICENSE` and `package.json`. The link still resolves on npmjs.com, which rewrites relative links to the repository — so this was never broken for anyone browsing the registry. It was broken for anyone reading the installed package: `node_modules/@zireal/result-kit/MIGRATION.md` did not exist, on the one release where a migration guide matters most.

  The tarball goes from 9 files to 10 (+17 kB). No code, types, or exports change.

## 5.0.0

A complete rework: a plain, method-less `Result` union with a data-first free-function core, an opt-in fluent wrapper behind `@zireal/result-kit/fluent`, and zero runtime dependencies.

### Why `5.0.0` and not `2.0.0`?

Because `2.0.0` no longer exists and cannot be created.

`2.0.0`, `3.0.0`, `3.0.1`, `4.0.0` and `1.2.0` were published between 2026-03-27 and 2026-03-30, then unpublished during the rollback to `1.1.0`. **npm permanently retires an unpublished version number** — those five can never be republished, which is why `1.2.0` appears in the history below but was never installable.

The jump is not "the next free number", though. It is the only choice under which semver stays honest. Those versions were genuinely public for a few days, so anyone who installed one holds a `^2` / `^3` / `^4` range that their next install re-resolves:

| Candidate   | Does a stale `^2.0.0` resolve to it?             | Verdict     |
| ----------- | ------------------------------------------------ | ----------- |
| `2.0.1`     | **yes** — ships a total API rewrite as a _patch_ | rejected    |
| `2.1.0`     | **yes** — ships it as a _minor_                  | rejected    |
| **`5.0.0`** | **no** — above `^2`, `^3` and `^4` alike         | **adopted** |

`5.0.0` is the only version that cannot silently land a rewrite inside someone's existing range.

### Breaking

- **ESM-only.** No CJS build ships. On CommonJS, use `require('@zireal/result-kit')` (Node 22.12+ supports requiring ESM) or `await import(...)`.
- **Node `>=22.12`** (was `>=20`) and **TypeScript `>=6.0`**. `moduleResolution` must be `bundler`, `node16`, or `nodenext` — legacy `node` resolution cannot read the `exports` map.
- **The core API is now free functions.** The static `ResultKit` toolbox and the `ResultPipeline` / `AsyncResultPipeline` classes are removed.
- **Every `xAsync` double is gone.** The transforms take a value _or_ a promise in one signature.
- **Three entrypoints removed:** `@zireal/result-kit/core` (its surface was identical to the root — change the specifier), plus `/fp-ts` and `/nest`, which ship no replacement.
- **`fp-ts` and `@nestjs/common` are no longer dependencies.** If your own code imports `fp-ts`, add it yourself — it used to arrive transitively.
- **⚠️ The `unwrapOrThrow` collision — this release's only _silent_ breakage.** v1's `/nest` `unwrapOrThrow(result, options?)` threw a NestJS `HttpException`. The new core `unwrapOrThrow(result, message?)` throws a plain `Error`. Both take a `Result` first and an optional second argument, so **the name survives find-and-replace, still typechecks, and quietly stops producing HTTP responses** — a handled `404` becomes an unhandled `500`. Every other break here is loud. Grep for `unwrapOrThrow` before you ship.

### Added

- **`@zireal/result-kit/fluent`** — `ResultChain` and `ResultAsync`, the chaining ergonomics of the old pipelines without the `fp-ts` dependency, and tree-shaken away entirely if unused.
- **`safeTry` / `safeUnwrap`** — generator-based do-notation: flat, sequential code where any `Err` short-circuits the block. The wrappers are self-iterable, so `/fluent` needs no `safeUnwrap`.
- **`defineError`** — a factory binding a `type`, a typed `details` payload, and a default message, replacing hand-written `TypedError` literals.
- **`groupByType` / `prettifyErrors`** — presentation over the `TypedError[]` that `combineWithAllErrors` accumulates.
- **`unwrapOrThrow`** — an honest extractor that throws a real `Error` with the original in `cause`. Read the Breaking note above before adopting it.
- **`inspect` / `inspectErr`** — one-sided tees replacing `tap`'s two-optional-handlers object.
- **A type-guard overload for `fromPredicate`**, and a no-argument `ok()` for the `Result<void, E>` case.

### Migrating

**→ See [`MIGRATION.md`](MIGRATION.md).** It carries the complete rename table, the replacement for every removed function, and the `pipe` / `pipeAsync` guidance. No codemod ships, so that table is the migration tool — it is deliberately not duplicated here, because a second copy in an append-only changelog drifts on the first edit and is never reconciled.

## 1.2.0

### Minor Changes

- e061456: Add richer fluent pipeline helpers and an optional `fp-ts` interop entrypoint.

## [1.1.0] - 2026-03-30 (Rollback)

- All versions v2.0.0 → v4.0.0 have been unpublished due to critical issues.
- Repository has been rolled back to stable v1.1.0.

## 1.1.0

### Minor Changes

- cf83708: Add fluent sync and async result pipelines for composing result-producing workflows with automatic error union widening.

## 1.0.2

### Patch Changes

- 6aa0638: Fix npm publishing so the built `dist` files are generated before release and included in the published package tarball.

## 1.0.1

### Patch Changes

- Improve JSDoc coverage across the core and Nest APIs so generated type declarations provide clearer IntelliSense for package consumers.
