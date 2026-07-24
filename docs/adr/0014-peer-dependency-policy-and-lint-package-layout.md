# ADR 0014 — Peer-dependency policy and lint-package layout

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: peer-dependency policy and lint-package layout](https://github.com/alifaroo-q/result-kit/issues/71)
- **Builds on:** [ADR 0011 — testing subpath matchers](./0011-testing-subpath-matchers.md), [ADR 0013 — lint port scope](./0013-lint-port-scope-oxlint-biome.md)
- **Evidence:** [`must-use-result` feasibility research](../research/must-use-result-linter-feasibility.md) (#70) and the [shared-source spike](../research/oxlint-eslint-shared-rule-spike.md) (#74 Q2). The structural-detection and re-export findings below are measured, not predicted.
- **Gates:** [`/testing` matchers #63](https://github.com/alifaroo-q/result-kit/issues/63) (peer-dep half) and [lint enforcement #60](https://github.com/alifaroo-q/result-kit/issues/60) (layout half).

## Context

Two maintainer calls that ADR 0011 (:53–59) and the session-1 map both parked, bundled here because they turn out to share one root: **what does "zero-peerDependency" actually promise, and about which artifact?**

1. Is an *optional* peer dependency acceptable for `/testing`'s Vitest matchers, or does "zero-peerDependency" mean zero anywhere? (ADR 0011 explicitly waited on this; gates #63.)
2. Separate repo vs. monorepo for the lint plugin packages (ESLint / Oxlint / Biome)? (Gates #60's setup.)

## Decision

### 0. The invariant is scoped to the core artifact

"Zero-dependency, zero-peerDependency" is a promise about the **install footprint of the core `@zireal/result-kit` artifact** — that a consumer who installs it to get `ok` / `err` / `Result` pulls in nothing — **not** an org-wide vow that no package published under `@zireal` may ever carry a peer dep.

The org-wide reading is self-defeating: an ESLint plugin has no zero-peer form (`eslint` is a mandatory peer, always), so an absolute reading would make the lint packages literally impossible to ship. The invariant's *value* is the core's install footprint; satellite packages (testing, lint) may carry the peer deps their nature requires.

### 1. `/testing` matchers — subpath of core, optional Vitest peer, Vitest only

Ship the Vitest matchers as a **subpath `@zireal/result-kit/testing`** with **`vitest` declared as an *optional* peer** (`peerDependenciesMeta: { vitest: { optional: true } }`) on the core `package.json`. Layer ADR 0011's Option A on top of the shipped Option B: the matchers (`toBeOk` / `toBeErr`) delegate to the already-exported `expectOk` / `expectErr`.

This preserves the invariant's *substance*. **Optional peers are not installed** — `npm install @zireal/result-kit` pulls in nothing whether or not the manifest names an optional `vitest`, and `optional: true` suppresses the missing-peer warning. Only the manifest's letter changes, not the footprint. It mirrors the `/fluent` precedent exactly (ADR 0001's "pay for what you import"): a tree-shaken subpath a non-testing consumer never sees.

**Round one is Vitest only.** Vitest is this repo's own runner ([vitest.config.ts](../../vitest.config.ts)), so the matcher `.d.ts` augmentation is dogfoodable — the only reliable way to catch ambient-augmentation bugs. Jest is additive later behind demand; Jest users are served today by the framework-agnostic `expectOk` / `expectErr` (no matcher sugar).

### 2. Lint packages — separate dedicated monorepo

The ESLint and Oxlint plugins live in a **separate dedicated repository, structured as a monorepo** (pnpm workspace), not in the core repo.

The usual reason to co-locate — shared source/types between a library and its tooling — **does not exist here.** Research #70 established that the rule must identify `Result` **structurally** (per spec §2), never by nominal import from the package (a consumer's local `type R = Result<…>` alias defeats a package-specifier match). The rule therefore never imports core; co-location buys no shared-import benefit. What remains argues for a split: keep the lean, **frozen** core repo (spec §1) free of the heavy lint toolchain (`typescript-eslint`, oxc's parser, RuleTester), keep its single-artifact release/`publint`/boundary-test machinery simple, and let the fast-iterating lint rules (ADR 0013's revisit clauses) run on their own cadence.

### 3. Monorepo internals — private bundled `rule-core`, two published host plugins

```
packages/
  rule-core/       private, unpublished — the { meta, create } module(s) + structural
                     Result matchers; zero peer deps; bundled into each plugin at build
  eslint-plugin/   @zireal/eslint-plugin-result-kit   peer: eslint (+ typescript-eslint as dep)
  oxlint-plugin/   @zireal/oxlint-plugin-result-kit   peer: oxlint — re-exports rule-core
  (later) biome-plugin/                               non-sharing GritQL port (ADR 0013)
```

ADR 0013 established that the Oxlint rule is a **re-export** of one `{ meta, create }` module — Oxlint's alpha JS-plugin API is a deliberate ESLint-v9 clone, so one module serves both hosts. That shared brain **cannot** live inside the ESLint plugin with Oxlint re-exporting across a published-package boundary — that would make `oxlint-plugin` depend on `eslint-plugin` at runtime and drag `eslint` into Oxlint users' installs. It lives in a neutral **`rule-core`** package with **zero peer deps** (pure ESTree logic); each host wrapper adds its own required peer.

`rule-core` stays **private and bundled into each plugin at build time**, so consumers only ever see two self-contained published plugins — no third versioned public artifact. This mirrors the core repo's minimal-published-surface instinct. If a third party ever needs to build their own host on the rule, publishing `rule-core` is an additive, non-breaking change.

### 4. Naming

Keep the **`@zireal` scope** and the `eslint-plugin-*` convention so ESLint's shorthand resolution works:

| Package | npm name | Referenced in config as |
|---|---|---|
| ESLint plugin | `@zireal/eslint-plugin-result-kit` | `@zireal/result-kit` |
| Oxlint plugin | `@zireal/oxlint-plugin-result-kit` | (oxlint's equivalent) |

A flatter `@zireal/result-kit-eslint` was rejected for the ESLint package specifically: it breaks ESLint's shorthand and forces users to spell the full package name. Oxlint's plugin-naming convention is younger — mirror the ESLint form unless oxlint's loader mandates otherwise (#60 confirms the exact form).

## Consequences

- **#63 (`/testing`) is unblocked.** It is a four-file entrypoint change (ADR 0011:40 — [tsdown.config.ts](../../tsdown.config.ts), `package.json` `exports`, [tsconfig.json](../../tsconfig.json) `paths`, **and** the §7.3 boundary test extended to `/testing`), plus the optional `vitest` peer and the ambient matcher `.d.ts` that `publint`/`attw` must still pass.
- **#60 (lint enforcement) is unblocked** on layout: a new repo scaffolded as a pnpm-workspace monorepo with the three packages above.
- **Host plugins carry their linter as a *required* peer** (`eslint` / `oxlint`). This is inherent to what a plugin is, and it is precisely why the lint rules cannot ship as core subpaths — a required `eslint` peer on the core artifact would violate §0's promise. `rule-core` itself has zero peers.
- **The fully-shared `rule-core` is contingent on ADR 0013:46's oxc-parser parity spike** for the "return type textually mentions `Result`" matcher (oxlint parses with oxc, not `@typescript-eslint/parser`). The import-provenance matcher is safe to share. Worst case, that one matcher branches per host inside `rule-core`; the layout is unaffected.
- **Nothing here reverses.** Publishing `rule-core`, adding Jest, adding the Biome package, and promoting Oxlint to full fidelity (ADR 0013's triggers) are all additive.
- **The core invariant is unchanged.** The core `@zireal/result-kit` artifact remains zero-dependency and zero-installed-peer; only the manifest gains an optional, uninstalled `vitest` entry scoped to the `/testing` subpath.
