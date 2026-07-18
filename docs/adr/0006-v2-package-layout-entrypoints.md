# ADR 0006 — v2 package layout & entrypoints

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 package layout & entrypoints](https://github.com/alifaroo-q/result-kit/issues/15)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifaroo-q/result-kit/issues/8)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0004 — v2 full API surface / method inventory](./0004-v2-api-surface-method-inventory.md)
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md), [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## Context

ADR 0001 fixed the paradigm (modular free-function core over a plain method-less union + an opt-in fluent wrapper as the documented hero) and named the packaging hazard it creates: **shared internals**, not the wrapper class itself, are what drag a whole surface into a core-only consumer's bundle (the ramda-vs-es-toolkit lesson). ADR 0004 locked the operational surface — **~26 free functions** plus their fluent mirrors. This ADR decides how that surface is *shipped*: module format, entrypoints, the `exports` map, the toolchain/runtime floors, and how the tree-shaking differentiator is defended through implementation.

The research landscape ([`api-packaging-landscape.md`](../research/api-packaging-landscape.md)) steers most of the mechanics: a flat self-tree-shakable barrel (no `/esm` deep-path hack — date-fns v2's footgun), `sideEffects: false`, `exports` as the source of truth, `publint` + `attw` in the build. Two threads were genuinely open — **category subpaths now vs. later**, and **dual ESM+CJS vs. ESM-only** — and are decided here, along with a toolchain-modernization directive raised during the grilling (TypeScript 7 / modern target).

### Destination redraw — ESM-only

The map's original destination committed to "ESM-first with **ESM+CJS** output," carrying forward v1's dual build. The grilling **reopened and redrew** that: v2 ships **ESM-only**. This is a scope amendment to the destination, recorded here and reflected in the map body. Rationale: unflagged `require(esm)` (Node ≥ 22.12) means a CJS consumer can still load an ESM-only package at runtime, so shipping a second format buys shrinking upside against permanent cost — the split `.d.mts`/`.d.cts` files and the dual-package "masquerading types" hazard class the research otherwise steers us to mitigate. Dropping CJS deletes that hazard class outright.

## Decision

### 1. Module format — ESM-only

v2 ships **only ESM**. No CJS output; no `.cjs`; no split type files. A CJS consumer reaches v2 via `require(esm)` (guaranteed by the Node floor, §3) or dynamic `import()` — never a plain synchronous `require()` of a CJS artifact, because none is published.

Consequence: the type surface is a **single `.d.ts`** per entry (not `.d.mts` + `.d.cts`), and the "masquerading types" dual-package hazard cannot occur.

### 2. Entrypoints — exactly three, no category subpaths

```
.              → flat, self-tree-shakable barrel: all ~26 free functions + the public types
./fluent       → the opt-in fluent wrapper (ADR 0001 §4 hero path) + ResultAsync (ADR 0005)
./package.json → the manifest itself
```

**No** category subpaths (`/collections`, `/interop`, `/errors`, …) in v2. The decisive fact: with a flat barrel + `sideEffects: false`, subpaths deliver **zero** bundle benefit — the barrel already tree-shakes to the byte (es-toolkit's `pick` = 132 B *from the barrel*). Subpaths pay off only when the barrel *can't* tree-shake (shared internals / side effects) or at date-fns/es-toolkit scale (200+ fns) as a discovery aid. At ~26 functions they would only add permanent, versioned public API and a category taxonomy to maintain. If the surface ever grows, subpaths are an **additive minor**, not a break.

The v1 entrypoints `./core`, `./fp-ts`, `./nest` are **all removed** (`./core` collapses into the root barrel; `./fp-ts` and `./nest` are out of scope per the destination). No `/esm` deep-path hack.

### 3. Runtime & toolchain floors

- **`engines.node` = `>=22.12`** — raised from v1's `>=20`. Aligns the floor with unflagged `require(esm)`, so *every* supported Node can load the ESM-only package (a CJS consumer's `require()` works at runtime on all supported versions).
- **Dev toolchain: TypeScript 7 (native/`tsgo`)** — build and `pnpm check` run on the [native Go port](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) for its 8–12× typecheck speedup. Caveat carried forward: TS 7 **does not yet expose a stable programmatic API** (promised for 7.1), so tools that *embed* the compiler API — notably **`attw`** — may need to pin the TS 6 line until 7.1. This does not affect what we emit.
- **Emit target: `ES2023`** — all native on the Node 22.12 floor; no downleveling, smaller and cleaner output.
- **Consumer types floor: TypeScript `6.0+`** — TS 6.0 is the *bridge* release; code that compiles cleanly on TS 6 (with `stableTypeOrdering`, no deprecation flags) compiles **identically** on TS 7. A `6.0+` floor therefore covers **both** TS 6 and TS 7 consumers with one commitment, while still permitting modern `.d.ts` features. TS 7 is documented as the *recommended* consumer compiler for speed, not a hard requirement.

### 4. `package.json` shape

```jsonc
{
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=22.12" },

  "module": "./dist/index.js",     // legacy fallback for non-exports-aware tooling → ESM
  "types":  "./dist/index.d.ts",   // single .d.ts — no split, no masquerading-types hazard
  // no "main": v2 publishes no CJS artifact

  "exports": {
    ".":        { "types": "./dist/index.d.ts",        "default": "./dist/index.js" },
    "./fluent": { "types": "./dist/fluent/index.d.ts", "default": "./dist/fluent/index.js" },
    "./package.json": "./package.json"
  }
}
```

- **`types` condition first** in each `exports` branch (guards the "types last → wrong resolution" hazard even with a single format).
- **`"main"` is dropped** — declaring one would invite a tool to `require()` an ESM file as CJS. `"module"` + `"types"` remain only as legacy fallbacks for tooling that doesn't read `exports`.
- **`./package.json` is exported** (tooling convention).
- **`publint` + `attw` stay in the build** — they catch exactly the resolution regressions this shape depends on (and `attw` should report a clean ESM-only resolution).
- **Peer/`dependencies` fallout** (from the destination, applied here): remove the `fp-ts` runtime dependency and the `@nestjs/common` peer dependency + `peerDependenciesMeta`; the package becomes **zero-dependency, zero-peerDependency**.

### 5. Fluent-boundary guarantee — mandated automated guard

ADR 0001's headline differentiator (a tree-shakable core neverthrow structurally can't offer) survives only if the **root `.` bundle never contains the fluent wrapper**. The rule — *`/fluent` imports only the core functions it delegates to; the barrel never re-exports the wrapper* — is stated in prose but **must not rely on prose alone**. The execution effort **must** add an automated guard that fails loudly on regression, e.g. one of:

- a **size budget** on the built `.` entry, or
- a **test** that imports only from `.` and asserts the fluent wrapper class is **absent** from the built chunk.

This is over and above `publint`/`attw` (which check resolution, not bundle contents).

## Rejected alternatives

- **Keep dual ESM+CJS (the original destination).** Widest drop-in compatibility and no destination redraw — but `require(esm)` on the Node ≥ 22.12 floor already lets CJS consumers load ESM, so the second format buys marginal reach against the permanent cost of split `.d.mts`/`.d.cts` and the masquerading-types hazard. Rejected — ESM-only; destination redrawn.
- **Category subpaths now (`/collections`, `/interop`, …).** Discovery/namespacing structure up front — but zero tree-shaking gain over the barrel at this surface size, and it locks category names as versioned public API forever. Rejected — additive-minor later only if the surface grows.
- **Keep `engines.node >=20`.** Widest runtime reach — but leaves a gap where a supported Node can't `require(esm)` the ESM-only package, weakening the "CJS can still load us" story that makes ESM-only palatable. Rejected — raised to `>=22.12`.
- **Consumer types floor at the latest / TS 7 only.** Simplest to state and maximally modern — but forces every consumer onto a brand-new compiler just to type-check against us, stacked on the ESM-only + Node breaks. Rejected — TS `6.0+`, which (as the bridge) already covers TS 7 identically. `TS 5.4+` was also considered and rejected as looser than the chosen modern posture.
- **Documented fluent-boundary invariant only (no CI guard).** Leaner spec — but the guarantee erodes silently the first time internals are restructured. Rejected — mandate an automated guard.
- **Emit a `.mjs` extension.** Unambiguous regardless of `type` — but redundant under `"type": "module"` + ESM-only; `.js` is cleaner. Minor; `.js` chosen.

## Consequences

- **Ripple to ADR 0001.** ESM-only removes the "ESM+CJS `instanceof` dual-package hazard" that ADR 0001 cited as *one* justification for the plain-union source of truth. That justification is now **moot**, but ADR 0001's decision **stands unchanged** — the plain-union interchange type rests independently on serialization (JSON round-trip, ADR 0003) and the byethrow corroboration. No reversal; a forward note is added to ADR 0001.
- **Feeds the migration story ([#19](https://github.com/alifaroo-q/result-kit/issues/19)).** v2 now carries **three** breaking axes beyond the API rework for #19 to document: ESM-only (no CJS artifact), Node `>=22.12`, and a TS `6.0+` consumer floor — plus the removed `./core` / `./fp-ts` / `./nest` entrypoints and the dropped `fp-ts` dep / `@nestjs/common` peer.
- **Implementation (execution effort, not now):** update `tsdown.config.ts` (two entries: `.`, `./fluent`; ESM-only; `target: ES2023`) and package `exports` **together** (ADR references [CLAUDE.md](../../CLAUDE.md)'s "new public entrypoint" rule); remove `fp-ts` + `@nestjs/common`; add the §5 boundary guard; keep `publint`/`attw`; add the changeset (a **major**) at that time.
- **`exports`, `engines`, and the entrypoint set are now fixed** — the remaining design fog for the spec is the `?`/do-notation helper ([#16](https://github.com/alifaroo-q/result-kit/issues/16)); once that lands, #19 completes the v1→v2 mapping and the spec is handoff-ready.
