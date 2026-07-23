# Research: `must-use-result` feasibility across ESLint, Oxlint, and Biome

> Resolves the research ticket *"must-use-result rule feasibility across ESLint, Oxlint, and Biome"* ([#70](https://github.com/alifaroo-q/result-kit/issues/70)), on the map *post-5.0 ecosystem* ([#69](https://github.com/alifaroo-q/result-kit/issues/69)).
> Gates [Lint enforcement #60](https://github.com/alifaroo-q/result-kit/issues/60) (session-1 Massive #1, Do Now).
> Sources: vendor primary docs, the two prior-art ESLint plugins' source, and a **TypeScript compiler-API probe run against this repo's own `src/`** (method and full output in [Appendix A](#appendix-a--the-probe)).

---

## TL;DR

Three findings, in descending order of impact on #60.

1. **The §10.9 false-positive class does not transfer to a lint rule.** It was feared because §10.9 fought generic wrappers at the *type* level. But a lint rule asks its question at **call sites**, where generics are already instantiated — and the probe confirms a call through an unconstrained generic wrapper (`withLog(() => findUser(id))`) types as `Result<…>` with the alias symbol intact, pointing at `src/core/result.ts`. **The risk that gated this ticket is not real.** The residual risks are all *false negatives*, which are safe, plus one genuine false-positive source (`any`) with a known fix.

2. **The identification strategy must be structural, not nominal — and that is spec-faithful, not a compromise.** A `TypeOrValueSpecifier` package match on `Result` from `@zireal/result-kit` **fails on a consumer's local alias** (`type MyResult = Result<number, E>` reports `aliasSymbol: "MyResult"`, declared in the consumer's file) and on any hand-rolled `{ ok, value }`. Under **spec §2** those *are* `Result`s — the union is purely structural and brandless — so a structural check is the definition, not an approximation. The no-brand decision that makes the wire story possible (§2.1) is the same one that removes nominal identity from the linter; they are one trade, and it lands on the right side.

3. **The tier story is worse than session-1 assumed; the TypeScript-7 question is not a problem.** Oxlint **explicitly does not support custom type-aware rules** — its type-aware tier is a fixed 59-rule port of typescript-eslint's own rules, not a host for ours. Biome's GritQL plugins have no access to its inference engine, and the 2026 roadmap commits to nothing there. So **exactly one linter can host the full-fidelity rule today, and it is ESLint**. The TypeScript-7 angle turned out to be a footnote rather than a finding: **every probe case reproduces identically on TS 7's own checker**, and Microsoft ships a documented side-by-side story for the tools that still need the 6.x-shaped API. See §1.5.

**Verdict for #60: proceed, ESLint-first, unblocked on the false-positive question.** Re-scope the Oxlint and Biome ports from "same rule, lower tier" to "syntax-tier rule, different name-space".

---

## Per-linter capability table

| | **ESLint** (`@typescript-eslint`) | **Oxlint** | **Biome** |
|---|---|---|---|
| Custom rule host | ✅ mature, stable API | ✅ JS plugins, **alpha** | ✅ GritQL plugins |
| Custom rule sees **types** | ✅ `services.getTypeAtLocation`, full `ts.TypeChecker` | ❌ **explicitly unsupported** — *"Lint rules that rely on TypeScript type-awareness"* is listed under "Not supported yet" | ❌ no plugin access to the inference engine |
| Type-aware built-ins exist? | ✅ (this is the origin) | ✅ 59/61 rules, via tsgolint — **a fixed port, not extensible** | ✅ first type-aware rules shipped — **built-ins only** |
| Tier `must-use-result` can reach | **Full** — types resolve through wrappers, aliases, unions | **Syntax only** | **Syntax only** |
| TS 7 / `tsgo` ready | ⚠️ not natively — typescript-eslint still wants the 6.x-shaped API; Microsoft's side-by-side `@typescript/typescript6` covers it (§1.5) | ✅ tsgolint *is* typescript-go | n/a — own inference engine, no `tsc` |
| Plugin-API stability risk | Low | **Alpha, moving** | Moving; no 2026 roadmap commitment |

The "syntax only" tier is much weaker than session-1's *"cover the common direct-call cases"* implies. Without types, a rule cannot tell `findUser(id)` (returns `Result`) from `logEvent(id)` (returns `void`). It can only match on **naming or import provenance** — e.g. flag a bare-expression call to an identifier imported from `@zireal/result-kit`, or to a locally-declared function whose annotated return type textually mentions `Result`. That catches direct calls to `ok`/`err`/`andThen`/`combine` and little else; every user-defined `Result`-returning function is invisible unless it carries an explicit, textually-matchable annotation.

---

## 1. ESLint — the full-fidelity tier

### 1.1 The identification problem, resolved

The rule's first job: *does this expression's type mean "an unconsumed `Result`"?* Three strategies, probed:

| Strategy | Result |
|---|---|
| **Nominal** (`TypeOrValueSpecifier`, `{ from: 'package', package: '@zireal/result-kit', name: 'Result' }`) | **Insufficient.** Works for a direct `Result<T,E>` annotation and — pleasingly — survives generic wrappers. **Fails** on a consumer's local type alias (probe case I: `aliasSymbol` is `MyResult`, from the consumer's own file) and on hand-rolled structural results (case H: no alias at all). |
| **Structural** (property-set match per union constituent) | **Correct primary check.** Catches every case the nominal check catches, plus I and H. |
| **Property-name heuristic** (prior art: neverthrow's plugin tests for `map`/`mapErr`/`andThen`/`orElse`/`match`/`unwrapOr` *properties*) | **Not applicable.** That works only because neverthrow's `Result` is a class instance with methods. §2 forbids methods on our union — it has exactly two fields per half. The method-probe approach has no purchase here at all. |

**Structural is not a fallback; it is the definition.** Spec §2 fixes the union as `{ ok: true, value: T } | { ok: false, error: E }` — brandless, exactly two fields per half. So the predicate is:

> For each union constituent (after dropping `null`/`undefined`): its property set is **exactly** `{ok, value}` or **exactly** `{ok, error}`, with `ok` a boolean literal type. At least one constituent must qualify.

The `exactly` is load-bearing and cheap: probe case O — a foreign union carrying an extra `meta` field — is correctly rejected, because §2's two-fields rule makes it not a `Result`. The remaining "false positive" — some unrelated library's `{ ok: true, value }` — is, per §2, **a `Result`**, and dropping it on the floor is the same bug the rule exists to catch. Flagging it is right.

Note the per-constituent framing is required by probe cases K and L: a narrowed `Ok<T>` alone is a one-member "union" and must still be must-use, and `Result<T,E> | undefined` is a three-member union that must not be missed. An arity-2 predicate — the obvious first implementation — fails both.

### 1.2 The §10.9 false-positive class — measured, and it is not there

The fear, from #60's blockers: *"typed-rule feasibility over generic wrappers around `Result` (the §10.9 false-positive class)."*

§10.9's problem was that **a conditional type in parameter position does not reduce for an unresolved type parameter**, which broke every generic wrapper over `Result`. That is a property of type-level computation *inside a generic declaration*. A lint rule does not live there. It walks statements and asks the checker for the type of an expression — at which point the generic has been **instantiated by the call**. The probe confirms it directly:

- **B** `withLog(() => findUser('1'))` where `withLog<R>(f: () => R): R` → `Result<{id: string}, NotFound>`, `aliasSymbol: Result`, from `src/core/result.ts`.
- **C** `retry(() => findUser('1'))` where `retry<T,E>(f: () => Result<T,E>): Result<T,E>` → identical.

Both are the exact shape §10.9 lost, and both are fully resolved at the call site. **The gate on #60 opens.**

### 1.3 The residual classes — three, and only one is a false positive

| # | Case | Probe | Behaviour | Severity |
|---|---|---|---|---|
| 1 | **`any` from an untyped boundary** | E | Naive checks can fire on `any`. This is precisely §10.9 finding #6 — `Extract<any, …>` takes both conditional branches — re-entering through the linter door. | **False positive. Must carve out.** Check `TypeFlags.Any` first and never report. |
| 2 | **Bare type parameter inside a generic body** | D | `f()` where `R extends Result<unknown, unknown>` types as the type parameter `R`, not a union — the structural check sees no properties and stays silent. | False *negative*. Fixable: resolve `getBaseConstraintOfType` before matching (probe shows it yields `Result<unknown, unknown>`). Safe to ship without. |
| 3 | **Uninstantiated / erased generics** | M, N | `opaque<R>()` with no inference site resolves to `unknown`, as does an `unknown`-returning call. | False negative, unfixable, harmless. |

The shape of this list is the finding: **the type system's ambiguity degrades a lint rule toward silence, not toward noise** — the opposite of what it did to §10.9's signatures, where the same ambiguity produced a wrong value with a confident type. One carve-out (`any`) is the whole false-positive surface, and it is already a known-and-solved pattern in this codebase.

### 1.4 What counts as "consumed"

Not researched externally — this is our API, and it is a design question #60 must settle — but the probe and the prior art bound it. Against the shipped surface, the consuming set is: the §5.3 terminals (`match`, `unwrapOr`, `unwrapOrElse`, `unwrapOrThrow`, `toNullable`), the §5.1 guards used as narrowing conditions (`isOk` / `isErr`), `yield*` inside `safeTry` (§5.7), the `/fluent` terminals of the same names plus `toResult` / `toJSON`, and `return`ing the value. The §5.2 transforms (`map`, `andThen`, …) **do not consume** — they produce another `Result`, and probe case F confirms the alias survives them, so a dropped `map(...)` must still be flagged.

Two seams worth writing down now:

- **`Promise<Result<…>>` overlaps `no-floating-promises`** (probe G: the type is `Promise`, alias erased). `ResultAsync` is a `PromiseLike` too. Both are already reported by the core typed rule, so `must-use-result` should unwrap the awaited type and **defer** rather than double-report — a decision, not a discovery.
- **Both prior-art plugins get flow analysis wrong.** neverthrow's rule accepts an `isOk()` call as handling and treats any arrow-function body as returned, without checking the returned expression. Copying its ancestor-walking shape would import those holes. Worth an explicit test corpus in #60.

### 1.5 The TypeScript 7 question — a packaging footnote, not a blocker

> **Corrected.** The first draft of this section claimed TypeScript 7 "has no JS compiler API" and treated that as a material finding. **That was wrong**, and the error was one of scope: it read `exports["."] → lib/version.cjs` and stopped, without checking the rest of the `exports` map. Corrected below, with the probe re-run on TS 7 to settle it by measurement rather than by inference. Recorded rather than quietly deleted, because the mistake is the same shape as the one §10.6 keeps re-teaching — *a confident claim nobody had gone and measured.*

Two distinct things get called "the API", and only one of them changed:

- **The language and type-checking semantics.** TS 7 is a port, not a rewrite — deliberately identical behaviour. **Nothing in this rule's logic is affected.**
- **The programmatic API.** TS 7.0's is **new and different**, not the 6.x API ported. The 7.0 announcement is explicit: *"While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API."*

But 7.0.2 is not API-less. `exports["."]` resolves to `lib/version.cjs` only — the old `import ts from 'typescript'` entry is gone — while **`typescript/unstable/sync` and `typescript/unstable/async` expose a full checker**: a JS client communicating over IPC with the Go server, carrying `Checker.getTypeAtLocation`, `getBaseConstraintOfType`, `getPropertiesOfType`, `getConstraintOfTypeParameter`, and `Type.aliasSymbol` — every primitive this rule needs.

**Measured: all fifteen probe cases reproduce identically on TS 7.0.2's own checker** (Appendix A, right-hand column). The alias symbol survives generic wrappers, the type parameter in case D resolves to the same `Result<unknown, unknown>` constraint, and `any` / `unknown` behave as on 5.9.3. **The rule's semantics do not depend on which checker runs it.**

What remains is packaging, and it has a supported answer:

- **In this repo** — no change; it stays on TS 7.0.2. The lint-plugin package takes its own TypeScript 6.x devDependency (or `@typescript/typescript6`) for rule development and tests, since typescript-eslint's rule-tester consumes the 6.x-shaped API. A dev-tree fact in a separate package: it touches neither the core's zero-dependency stance nor its emit target.
- **For consumers** — typed linting needs typescript-eslint to obtain types, and it has not adopted 7.0's new API; TS 7 support is tracked in [issue #10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940), blocked on the 7.1 API plus ESLint's lack of async parsers. Microsoft ships the bridge for exactly this: TS 7.0 *"can be run side-by-side with TypeScript 6.0 for utilities that still need some programmatic access to the compiler (such as typescript-eslint)"*, via **`@typescript/typescript6`**, which re-exports the 6.0 API alongside 7.0's CLI.

So this is the ecosystem's documented transition, not a constraint this package imposes or has to solve. The plugin README should state the supported configurations plainly; that is the whole obligation.

---

## 2. Oxlint — the tier is lower than assumed

Session-1 planned *"an Oxlint port (JS plugin API, with the type-aware tier via Oxlint's tsgolint-backed type-aware mode as it matures)."* The second half is not available and is not merely immature — it is a different architecture.

- **JS plugins** are ESLint-v9-compatible and cover the API broadly: visitors, `node.parent`, `context.sourceCode`, scope analysis, code paths, fixes, selectors, inline directives, LSP diagnostics. They are **alpha and under active development**.
- **Type-aware custom rules are explicitly listed as "Not supported yet."**
- **Type-aware linting is a separate component**: `tsgolint` (Go, typescript-go) executes a **fixed port of 59 of 61 typescript-eslint rules**, and returns diagnostics to Oxlint. It is a rule *runner for those rules*, not a plugin host. Nothing in either doc offers a path for a third-party type-aware rule.

**Consequence:** an Oxlint port gets the syntax tier only, for as long as this holds. The JS plugin's ESLint compatibility is real leverage though — the syntax-tier rule can plausibly be **one source file shared between the ESLint and Oxlint packages**, which changes the porting cost from "rewrite" to "re-export". That is worth confirming in #60 rather than assuming; it is the strongest argument in this file for the monorepo option in #60's open questions.

## 3. Biome — syntax tier, no committed path off it

- GritQL plugins query Biome's **CST**, `register_diagnostic()` custom diagnostics, and (v2.5) declare code fixes with `=>`, plus `includes` globs for path-scoping. Individual rule-level disabling is not supported; plugins are disabled generically.
- Biome shipped the first type-aware lint rules not backed by `tsc`, via its own Vercel-sponsored inference engine — but these are **built-in rules**. Nothing exposes inference to plugins.
- The **2026 roadmap** lists GritQL only as a 2025 accomplishment and sets no 2026 plugin or plugin-type-information targets; its stated focus is HTML/CSS/SCSS, cross-language rules, and LSP.

**Consequence:** the Biome port is syntax-tier with no visible upgrade path. Given how little the syntax tier can express (§ *Per-linter capability table*), the honest question for #60 is whether a Biome port is worth shipping at all in round one, or whether "keep the enforcement vocabulary across a linter migration" is worth less than the confusion of a rule that silently catches ~nothing on a real codebase.

---

## Recommendations for #60

1. **Ship ESLint first, and alone, in round one.** It is the only full-fidelity host and the only one whose plugin API is stable.
2. **Identify `Result` structurally**, per §2's property sets, with exact-property-set matching and per-constituent evaluation. Use the alias symbol only as a fast path, never as the gate.
3. **Carve out `any` before anything else** — it is the entire false-positive surface, and it is §10.9 finding #6 wearing a different hat.
4. **Defer `Promise<Result>` and `ResultAsync` to `no-floating-promises`**; unwrap awaited types and stay quiet.
5. **Write the test corpus from probe cases A–O**, plus the two flow-analysis holes in the prior art. The false-positive claim in this file is measured, and it should stay measured.
6. **Re-scope Oxlint and Biome** from "lower-fidelity port of the same rule" to "syntax-tier rule": investigate sharing one source file with the Oxlint JS plugin, and decide whether Biome earns a round-one port at all.
7. **State the supported TypeScript configurations** in the plugin README — including that a TS 7 consumer reaches typed linting through Microsoft's side-by-side `@typescript/typescript6` until typescript-eslint adopts the 7.1 API. Session-1's capability-honesty rule, applied to a second axis (TS version) it did not anticipate. This is documentation, not engineering.

## What this does not answer

- Separate repo vs. monorepo for the plugin packages — [#71](https://github.com/alifaroo-q/result-kit/issues/71)'s territory, though finding 6 above supplies new evidence for it (a shared ESLint/Oxlint rule source is a monorepo argument).
- The precise "consumed" set as a shipped contract — §1.4 bounds it; #60 decides it.
- `no-throw-in-result-fn` and `no-unhandled-err-branch` feasibility. Not probed. Both look strictly easier than `must-use-result`: the first needs only the declared return type of the enclosing function, the second is narrowing-flow analysis over a type the structural check already identifies.

---

## Appendix A — the probe

**Method.** A fixture importing this repo's real `src/index` was compiled under `strict`, and every bare call-expression statement was queried with `checker.getTypeAtLocation`, recording the printed type, `aliasSymbol` (and its declaring file), `TypeFlags` for `Any`/`Unknown`/`TypeParameter`, the base constraint where applicable, and a structural `Result` predicate.

**Environment — run twice, on both checkers.** Node 24.17.0.

1. **TypeScript 5.9.3** (scratch install), via the classic `ts.createProgram` / `ts.TypeChecker` API. This is the checker typescript-eslint actually uses today, so it is the configuration under test.
2. **TypeScript 7.0.2** — the version this repo pins — via `typescript/unstable/sync`: `new API({cwd}).updateSnapshot({openProjects: [tsconfig]})` → `project.checker`. Traversal used the API node's own `forEachChild`.

**All fifteen cases produced the same verdict on both.** Every column below therefore holds on TS 7's checker as well; the second run was added specifically to discharge the fidelity caveat the first draft of this appendix carried. One presentational difference, not a semantic one: TS 7's `getPropertiesOfType` on a union returns the *common* properties (so `"ok"` for a `Result`), so the structural predicate must iterate constituents explicitly rather than reading properties off the union — which §1.1 already requires for cases K and L.

| # | Case | Type at call site | `aliasSymbol` | Structural match |
|---|---|---|---|---|
| A | direct `findUser('1')` | `Result<{id: string}, NotFound>` | `Result` ← `src/core/result.ts` | ✅ |
| B | via `withLog<R>(f: () => R): R` | `Result<{id: string}, NotFound>` | `Result` ← `src/core/result.ts` | ✅ |
| C | via `retry<T,E>(f: () => Result<T,E>)` | `Result<{id: string}, NotFound>` | `Result` ← `src/core/result.ts` | ✅ |
| D | `f()` inside `<R extends Result<unknown,unknown>>` | `R` (TypeParameter; constraint `Result<unknown, unknown>`) | — | ❌ (needs constraint resolution) |
| E | `any` call | `any` | — | ❌ — **must not report** |
| F | `map(findUser('1'), fn)` | `Result<string, NotFound>` | `Result` ← `src/core/result.ts` | ✅ |
| G | `map(Promise.resolve(…), fn)` | `Promise<Result<string, NotFound>>` | — (symbol `Promise`) | ❌ — defer to `no-floating-promises` |
| H | hand-rolled `{ok,value} \| {ok,error}` | the literal union | — | ✅ — and per §2 it **is** a `Result` |
| I | local alias `type MyResult = Result<…>` | `MyResult` | **`MyResult` ← consumer's file** | ✅ — nominal match would miss it |
| J | consumed via `if (r.ok)` | `void` (statement is the `console.log`) | — | ❌ |
| K | `{ok: true, value: number}` alone | one-member | — | ❌ under an arity-2 predicate — **must be per-constituent** |
| L | `Result<number, NotFound> \| undefined` | three-member union | — | ❌ under an arity-2 predicate — **must drop nullish first** |
| M | `opaque<R>()`, R uninstantiated | `unknown` | — | ❌ (harmless false negative) |
| N | `unknown`-returning call | `unknown` | — | ❌ |
| O | foreign union with an extra `meta` field | the literal union | — | ❌ — correct, §2 mandates exactly two fields |

## Sources

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) — no API in 7.0, a new and different one in 7.1, and the `@typescript/typescript6` side-by-side story
- [Oxlint — JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins) · [Oxlint — Type-Aware Linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html) · [Oxlint JS Plugins Alpha announcement](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha.html) · [oxc-project/tsgolint](https://github.com/oxc-project/tsgolint)
- [Biome v2.5 release notes](https://biomejs.dev/blog/biome-v2-5/) · [Biome Roadmap 2026](https://biomejs.dev/blog/roadmap-2026/)
- [typescript-eslint — `no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) · [`TypeOrValueSpecifier`](https://typescript-eslint.io/packages/type-utils/type-or-value-specifier/) · [Issue #10940 — use TS 7 / tsgo for type information](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
- Prior art: [mdbetancourt/eslint-plugin-neverthrow — `must-use-result.ts`](https://github.com/mdbetancourt/eslint-plugin-neverthrow/blob/master/src/rules/must-use-result.ts) · [tmountain/eslint-plugin-neverthrow-must-use](https://github.com/tmountain/eslint-plugin-neverthrow-must-use) · [ninoseki/eslint-plugin-neverthrow](https://github.com/ninoseki/eslint-plugin-neverthrow)
- This repo: `docs/spec/v5-core-spec.md` §2, §2.1, §5.1–5.3, §5.7, §10.9; `docs/result-kit/session-1.md` Massive #1.
