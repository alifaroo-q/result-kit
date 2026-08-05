# ADR 0011 — Optional `/testing` subpath with Result-aware matchers

- **Status:** Accepted (Option B — root barrel helpers). **Option A's deferral is now closed:** [ADR 0014 §1](./0014-peer-dependency-policy-and-lint-package-layout.md) answered the peer-dependency question, and `@zireal/result-kit/testing` shipped in [#63](https://github.com/alifaroo-q/result-kit/issues/63) — layered on Option B exactly as this ADR predicted, with every matcher delegating to `expectOk` / `expectErr`. See the Consequences section.
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

- ~~**Option A is deferred.** The peer-dependency question remains open. Shipping it later is additive, not breaking.~~ — **Closed 2026-08-05 by [#63](https://github.com/alifaroo-q/result-kit/issues/63).** It was additive, exactly as predicted. Three things this ADR got right and one it did not:

  - The **delegation** held. Every matcher failure message is thrown by `expectOk` / `expectErr` rather than authored in the matcher, so [#67](https://github.com/alifaroo-q/result-kit/issues/67)'s prettified output will arrive with no edit in `src/testing/`.
  - The **four-file change** (this document, line 40) was right, and the boundary test was the half worth naming — it now asserts the optional peer on the *artifact*: the shipped chunk imports no bare specifier at all.
  - The **ambient `.d.ts` augmentation** was correctly flagged as the fiddly part. It survives `rolldown-plugin-dts` intact, and `publint` / `attw` pass.
  - What this ADR **assumed and should not have**: `toBeOk(value?)` / `toBeErr(error?)`. #63 shipped **four** matchers instead — `toBeOk` / `toBeOkWith` / `toBeErr` / `toBeErrWith` — because an optional argument cannot cleanly distinguish "assert the branch" from "assert a value that happens to be `undefined`". Both `*With` forms are deep equality; partial matching is Vitest's own `expect.objectContaining`, which they honour, so no third semantic was added.

  One limit worth stating, because this ADR's Context is about `.value` access and could be read as solved: **the matchers do not narrow, and cannot.** A Vitest matcher's signature says nothing about its subject, so Option B's `expectOk` / `expectErr` remain the answer to the exact friction that motivated this document. The matchers assert; the helpers extract.
- **`expectOk`/`expectErr` are exported from the root barrel**, adding two symbols to the public surface.
- ~~**No invariant moves.** The package remains zero-dependency, zero-peerDependency.~~ — **superseded by [ADR 0014 §0](./0014-peer-dependency-policy-and-lint-package-layout.md).** True of Option B; no longer true of the manifest once #63 landed. The manifest now declares an **optional** `vitest` peer. What ADR 0014 established is that the invariant was always about the **core artifact's install footprint**, and an optional peer is never installed — so the substance is unchanged while the letter is not. Kept visible rather than rewritten, because the change of stance is the thing a later reader needs to see.
- **`RECIPES.md` updated** to reference the built-in helpers instead of the userland snippet.
