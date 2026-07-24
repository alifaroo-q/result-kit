# Spike: one shared source file for the ESLint and Oxlint `must-use-result` rule

> Answers question 2 of the port-scope decision ([#74](https://github.com/alifaroo-q/result-kit/issues/74)), on the map *post-5.0 ecosystem* ([#69](https://github.com/alifaroo-q/result-kit/issues/69)).
> Sharpens finding 6 of the feasibility research ([`docs/research/must-use-result-linter-feasibility.md`](must-use-result-linter-feasibility.md) §2), which flagged the shared-file idea as *"worth confirming in #60 rather than assuming"* — this confirms it.
> Feeds the monorepo-vs-separate-repo call in [#71](https://github.com/alifaroo-q/result-kit/issues/71).
> Sources: Oxlint / oxc primary docs, ESLint v9 custom-rule docs, typescript-eslint. No code was written; this is a documentation spike against vendor docs (Oxlint JS plugins are **alpha** as of early 2026).

---

## Question

The feasibility research re-scoped the Oxlint port from *"same rule, lower tier"* to *"syntax-tier rule, different name-space"*, and observed that because Oxlint's JS plugins are ESLint-v9-compatible, the syntax-tier rule *might* be **one source file shared** between the ESLint and Oxlint packages — turning the porting cost from "rewrite" to "re-export". It explicitly declined to assume this. This spike settles it: **is one authored rule module genuinely re-exportable by both hosts, or does something force a port / adapter shim?**

Scope is the **syntax tier only** — no TypeScript type services. The rule matches on AST syntax alone: a bare-expression call statement whose callee is an identifier imported from `@zireal/result-kit`, or whose declared return type textually mentions `Result`.

---

## TL;DR

**Achievable — one shared rule source, two thin plugin wrappers.** Oxlint's alpha JS-plugin API is a deliberate ESLint-v9 clone, not a look-alike: the entire `{ meta, create }` module is shared verbatim, and each package's only unique line is its plugin manifest (`export default { meta: { name }, rules: { 'must-use-result': rule } }`), which is the same shape on both hosts. No per-host `create()`, no AST shim.

Two caveats keep it from risk-free, and both belong in #60's plan:

1. **The TS-return-type matcher is the soft spot.** Oxlint parses with **oxc's own parser, not `@typescript-eslint/parser`**, so TS annotation nodes (`TSTypeReference` in a declared return type) may diverge in shape from typescript-estree. The import-provenance matcher — plain ESTree — is safe; this one needs an **empirical spike test** before the shared file is banked on. It is also the more valuable of the two matchers, so it is not a corner to wave off.
2. **Alpha maturity.** Un-enumerated APIs (`messageId` + `meta.messages`, specific scope-manager methods) work *by contract* — the docs' stated guarantee is "all APIs behave identically to ESLint; differences are bugs" — not by individual documentation. Verify empirically.

**Verdict for #74-Q2: yes, ship the Oxlint syntax tier from a shared source, gated on the one TS-annotation spike test.** This is confirmed evidence for the monorepo option in #71, not a hope.

---

## Point by point

### 1. Rule object shape — identical

An Oxlint JS-plugin rule is literally the ESLint v9 shape:

```js
{ meta, create(context) { return { [selector](node) { /* … */ } } } }
```

and a plugin is `{ meta: { name }, rules: { … } }` with `export default plugin`. The docs state the API is "identical to ESLint's" and link ESLint's own plugin / custom-rule pages. No `defineRule` wrapper is required. There is an optional `createOnce` performance variant, but the ESLint-style `create` is fully supported, and `@oxlint/plugins` ships `eslintCompatPlugin()` for the reverse direction. Registration differs **only at the config layer** — `jsPlugins: ["./plugin.js"]` in `.oxlintrc` vs. flat-config's `plugins` object — which lives in each *consumer's* config, not in the shared rule/plugin module, so it forces no port.

### 2. AST — ESTree-compatible, same names and properties

Same node `type` names (`ExpressionStatement`, `CallExpression`, `ImportDeclaration`, `ImportSpecifier`) and the same properties (`callee`, `arguments`, `expression`). Nodes carry numeric `start`/`end` spans for zero-copy Rust↔JS transfer, but Oxlint honours ESLint's node contract that `range` (a two-number array) and a non-null `loc` are present — so `context.report({ node })` and `sourceCode.getText(node)` behave the same.

**Caveat (see TL;DR #1):** this is oxc's own ESTree structure produced by a shared-buffer / lazy-deserialize adapter, **not** `@typescript-eslint/parser` output. TypeScript annotation nodes — exactly the surface the "return type mentions `Result`" check touches — may diverge in shape from typescript-estree.

### 3. `context` API — covered for a syntax-tier rule

Supported: `context.report`, `context.sourceCode` (incl. `getText`, `getTokens`, `getAncestors`), `context.options`, `context.filename`, `node.parent`, and **scope analysis** — so resolving an identifier back to its import binding (provenance from `@zireal/result-kit`) is available. `context.id` and `messageId` are not individually enumerated in the API-support list; they work under the "behaves identically to ESLint; differences are bugs" contract and should be verified empirically.

### 4. Selectors and visitor keys — supported

The docs link ESLint's selectors page directly, implying the same selector strings and `:exit`. `ImportDeclaration` / `ImportSpecifier` are standard ESTree nodes, so import-provenance visiting works identically.

### 5. Fixer — supported

Fixes and suggestions are listed as supported; the fixer emits fix reports the ESLint way. The rule's likely autofix — inserting `void ` before a dropped call via `fixer.insertTextBefore` — is standard ESLint fix surface. Individual method signatures are not re-documented; they inherit ESLint's.

### 6. Build / module — ESM, TypeScript OK

Plugins load via dynamic `import(url)` (ESM); rules may be authored in JS or TS. A TS→JS compiled shared module is fine. Oxlint config accepts a plain `jsPlugins` path list or a TS `defineConfig`.

---

## Divergences that could bite a naive shared file

- **TS type-annotation AST is not typescript-estree.** Reading a function's declared return-type node textually may need host-guarded access if oxc's TS node shape differs. This is the single most likely break for the syntax-tier rule and warrants a spike test in #60. — <https://typescript-eslint.io/packages/typescript-estree/>
- **Alpha maturity / "differences are bugs."** Any un-enumerated API (`messageId`, specific scope-manager methods) works by contract, not by documented guarantee — verify `messageId` + `meta.messages` and scope-based import resolution empirically. — <https://oxc.rs/docs/guide/usage/linter/js-plugins.html>
- **Config-layer registration differs** (ESLint flat-config `plugins` object vs. Oxlint `jsPlugins` path array) — but this lives in each consumer's config, not in the shared rule/plugin module, so it does not force a port.

**How thin the adapter needs to be:** effectively zero for the rule itself — share the entire `{ meta, create }` module verbatim. Each package's only unique line is its manifest, the same shape for both hosts. No per-host `create()`, no AST shim — provided the TS-return-type read passes the spike test.

---

## What this changes downstream

- **#74-Q1 (Oxlint):** near-zero marginal cost once ESLint's rule exists strengthens *"ship the Oxlint syntax tier in round one"* — the false-confidence objection is weaker when the vocabulary comes almost free. (Biome is untouched: GritQL / CST, no shared-file path — its round-one question stands on its own.)
- **#71 (monorepo):** a genuinely shared source module is now confirmed, not hoped — concrete evidence for the monorepo layout.
- **#60 (implementation):** carries one new task — an empirical spike test that the TS-return-type matcher reads oxc's annotation AST the same way it reads typescript-estree's, before the shared file is relied on for that matcher.

## What this does not answer

- The empirical TS-annotation-AST parity test itself — deferred to #60 as above; this spike establishes it is the *only* open technical risk, not that it passes.
- Separate repo vs. monorepo — [#71](https://github.com/alifaroo-q/result-kit/issues/71)'s call; this supplies evidence, not the decision.
- Whether Biome earns a round-one port — [#74](https://github.com/alifaroo-q/result-kit/issues/74)-Q1's Biome half, unaffected by anything here.

## Sources

- [Oxlint — Writing JS Plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html) — rule/plugin shape, ESM `import` loading, JS-or-TS authoring, `jsPlugins` config
- [Oxlint — JS Plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) — "identical to ESLint's API", supported `context` surface, selectors link, fixer support, "differences are bugs" contract
- [Oxlint JS Plugins Alpha announcement](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha.html) — alpha status, `@oxlint/plugins` / `eslintCompatPlugin()`, `createOnce` variant
- [oxc external plugin system (DeepWiki)](https://deepwiki.com/oxc-project/oxc/5.5-external-plugin-system) — shared-buffer / lazy-deserialize AST adapter, span representation
- [ESLint — Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) · [ESLint — Selectors](https://eslint.org/docs/latest/extend/selectors) — the contract Oxlint clones
- [typescript-eslint — typescript-estree](https://typescript-eslint.io/packages/typescript-estree/) — the TS-AST shape Oxlint's parser does **not** reproduce
- This repo: [`docs/research/must-use-result-linter-feasibility.md`](must-use-result-linter-feasibility.md) §2 (the finding this sharpens)
