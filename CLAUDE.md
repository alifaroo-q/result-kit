# result-kit workspace instructions

> **Mid-rework (v5).** The v1 surface has been torn down and the package is being rebuilt
> against [`docs/spec/v5-core-spec.md`](docs/spec/v5-core-spec.md) — the spec wins on
> signatures and exports; the ADRs in [`docs/adr/`](docs/adr/) win on rationale.
>
> It ships to npm as **`5.0.0`**. Contributor-facing docs may say "v2" (the internal
> codename); consumer-facing docs say `5.0.0` only, and never mention "v2".
>
> [README.md](README.md), [MIGRATION.md](MIGRATION.md) and [CONTEXT.md](CONTEXT.md) all
> document the **current** 5.0.0 surface ([#31](https://github.com/alifaroo-q/result-kit/issues/31)).
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
- [src/core/](src/core/) holds one module per spec group — `transforms.ts` (§5.2), `terminals.ts` (§5.3), `collections.ts` (§5.4), `interop.ts` (§5.5 + §5.6), `error.ts` (§3), `format.ts` (§3.4), `do-notation.ts` (§5.7) — all shipped. The one module that is **not** a spec group is `thenable.ts`: it holds the single `isThenable` definition that §10.6 turns on, shared by `transforms.ts` and `do-notation.ts`. §10.6 makes *the check itself* the decision, so it gets exactly one home; do not inline a second copy. It also holds that check's **static** counterpart, `NoThenableReturn` (§10.7, widened by §10.9) — `isThenable` is strictly broader than TypeScript's notion of awaitable, and the two halves of that gap belong together. Both are internal: neither is in §5.9's export list or reachable from the barrel.
- The `./fluent` entrypoint lives in [src/fluent/](src/fluent/) — `ResultChain` landed in [#28](https://github.com/alifaroo-q/result-kit/issues/28), `ResultAsync` in [#29](https://github.com/alifaroo-q/result-kit/issues/29), and do-notation (the two iterators plus `/fluent`'s `safeTry`) in [#30](https://github.com/alifaroo-q/result-kit/issues/30). **Iterability goes on the wrapper, never on the union** — `ok(1)` must stay non-iterable, which is the whole reason ADR 0007 put it in an adapter; `test/fluent/do-notation.spec.ts` asserts that at both the runtime and the type level. The wrapper's iterators delegate to the core `safeUnwrap` and yield the **plain** `Err`, and `/fluent`'s `safeTry` delegates to the core runner rather than restating short-circuit, generator-closing, or error accumulation. A `/fluent` body may `return` either half of the dual constructor (§10.13), and a `ResultAsync` too — that one needs no arm in `BodyReturn`, because it is thenable and an async generator's `TReturn` is awaited by tsc and the runtime alike, so it arrives as a plain `Result`. The `ResultChain` arm exists for the mirror reason: neither side awaits a non-thenable, so it survives as a wrapper. The root `.` bundle must **never** contain the fluent wrapper. That boundary is enforced by [test/fluent/boundary.spec.ts](test/fluent/boundary.spec.ts) (spec §7.3), **not by review** — it builds `dist/` itself and checks two independent things: that no `src/fluent/` source feeds the root's chunk graph (via sourcemaps), and that nothing importable from `.` is or produces a wrapper. **The second runs against both `src/` and `dist/`** (§10.12) — it read only `src/` until #39, which proved the *source* boundary while leaving the *shipped* one uncovered. Keep both trees: `src/` fails earlier and does not depend on the build, `dist/` is the only one that sees a packaging regression. If you touch it, re-prove it goes red; it carries a positive control for the same reason.
- If you add a new public entrypoint, update **three** files together: [tsdown.config.ts](tsdown.config.ts) (build it), the `package.json` `exports` map (publish it), and [tsconfig.json](tsconfig.json)'s `paths` (resolve it in-repo). This rule named only the first two until [#28](https://github.com/alifaroo-q/result-kit/issues/28) added `./fluent` and missed `paths` **while following it** — the in-repo tests import relatively, so nothing caught that `@zireal/result-kit/fluent` did not resolve. The gap surfaces in [#31](https://github.com/alifaroo-q/result-kit/issues/31), whose `examples/` compile against the bare specifier.
- **`exports` is hand-authored, not generated** (`exports: false` in [tsdown.config.ts](tsdown.config.ts)). tsdown's generator collapses `"."` to a bare string, losing spec §7.2's mandated types-first branch, and offers no way to keep `module` without also emitting `main` — which §7.2 forbids, because a `main` invites a tool to `require()` an ESM file as CJS. `publint` and `attw` still validate the hand-written result on every build.

## Coding Guidance

- Prefer the `ok(...)` / `err(...)` constructors from [src/core/result.ts](src/core/result.ts) over ad hoc result object construction. (v1's static `ResultKit.success(...)` / `ResultKit.fail(...)` are **gone** — `ResultKit` was removed in the v5 teardown, and `success` / `fail` are v1 names the spec renamed to `ok` / `err`.)
- Keep the union purely structural, per spec §2: no brand, no methods, exactly two fields per half, shallow `readonly` only. These are contracts — each is load-bearing for the §2.1 JSON round-trip guarantee.
- Keep typed error shapes aligned with the `type` and `message` convention.
- Preserve the split between the free-function core and the opt-in `/fluent` wrapper: the wrapper delegates to the core, it never reimplements it.
- **A settled `Result` input cannot promise an asynchronous output** (spec §10.9, completed by §10.11). Two mechanisms, not one: a transform may short-circuit *without calling its callback*, and the input may *itself be thenable* (§2's union is brandless, so a valid `{ ok: true, value }` may carry a `then`). The first is unfixable at runtime — the information does not exist — so those calls are **typed honestly** as `Result | Promise<Result>` via `SettledOr` in *return* position. **Never move that check into a parameter**: a conditional there does not reduce for an unresolved type parameter, which breaks every generic wrapper over `Result`, and the `any` carve-out it then needs reopens the hole. The second *is* fixable, and is: `isSettledResult` asks "is this a `Result`?" before "is this thenable?". Do not "restore" the async-callback convenience arm — it could not keep its promise on the `Err` branch, and it failed silently.
- Mirror source changes with tests: [test/core](test/core) for `src/core`, [test/fluent](test/fluent) for `src/fluent`.

## Verification

- Run `pnpm test` and `pnpm check` after TypeScript changes.
- Run `pnpm build` when changing public exports, packaging, or release-related files.
- **Type-level assertions are enforced by `pnpm check`, not `pnpm test`.** `vitest.config.ts` sets no `typecheck` config, so `expectTypeOf` is a runtime no-op under `vitest run` — a deliberately wrong assertion still passes. `tsc --noEmit` is what actually asserts it, and `@ts-expect-error` only bites there (`tsc` reports an unused directive when the expected error does not occur). Work is green only when **both** commands pass.

## Release Guidance

- **During the v5 rework, add no changesets.** Spec §8.2 knowingly overrides the rule below, for the `5.0.0` release only: `package.json` still declares the burned `1.2.0`, so a `major` changeset would compute `2.0.0` and `changeset publish` would fail (observed: **E400** *Cannot publish over previously published version*, not the 403 the spec first predicted). [#32](https://github.com/alifaroo-q/result-kit/issues/32) hand-sets `5.0.0` and hand-writes the changelog entry. Resume the normal flow below from `5.0.1` / `5.1.0` onward.
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

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
