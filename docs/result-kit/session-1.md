# Analysis: @zireal/result-kit — post-5.0 10x opportunities

Session 1 | Date: 2026-07-24

## Current Value

`@zireal/result-kit` 5.0.0 is a zero-dependency, ESM-only TypeScript `Result` library with two surfaces over one implementation: a free-function core (`@zireal/result-kit`) and an opt-in fluent wrapper (`/fluent`) that delegates to it (README.md:7, spec §4).

**The core action** users take: model a fallible operation as `Result<T, E>` — construct with `ok`/`err`, transform with `map`/`andThen`, and collapse at a boundary with `match`/`unwrapOr*`. The `TypedError` convention (`defineError`/`defineErrors`) gives narrowable structured errors; `safeTry` do-notation flattens chains; `combineWithAllErrors` + `groupByType`/`prettifyErrors` handle accumulation.

**The structural moat**, unique in the genre: the union is purely structural and brandless (spec §2), so a `Result` survives `JSON.stringify`, an HTTP boundary, or a worker hop *and is still a `Result`* (README.md:132–136). neverthrow, ts-results-es, and Effect are all class-based — their values die at serialization. Nobody else in the genre can make the §2.1 round-trip guarantee.

**Who uses it and why** (from RECIPES.md's topics, which map the real pain): teams gradually adopting `Result` inside codebases that throw; services mapping errors to HTTP responses; test authors asserting on results. The two post-5.0 issues (#50 `/testing` matchers, #51 `okConst`) both came out of a real Next.js adoption prototype (#31) — adoption friction, not core-surface gaps, is where demand shows up.

**Known unmet demand** (evidence, not assumption):
- ADR 0011 *deferred* the `/testing` subpath with Vitest `toBeOk`/`toBeErr` matchers pending a peer-dependency policy decision (docs/adr/0011:53–59).
- Spec §1 backlogged, without rejecting on merit: an `eslint-plugin-result-kit` must-use rule, category subpaths, and a migration codemod (spec §1 Out list).
- RECIPES.md's HTTP-mapping recipe and its `details.status` gotcha reveal latent demand for boundary/framework integration the core deliberately omits.
- The landscape research reserved a `.with().exhaustive()`-style matcher "only for open-ended typed-error unions" (docs/research/api-packaging-landscape.md:82).

## The Question

The core is shipped and frozen. What makes this package 10x more valuable — not a nicer `map`, but the moves that change what the package *is* for its users?

The through-line of this session: **the core is done; the 10x lives in the ecosystem around it** — enforcement (lint), production (schema interop), consumption (testing), and transport (the wire story). Each one exploits an asset the package already holds and competitors structurally can't match.

---

## Massive Opportunities

### 1. Lint enforcement — the must-use rule across ESLint, Biome, and Oxlint

**What**: A lint story covering the three linters teams actually run in 2026, with rules: `must-use-result` (a `Result`-returning call whose value is dropped or never collapsed is an error — Rust's `#[must_use]`), `no-throw-in-result-fn` (a function declared to return `Result` should not `throw`), and `no-unhandled-err-branch` (accessing `.value` without narrowing). Three delivery vehicles, one rule vocabulary: an `eslint-plugin-result-kit` package (typed rules via `@typescript-eslint` services — the full-fidelity implementation), an Oxlint port (JS plugin API, with the type-aware tier via Oxlint's tsgolint-backed type-aware mode as it matures), and a Biome port (GritQL plugin) for the rules expressible without type information.

**Capability honesty**: `must-use-result` at full fidelity needs type information — only ESLint's typed rules (and Oxlint's emerging type-aware mode) can resolve "does this call return a `Result`?" through generics and aliases. The Biome/Oxlint syntax-level ports cover the common direct-call cases and keep the rule names consistent, so a team migrating linters keeps the enforcement vocabulary even where fidelity temporarily drops. Document the tier each linter gets; never claim parity that isn't there.

