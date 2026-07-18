# result-kit workspace instructions

> **Mid-rework (v5).** The v1 surface has been torn down and the package is being rebuilt
> against [`docs/spec/v5-core-spec.md`](docs/spec/v5-core-spec.md) — the spec wins on
> signatures and exports; the ADRs in [`docs/adr/`](docs/adr/) win on rationale.
>
> It ships to npm as **`5.0.0`**. Contributor-facing docs may say "v2" (the internal
> codename); consumer-facing docs say `5.0.0` only, and never mention "v2".
>
> [README.md](README.md) still documents the **v1** API and is rewritten in
> [#31](https://github.com/alifarooq-zk/result-kit/issues/31) — do not treat it as the
> current surface. [CONTEXT.md](CONTEXT.md) is current.

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
- [src/core/](src/core/) holds one module per spec group — `transforms.ts` (§5.2), `terminals.ts` (§5.3), `collections.ts` (§5.4), `interop.ts` (§5.5 + §5.6), `error.ts` (§3), `do-notation.ts` (§5.7) — all shipped. The one module that is **not** a spec group is `thenable.ts`: it holds the single `isThenable` definition that §10.6 turns on, shared by `transforms.ts` and `do-notation.ts`. §10.6 makes *the check itself* the decision, so it gets exactly one home; do not inline a second copy. It also holds that check's **static** counterpart, `NoThenableReturn` (§10.7, widened by §10.9) — `isThenable` is strictly broader than TypeScript's notion of awaitable, and the two halves of that gap belong together. Both are internal: neither is in §5.9's export list or reachable from the barrel.
- The `./fluent` entrypoint lives in [src/fluent/](src/fluent/) — `ResultChain` landed in [#28](https://github.com/alifarooq-zk/result-kit/issues/28); `ResultAsync` arrives in [#29](https://github.com/alifarooq-zk/result-kit/issues/29). The root `.` bundle must **never** contain the fluent wrapper. That boundary is enforced by [test/fluent/boundary.spec.ts](test/fluent/boundary.spec.ts) (spec §7.3), **not by review** — it builds `dist/` itself and checks two independent things: that no `src/fluent/` source feeds the root's chunk graph (via sourcemaps), and that nothing importable from `.` is or produces a wrapper. If you touch it, re-prove it goes red; it carries a positive control for the same reason.
- If you add a new public entrypoint, update **three** files together: [tsdown.config.ts](tsdown.config.ts) (build it), the `package.json` `exports` map (publish it), and [tsconfig.json](tsconfig.json)'s `paths` (resolve it in-repo). This rule named only the first two until [#28](https://github.com/alifarooq-zk/result-kit/issues/28) added `./fluent` and missed `paths` **while following it** — the in-repo tests import relatively, so nothing caught that `@zireal/result-kit/fluent` did not resolve. The gap surfaces in [#31](https://github.com/alifarooq-zk/result-kit/issues/31), whose `examples/` compile against the bare specifier.
- **`exports` is hand-authored, not generated** (`exports: false` in [tsdown.config.ts](tsdown.config.ts)). tsdown's generator collapses `"."` to a bare string, losing spec §7.2's mandated types-first branch, and offers no way to keep `module` without also emitting `main` — which §7.2 forbids, because a `main` invites a tool to `require()` an ESM file as CJS. `publint` and `attw` still validate the hand-written result on every build.

## Coding Guidance

- Prefer the `ok(...)` / `err(...)` constructors from [src/core/result.ts](src/core/result.ts) over ad hoc result object construction. (v1's static `ResultKit.success(...)` / `ResultKit.fail(...)` are **gone** — `ResultKit` was removed in the v5 teardown, and `success` / `fail` are v1 names the spec renamed to `ok` / `err`.)
- Keep the union purely structural, per spec §2: no brand, no methods, exactly two fields per half, shallow `readonly` only. These are contracts — each is load-bearing for the §2.1 JSON round-trip guarantee.
- Keep typed error shapes aligned with the `type` and `message` convention.
- Preserve the split between the free-function core and the opt-in `/fluent` wrapper: the wrapper delegates to the core, it never reimplements it.
- **A settled `Result` input never produces an asynchronous output** (spec §10.9). A transform may short-circuit without calling its callback, so it has no way to know an async arm was selected — which is why `map`/`mapErr`/`andThen`/`orElse`/`inspect`/`inspectErr` reject a thenable-returning callback on a settled input, on both surfaces. Async work starts from a promise: `map(Promise.resolve(r), fn)` in the core, `chain.toAsync()` on `/fluent`. Do not "restore" the convenience arm — it was removed because it could not keep its promise on the `Err` branch, and it failed silently.
- Mirror source changes with tests: [test/core](test/core) for `src/core`, [test/fluent](test/fluent) for `src/fluent`.

## Verification

- Run `pnpm test` and `pnpm check` after TypeScript changes.
- Run `pnpm build` when changing public exports, packaging, or release-related files.
- **Type-level assertions are enforced by `pnpm check`, not `pnpm test`.** `vitest.config.ts` sets no `typecheck` config, so `expectTypeOf` is a runtime no-op under `vitest run` — a deliberately wrong assertion still passes. `tsc --noEmit` is what actually asserts it, and `@ts-expect-error` only bites there (`tsc` reports an unused directive when the expected error does not occur). Work is green only when **both** commands pass.

## Release Guidance

- **During the v5 rework, add no changesets.** Spec §8.2 knowingly overrides the rule below, for the `5.0.0` release only: `package.json` still declares the burned `1.2.0`, so a `major` changeset would compute `2.0.0` and `changeset publish` would **403**. [#32](https://github.com/alifarooq-zk/result-kit/issues/32) hand-sets `5.0.0` and hand-writes the changelog entry. Resume the normal flow below from `5.0.1` / `5.1.0` onward.
- For any consumer-facing bug fix, feature, or breaking change, add a changeset before finishing the work.
- Use `pnpm changeset` to create the changeset file.
- Choose the version bump based on impact:
  - `patch` for bug fixes and backward-compatible corrections
  - `minor` for backward-compatible features
  - `major` for breaking changes
- Internal-only changes that do not affect published package consumers usually do not need a changeset unless the user explicitly asks for one.
- Use `pnpm changeset:version` to apply release bumps and `pnpm changeset:publish` for publishing workflows.

## Documentation

- Link to [README.md](README.md) for installation, API surface, and usage guidance instead of duplicating large sections here — but note it is **v1-era until [#31](https://github.com/alifarooq-zk/result-kit/issues/31) rewrites it**.
- [CONTEXT.md](CONTEXT.md) carries the current domain vocabulary and is the fastest way to get the v5 terminology right.
- The `examples/` directory was removed in the teardown (both files imported the deleted v1 API). [#31](https://github.com/alifarooq-zk/result-kit/issues/31) authors the new `examples/core.ts` and must re-add `"examples"` to [tsconfig.json](tsconfig.json)'s `include`.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at the repo root). See `docs/agents/domain.md`.
