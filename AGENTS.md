# result-kit workspace instructions

> **Mid-rework (v5).** The v1 surface has been torn down and the package is being rebuilt
> against [`docs/spec/v5-core-spec.md`](docs/spec/v5-core-spec.md) — the spec wins on
> signatures and exports; the ADRs in [`docs/adr/`](docs/adr/) win on rationale.
>
> It ships to npm as **`5.0.0`**. Contributor-facing docs may say "v2" (the internal
> codename); consumer-facing docs say `5.0.0` only, and never mention "v2".
>
> [README.md](README.md), [MIGRATION.md](MIGRATION.md) and [CONTEXT.md](CONTEXT.md) all
> document the **current** 5.0.0 surface ([#31](https://github.com/alifarooq-zk/result-kit/issues/31)).
> `README.md` and `MIGRATION.md` are the two consumer-facing files — they say `5.0.0` and
> never "v2"; this file and `CONTEXT.md` are contributor-facing and may use the codename.

## Overview

- Package name: `@zireal/result-kit`
- Runtime target: Node.js 22.12+
- Package type: ESM-only, **zero-dependency, zero-peerDependency** library build — no CJS output
- Dev toolchain: TypeScript 7.0.2; emit target ES2023
- Primary reference docs: [`docs/spec/v5-core-spec.md`](docs/spec/v5-core-spec.md), [CONTEXT.md](CONTEXT.md)

## Commands

- Install dependencies: `pnpm install`
- Build the package: `pnpm build`
- Run tests once: `pnpm test`
- Run coverage: `pnpm test:cov`
- Run type checking: `pnpm check`
- Clean build artifacts: `pnpm clean`

## Architecture

- [src/index.ts](src/index.ts) is the flat root barrel, and the only public entrypoint today.
- [src/core/result.ts](src/core/result.ts) holds the `Result` union (`Ok<T> | Err<E>`) plus `ok` / `err` / `isOk` / `isErr`.
- Sibling modules, one per spec group, are all shipped: `transforms.ts` (§5.2), `terminals.ts` (§5.3), `collections.ts` (§5.4), `interop.ts` (§5.5 + §5.6), `error.ts` (§3), `format.ts` (§3.4), `do-notation.ts` (§5.7).
- The `./fluent` entrypoint (`ResultChain` / `ResultAsync`) arrives in [#28](https://github.com/alifarooq-zk/result-kit/issues/28). The root `.` bundle must **never** contain the fluent wrapper — spec §7.3 mandates an automated guard.
- If you add a new public entrypoint, update [tsdown.config.ts](tsdown.config.ts) and the `package.json` `exports` map together.
- **`exports` is hand-authored, not generated** (`exports: false` in [tsdown.config.ts](tsdown.config.ts)). tsdown's generator collapses `"."` to a bare string, losing spec §7.2's mandated types-first branch, and offers no way to keep `module` without also emitting `main` — which §7.2 forbids, because a `main` invites a tool to `require()` an ESM file as CJS. `publint` and `attw` still validate the hand-written result on every build.

## Coding Guidance

- Prefer the `ok(...)` / `err(...)` constructors from [src/core/result.ts](src/core/result.ts) over ad hoc result object construction. (v1's static `ResultKit.success(...)` / `ResultKit.fail(...)` are **gone** — `ResultKit` was removed in the v5 teardown, and `success` / `fail` are v1 names the spec renamed to `ok` / `err`.)
- Keep the union purely structural, per spec §2: no brand, no methods, exactly two fields per half, shallow `readonly` only. These are contracts — each is load-bearing for the §2.1 JSON round-trip guarantee.
- Keep typed error shapes aligned with the `type` and `message` convention.
- Preserve the split between the free-function core and the opt-in `/fluent` wrapper: the wrapper delegates to the core, it never reimplements it.
- Mirror source changes with tests under [test/core](test/core).

## Verification

- Run `pnpm test` and `pnpm check` after TypeScript changes.
- Run `pnpm build` when changing public exports, packaging, or release-related files.
- **Type-level assertions are enforced by `pnpm check`, not `pnpm test`.** `vitest.config.ts` sets no `typecheck` config, so `expectTypeOf` is a runtime no-op under `vitest run` — a deliberately wrong assertion still passes. `tsc --noEmit` is what actually asserts it, and `@ts-expect-error` only bites there (`tsc` reports an unused directive when the expected error does not occur). Work is green only when **both** commands pass.

## Release Guidance

- **During the v5 rework, add no changesets.** Spec §8.2 knowingly overrides the rule below, for the `5.0.0` release only: `package.json` still declares the burned `1.2.0`, so a `major` changeset would compute `2.0.0` and `changeset publish` would fail (observed: **E400** *Cannot publish over previously published version*, not the 403 the spec first predicted). [#32](https://github.com/alifarooq-zk/result-kit/issues/32) hand-sets `5.0.0` and hand-writes the changelog entry. Resume the normal flow below from `5.0.1` / `5.1.0` onward.
- For any consumer-facing bug fix, feature, or breaking change, add a changeset before finishing the work.
- Use `pnpm changeset` to create the changeset file.
- Choose the version bump based on impact:
  - `patch` for bug fixes and backward-compatible corrections
  - `minor` for backward-compatible features
  - `major` for breaking changes
- Internal-only changes that do not affect published package consumers usually do not need a changeset unless the user explicitly asks for one.
- Use `pnpm changeset:version` to apply release bumps and `pnpm changeset:publish` for publishing workflows.

## Documentation

- Link to [README.md](README.md) for installation, API surface, and usage guidance instead of duplicating large sections here. It documents the shipped 5.0.0 surface, with `/fluent` as the hero and the free-function core as the supported lean path (spec §4) — keep that positioning if you edit it.
- [MIGRATION.md](MIGRATION.md) lives at the **repo root**, not `docs/` — it is the one consumer-facing migration document, and its rename table *is* the migration tool, since no codemod ships. It carries the mandatory `unwrapOrThrow` collision warning (spec §8.5); do not remove or soften it.
- [CONTEXT.md](CONTEXT.md) carries the current domain vocabulary and is the fastest way to get the v5 terminology right.
- [examples/core.ts](examples/core.ts) is type-checked by `pnpm check` — `"examples"` is in [tsconfig.json](tsconfig.json)'s `include`, and it must stay there. Without it the example compiles for nobody and drifts silently while every command still reports green. It imports through the **bare specifiers** a consumer uses, which the `paths` entries map to `src/`; drop those and TypeScript self-resolves the package name to `dist/` instead, so a stale build would be what got checked.
