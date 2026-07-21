# ADR 0011 — Optional `/testing` subpath with Result-aware matchers

- **Status:** Accepted (Option B — root barrel helpers)
- **Date:** 2026-07-20
- **Deciders:** Ali Farooq
- **Ticket:** [Optional test-matcher subpath (`/testing`) with Result-aware matchers](https://github.com/alifaroo-q/result-kit/issues/50)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0006 — v2 package layout & entrypoints](./0006-v2-package-layout-entrypoints.md)
- **Evidence:** A real-world adoption prototype porting `@zireal/result-kit` into a Next.js codebase (context in [#31](https://github.com/alifaroo-q/result-kit/issues/31)).

## Context

Because a `Result` is plain data — never a class, never `extends Error` (spec §2) — it asserts cleanly with a structural `toEqual`:

```ts
expect(await changePlan(input)).toEqual(ok({ kind: 'noop' }));
expect(await changePlan(bad)).toEqual(err(missingBaseItem()));
```

This is a genuine differentiator over class-based `Result` libraries, where tests fight `instanceof`. It is already documented (README **Testing**, [`RECIPES.md`](../../RECIPES.md)).

The one rough edge the prototype hit: reading `.value` after asserting `Ok` needs guard boilerplate at every call site.

```ts
if (!isOk(result)) throw new Error('expected Ok');
expect(result.value.find(/* … */)).toMatchObject({ quantity: 0 });
```

## Proposal

A new optional entrypoint — `@zireal/result-kit/testing` (name TBD; `/vitest` also considered) — exporting:

- `toBeOk(value?)` / `toBeErr(error?)` — Vitest custom matchers.
- `expectOk(result): T` / `expectErr(result): E` — narrowing assertions that throw a descriptive error on the wrong branch.

Vitest is an **optional peer dependency**, referenced only from this subpath, so a consumer who never imports it ships and installs nothing extra — mirroring the `/fluent` split's "pay for what you import" property (ADR 0001).

## Why this is ADR-sized, not a papercut fix

1. **It moves the zero-dependency stance.** The package is declared **zero-dependency, zero-peerDependency** (spec, CLAUDE.md). Even an *optional* peer dep is a change to that contract and must be a deliberate decision, not an incidental one.
2. **A new public entrypoint is a four-file change** (per CLAUDE.md, learned in [#28](https://github.com/alifaroo-q/result-kit/issues/28)): `tsdown.config.ts` (build it), `package.json` `exports` (publish it), `tsconfig.json` `paths` (resolve it in-repo), **and** the §7.3 boundary test must be extended to cover the new surface.
3. **Matcher typings** (`expect().toBeOk()`) require ambient `vitest` module augmentation shipped from the subpath — a `.d.ts` authoring concern that `publint`/`attw` must still pass.

## Options

- **A — Ship `/testing` with an optional Vitest peer dep.** Best DX; costs the two points above.
- **B — Ship framework-agnostic assertion helpers only** (`expectOk`/`expectErr`, no matchers) from the root barrel — pure functions, no peer dep, no new entrypoint. Cheaper, but no `toBeOk` sugar and it adds two symbols to the frozen root surface.
- **C — Docs only.** Keep the userland `expectOk` snippet in `RECIPES.md`; ship nothing. Zero cost, zero new surface.

## Decision

**Option B — `expectOk`/`expectErr` shipped from the root barrel.** Shipping these as pure, framework-agnostic functions keeps the zero-dependency invariant intact, requires no new entrypoint, and solves the `.value` access friction users reported.

The `/testing` subpath with Vitest custom matchers (Option A) is **deferred**:
- `toBeOk`/`toBeErr` remain worth shipping, but the peer-dependency question needs maintainer direction first.
- Option A can be added on top of Option B at any time — the matchers would delegate to the same `expectOk`/`expectErr` core.

## Consequences

- **Option A is deferred.** The peer-dependency question remains open. Shipping it later is additive, not breaking.
- **`expectOk`/`expectErr` are exported from the root barrel**, adding two symbols to the public surface.
- **No invariant moves.** The package remains zero-dependency, zero-peerDependency.
- **`RECIPES.md` updated** to reference the built-in helpers instead of the userland snippet.