**Why 10x**: This closes the single biggest gap between `Result` in TypeScript and `Result` in Rust. Today, `const r = mightFail(); doNext();` silently swallows an error — the exact failure mode `Result` exists to prevent, and the type system cannot catch it. Half of Rust's error-handling safety is the compiler nagging, not the type. With the lint rule, result-kit's promise upgrades from "errors are values" to "errors are values *you provably handled*". No genre competitor ships this (neverthrow's community plugin is a single shallow rule); a first-class, typed, maintained plugin makes the package the safe default for teams, not just the ergonomic one.

**Unlocks**: Enterprise/team adoption ("we can enforce this in CI"); makes every other feature safer to hold; a platform beachhead (the plugin package can later host boundary rules, e.g. "no `unwrapOrThrow` outside `src/http/`").

**Effort**: High (typed lint rules are fiddly; three plugin APIs to track; separate packages with their own release trains). Zero cost to the core's zero-dep stance — these are dev-time packages.
**Risk**: False positives on generic wrappers over `Result` (the same problem §10.9 fought at the type level); maintenance surface across three linters' plugin APIs, two of which (Biome GritQL, Oxlint JS plugins) are still moving targets.
**Score**: 🔥

### 2. Standard Schema interop — `fromSchema`

**What**: An adapter from any [Standard Schema v1](https://standardschema.dev) validator (Zod 4, Valibot, ArkType, Effect Schema all implement it) to a `Result`: `fromSchema(schema)` returns `(input: unknown) => Result<Output, TypedError<'validation_failed', { issues }>>` (async-capable via the same value-or-promise convention transforms already use). Standard Schema is a **types-only** spec — the adapter needs zero runtime and zero peer dependencies, so it can live in the core or a `/schema` subpath without moving the zero-dep stance.

**Why 10x**: Validation is the #1 real-world *producer* of typed errors — it's where most codebases first meet "failure as a value". Today every adopter hand-writes the same `parse → try/catch → err(...)` shim per schema library. One function makes result-kit the error-handling layer for the entire validation ecosystem, and the accumulation pipeline the package already ships (`combineWithAllErrors` → `groupByType` → `prettifyErrors`) becomes the natural downstream of every form validation. It converts three shipped-but-underused features into a complete story.

**Unlocks**: "Zod gives you the type, result-kit gives you the failure" positioning; form-validation and API-input use cases become copy-paste; pulls in users who arrive via their schema library's community rather than via the Result genre.

**Effort**: Medium-High (the function is small; the design care is mapping `issues[]` onto `TypedError` without inventing the `path` field spec §3 deliberately lacks — this needs an ADR, since #18's formatter history already hit that wall).
**Risk**: The issue→TypedError mapping is a one-way door; getting `details` shape wrong bakes in a bad contract.
**Score**: 🔥

### 3. Typed errors across the wire — own the serialization moat

**What**: Make the JSON round-trip guarantee a *product*, not a footnote: (a) `parseResult(json: unknown): Result<Result<unknown, unknown>, ParseError>` — a validating re-entry point for a `Result` that crossed a boundary, so the receiving side doesn't blind-cast; (b) a documented, first-class pattern (README hero section + recipe) for returning `err(...)` from Next.js server actions / RPC endpoints and narrowing on the client with full types; (c) optionally a tiny `Result<T,E>`-preserving `fetch` recipe.

**Why 10x**: This is the one thing competitors structurally cannot copy — a neverthrow `Result` is a class instance and dies at `JSON.stringify`; result-kit's crosses server→client intact *by spec* (§2.1). Server actions and RPC are exactly where the industry's error handling is worst (thrown errors are swallowed and stringified by the framework). "End-to-end typed errors, server to client, no codegen" is a claim only this package can make, and it turns a defensive design constraint (no brand) into the headline feature.

**Unlocks**: A whole second audience (full-stack Next/Remix/tRPC users vs. backend-service users); future framework adapter packages have a story to plug into; makes the class-based incumbents' architecture look like the legacy choice.

**Effort**: Medium (mostly `parseResult` + documentation/positioning; no framework runtime dependency needed).
**Risk**: Overreach into framework-adapter territory the spec ruled out — keep it to the validating parser plus recipes, not adapters.
**Score**: 🔥

### 4. `Option`/`Maybe` companion type

**What**: A sibling `Option<T>` union with the same structural/serializable philosophy.
**Why 10x**: It wouldn't be — `fromNullable` already covers the absent-value seam, and spec §1 rules this out as feature expansion contradicting the lean-down identity.
**Unlocks**: Mostly scope creep and a second surface to maintain.
**Effort**: High.
**Risk**: Identity dilution; re-litigates a settled decision.
**Score**: ❌

---

## Medium Opportunities

### 1. `/testing` subpath with Vitest/Jest matchers (ADR 0011 Option A, revived)

**What**: `@zireal/result-kit/testing` exporting `toBeOk`/`toBeErr`/`toBeOkWith`/`toBeErrMatching` matchers that delegate to the shipped `expectOk`/`expectErr`, with an *optional* peer dependency. ADR 0011 explicitly designed this as an additive later step; the blocker was only the peer-dep policy decision.

**Why 10x**: Test ergonomics are the daily touchpoint — every adopter writes result assertions dozens of times a day, and matcher failure output (`expected Ok, got Err { type: 'not_found' }` with a proper diff) is the difference between a 5-second and a 2-minute debug. It also removes the last "neverthrow has nicer tests" objection.

**Impact**: Every existing user, multiple times daily; the deferred half of an already-accepted ADR, so design risk is near zero.
**Effort**: Medium (the matchers are thin; the work is the peer-dep policy ADR and the exports-map addition — which the CLAUDE.md three-files rule now makes safe).
**Score**: 🔥

### 2. `matchType` — exhaustive object-literal matching over `TypedError` unions

**What**: `matchType(error, { not_found: (e) => ..., forbidden: (e) => ... })` — exhaustive by construction over a `TypedError` union (compile error on a missing variant), each handler receiving the narrowed variant with its own `details`. The scoped-down version of the `.with().exhaustive()` idea the landscape research reserved (api-packaging-landscape.md:82).

**Why 10x**: `switch (error.type)` narrows but is not exhaustive-checked without `never` gymnastics, and it's a statement, not an expression. This is `match` (already the genre's beloved terminal) extended to the error dimension — it makes `defineErrors` unions dramatically more pleasant exactly where they're used most: HTTP status mapping (RECIPES' own recipe would collapse to three lines).

**Impact**: Everyone using `TypedError` unions — the package's differentiating convention — at every boundary.
**Effort**: Medium (type-level exhaustiveness over a discriminated union is well-trodden; needs a `_`/default-arm decision).
**Score**: 👍

### 3. HTTP boundary helpers (`toHttpResponse` / status mapping)

**What**: A helper formalizing RECIPES' HTTP recipe: map a `TypedError` union to status codes via a typed table, produce a Response-shaped object.
**Why 10x**: The recipe's existence proves demand, but the framework-agnostic version is 15 lines of userland code, and the framework-specific versions walk straight into the adapter territory spec §1 closed. Better served by `matchType` (#2) plus the existing recipe.
**Impact**: Backend users only, and only marginally over the recipe.
**Effort**: Medium.
**Score**: ❌

### 4. v1→v5 migration codemod

**What**: A jscodeshift/ts-morph codemod automating MIGRATION.md's rename table.
**Why 10x**: For the v1 install base it's real, but that base is small, MIGRATION.md's table already works, and the one dangerous rename (`unwrapOrThrow`'s silent semantic change) *cannot* be safely auto-migrated — the codemod would launder exactly the case that needs human eyes.
**Impact**: One-time, shrinking audience.
**Effort**: Medium-High.
**Score**: ❌

### 5. Retry/policy combinators for `ResultAsync`

**What**: `.retry(n, backoff)` / policy-driven recovery on the async wrapper.
**Why 10x**: Genuinely useful, but it's the first step onto Effect's turf (schedules, runtimes) — the exact fully-featured-framework identity the paradigm ADR defined the package against. `orElse` + userland loops cover the honest 80%.
**Effort**: High (correct retry semantics, cancellation).
**Score**: ❌

---

## Small Gems

### 1. AI-agent adoption kit — `llms.txt` + a published agent skill

**What**: Ship an `llms.txt` (and `llms-full.txt`) distilling the API, the TypedError convention, and the top gotchas (safeTry widening, `Ok<void>` round-trip, `.toAsync()` seam); plus a `docs/agents/using-result-kit.md`-style skill consumers can drop into their repo so *their* coding agents produce idiomatic result-kit code.

**Why powerful**: In 2026 a large share of library-adoption decisions and nearly all boilerplate are written by coding agents. The package's gotchas are exactly the kind agents get wrong from training-data priors (they'll write neverthrow idioms). The raw material already exists — CONTEXT.md *is* the distillation — so this is hours of work for a durable reach multiplier no genre competitor has.

**Effort**: Low.
**Score**: 🔥

### 2. `parseResult` — validating re-entry from `unknown`

**What**: One guard-shaped function that checks an `unknown` (parsed JSON, worker message) is a well-formed `Result` and returns it typed — the safe landing half of the round-trip guarantee. (Standalone gem; also the keystone of Massive #3.)
**Why powerful**: Every wire-crossing user currently writes `as Result<T, E>` — a lie the moat's marketing encourages them to tell. Ten lines closes the loop honestly.
**Effort**: Low.
**Score**: 👍

### 3. Rich matcher failure output for `expectOk`/`expectErr`

**What**: When `expectOk` throws on an `Err`, include a `prettifyErrors`-formatted rendering of the error (when it's a `TypedError`) in the thrown message, not just "expected Ok".
**Why powerful**: Turns every wrong-branch test failure from "go add a console.log" into an immediate diagnosis. Composes with (and survives independently of) the `/testing` subpath.
**Effort**: Low.
**Score**: 👍

### 4. Publish to JSR

**What**: Dual-publish to JSR for Deno/Bun-native reach.
**Why powerful**: The package is already ESM-only, zero-dep TypeScript — the ideal JSR citizen; near-zero marginal cost for a new distribution channel.
**Effort**: Low (CI job + slow-types check).
**Score**: 🤔

### 5. `Symbol.for('nodejs.util.inspect.custom')` pretty-printing

**What**: Nicer console rendering of `TypedError`.
**Why powerful**: It isn't, on inspection — the values are plain objects by contract (§3), and attaching a symbol method violates "no methods" and risks the round-trip carve-outs. Killed by the package's own constitution.
**Effort**: Low.
**Score**: ❌

---

## Recommended Priority

### Do Now

1. **AI-agent adoption kit** (Small #1) — hours of work, compounding reach, zero design risk. Ship first.
2. **`/testing` matchers** (Medium #1) — the ADR is already written; unblock it with a one-page peer-dep policy decision and ship the deferred Option A.
3. **Lint enforcement** (Massive #1) — start now as separate packages; it's the longest lead time and the deepest moat. First deliverable: `must-use-result` on ESLint (full typed fidelity), then the Oxlint and Biome ports of the same rule name.

### Do Next

4. **Standard Schema `fromSchema`** (Massive #2) — write the issues→`TypedError` mapping ADR first (the `path` question is the hard part), then the adapter is small.
5. **Typed errors across the wire** (Massive #3) — `parseResult` (Small #2) plus the server-action recipe and README repositioning. Sequence after `fromSchema` so the wire story can include validated input end-to-end.
6. **Rich `expectOk`/`expectErr` failure output** (Small #3) — fold into the `/testing` work.

### Explore

7. **`matchType`** (Medium #2) — prototype the exhaustiveness typing against `ErrorsOf` unions; promote to Do Next if the types hold without `any`.
8. **JSR publishing** (Small #4) — cheap experiment once the release train is calm.

---

## Questions

### Answered

- **Q**: Should the core surface itself grow? **A**: No — every 🔥 here is ecosystem (lint, testing, schema seam, wire story) or additive subpath. The frozen core is an asset; spec §10.14 (`defineErrors` as post-freeze additive minor) is the precedent for how things land.
- **Q**: Does anything here move the zero-dependency stance? **A**: No. Standard Schema is types-only; the ESLint plugin is a separate package; `/testing`'s peer dep is optional and was ADR 0011's designed-for path.
- **Q**: Why not adapters (Nest, fetch, HTTP)? **A**: Spec §1 closed them on the merits, and the demand they represent is better served by `matchType` + recipes + the wire story.

### Blockers

- **Q**: Peer-dependency policy — is an *optional* peerDependency acceptable for a subpath, or does "zero-peerDependency" mean zero anywhere? Gates Do Now #2. (Maintainer call; ADR 0011:57 explicitly waits on it.)
- **Q**: Separate-repo vs. monorepo for the lint plugin packages (ESLint / Oxlint / Biome)? Gates Do Now #3's setup.
- **Q**: For `fromSchema`: does the issue payload get a `path`-bearing `details` shape, given spec §3 deliberately has no top-level `path`? Needs an ADR before any code.

## Tracking

Phased delivery is charted on the wayfinder map [Map: post-5.0 ecosystem — lint, schema, wire, testing (#69)](https://github.com/alifaroo-q/result-kit/issues/69), which carries these nine as `wayfinder:task` children plus four gating decision tickets (#70–#73), with native blocked-by edges expressing the phases.

GitHub issues filed 2026-07-24 for every non-❌ opportunity (the ❌ ones are deliberately not tracked — they are decided against, not deferred):

| Issue | Opportunity | Score |
|---|---|---|
| [#60](https://github.com/alifaroo-q/result-kit/issues/60) | Lint enforcement across ESLint / Biome / Oxlint (Massive #1) | 🔥 |
| [#61](https://github.com/alifaroo-q/result-kit/issues/61) | Standard Schema `fromSchema` (Massive #2) | 🔥 |
| [#62](https://github.com/alifaroo-q/result-kit/issues/62) | Typed errors across the wire (Massive #3) | 🔥 |
| [#63](https://github.com/alifaroo-q/result-kit/issues/63) | `/testing` matchers, ADR 0011 Option A (Medium #1) | 🔥 |
| [#64](https://github.com/alifaroo-q/result-kit/issues/64) | `matchType` exhaustive error matching (Medium #2) | 👍 |
| [#65](https://github.com/alifaroo-q/result-kit/issues/65) | AI-agent adoption kit (Small #1) | 🔥 |
| [#66](https://github.com/alifaroo-q/result-kit/issues/66) | `parseResult` validating re-entry (Small #2) | 👍 |
| [#67](https://github.com/alifaroo-q/result-kit/issues/67) | Rich `expectOk`/`expectErr` failure output (Small #3) | 👍 |
| [#68](https://github.com/alifaroo-q/result-kit/issues/68) | JSR publishing (Small #4) | 🤔 |

## Next Steps

- [ ] Decide: optional-peer-dependency policy (one-page ADR; unblocks `/testing`).
- [ ] Draft: `llms.txt` from CONTEXT.md + README gotchas; add an agent-skill doc under `docs/agents/`.
- [ ] Research: `@typescript-eslint` typed-rule feasibility for `must-use-result` over generic wrappers (the §10.9 false-positive class); in the same pass, map what tier of the rule Biome's GritQL plugins and Oxlint's JS-plugin/type-aware modes can each express today.
- [ ] Draft ADR: Standard Schema issues → `TypedError` `details` mapping (the `path` question).
- [ ] Validate assumption: that server-action users actually hit the swallowed-error pain — prototype the wire recipe in the #31 examples app.
- [ ] Prototype: `matchType` exhaustiveness typing against an `ErrorsOf` union.
