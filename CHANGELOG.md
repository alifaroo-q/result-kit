# @zireal/result-kit

## 5.0.0

A complete rework: a plain, method-less `Result` union with a data-first free-function core, an opt-in fluent wrapper behind `@zireal/result-kit/fluent`, and zero runtime dependencies.

### Why `5.0.0` and not `2.0.0`?

Because `2.0.0` no longer exists and cannot be created.

`2.0.0`, `3.0.0`, `3.0.1`, `4.0.0` and `1.2.0` were published between 2026-03-27 and 2026-03-30, then unpublished during the rollback to `1.1.0`. **npm permanently retires an unpublished version number** — those five can never be republished, which is why `1.2.0` appears in the history below but was never installable.

The jump is not "the next free number", though. It is the only choice under which semver stays honest. Those versions were genuinely public for a few days, so anyone who installed one holds a `^2` / `^3` / `^4` range that their next install re-resolves:

| Candidate | Does a stale `^2.0.0` resolve to it? | Verdict |
|---|---|---|
| `2.0.1` | **yes** — ships a total API rewrite as a *patch* | rejected |
| `2.1.0` | **yes** — ships it as a *minor* | rejected |
| **`5.0.0`** | **no** — above `^2`, `^3` and `^4` alike | **adopted** |

`5.0.0` is the only version that cannot silently land a rewrite inside someone's existing range.

### Breaking

- **ESM-only.** No CJS build ships. On CommonJS, use `require('@zireal/result-kit')` (Node 22.12+ supports requiring ESM) or `await import(...)`.
- **Node `>=22.12`** (was `>=20`) and **TypeScript `>=6.0`**. `moduleResolution` must be `bundler`, `node16`, or `nodenext` — legacy `node` resolution cannot read the `exports` map.
- **The core API is now free functions.** The static `ResultKit` toolbox and the `ResultPipeline` / `AsyncResultPipeline` classes are removed.
- **Every `xAsync` double is gone.** The transforms take a value *or* a promise in one signature.
- **Three entrypoints removed:** `@zireal/result-kit/core` (its surface was identical to the root — change the specifier), plus `/fp-ts` and `/nest`, which ship no replacement.
- **`fp-ts` and `@nestjs/common` are no longer dependencies.** If your own code imports `fp-ts`, add it yourself — it used to arrive transitively.
- **⚠️ The `unwrapOrThrow` collision — this release's only *silent* breakage.** v1's `/nest` `unwrapOrThrow(result, options?)` threw a NestJS `HttpException`. The new core `unwrapOrThrow(result, message?)` throws a plain `Error`. Both take a `Result` first and an optional second argument, so **the name survives find-and-replace, still typechecks, and quietly stops producing HTTP responses** — a handled `404` becomes an unhandled `500`. Every other break here is loud. Grep for `unwrapOrThrow` before you ship.

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
