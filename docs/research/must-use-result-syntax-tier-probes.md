# Probes: syntax-tier recall + oxc-parser AST parity for `must-use-result`

> Discharges the two **decision-blocking measurements** [ADR 0013](../adr/0013-lint-port-scope-oxlint-biome.md) and [ADR 0014](../adr/0014-peer-dependency-policy-and-lint-package-layout.md) carried into [Lint enforcement #60](https://github.com/alifaroo-q/result-kit/issues/60):
> 1. the **syntax-tier recall probe** that gates whether the Oxlint port ships or defers (ADR 0013 §Consequences), and
> 2. the **oxc-parser TS-annotation parity spike** that gates whether matcher (b) can live in the shared `rule-core` file or must branch per host (ADR 0013:46, ADR 0014 §Consequences).
>
> Extends the [feasibility research](must-use-result-linter-feasibility.md) (#70, finding 6 / Appendix A) and the [shared-source spike](oxlint-eslint-shared-rule-spike.md) (#74 Q2, TL;DR #1). Both probes were **run, not predicted** — TypeScript 5.9.3 compiler API (the checker typescript-eslint uses), `oxc-parser@0.141.0`, `@typescript-eslint/parser@8.65.0`, Node 24.17.0.

---

## TL;DR

Both gates open.

1. **Recall probe → Oxlint ships.** On a representative consumer corpus the two single-file syntax matchers together catch **9 of 11 (81.8%) dropped `Result` sites**. The only two misses are the irreducible type-only cases — a local function with an **inferred** `Result` return, and a return type that **aliases** `Result` behind another name — both of which *no* syntax-tier rule can reach and both of which the plugin README names as known blind spots (session-1 capability-honesty). This is comfortably above ADR 0013's "worse than no rule" floor.

2. **Parity spike → matcher (b) is fully shareable.** Across six function-shape cases, `oxc-parser` and `typescript-estree` produce an **identical** return-type annotation AST (`TSTypeAnnotation → TSTypeReference` / `TSUnionType`), and matcher (b) reads the same verdict from both by text **and** by structure. The `{ meta, create }` module is shared verbatim; no per-host branch, closing the one open technical risk the #74 spike flagged.

Net: **round one is ESLint (full tier) + Oxlint (syntax tier, shipping) from one shared `rule-core`**, exactly the layout ADR 0014 provisioned.

---

## Probe 1 — syntax-tier recall

### Method

The syntax-tier analogue of the feasibility doc's [Appendix A probe](must-use-result-linter-feasibility.md#appendix-a--the-probe), pointed at the *weaker* tier.

- **Ground truth (denominator).** Every `CallExpression` whose produced type is **structurally a `Result` per §2** — the exact predicate from feasibility §1.1 (drop `null`/`undefined`, resolve a bare type-parameter to its base constraint, then require at least one union constituent with property set *exactly* `{ok, value}` or `{ok, error}` and `ok` boolean-like), evaluated with the TS 5.9.3 checker. This is the full-fidelity ESLint tier's reach.
- **Syntax matchers (numerator).** A syntax-tier rule sees **one file's AST with no type info**, so both matchers are strictly single-file:
  - **(a) import-provenance** — callee is an identifier bound to an *in-file* import whose module specifier is the package.
  - **(b) return-type-mention** — callee is an identifier bound to an *in-file* function-like whose return-type annotation node textually contains `Result`.
- **Recall** = matched ground-truth sites ÷ all ground-truth sites, reported for **all** call sites (identification ceiling) and for the **dropped** subset (`ExpressionStatement` parent — the sites the rule actually fires on).

Two corpora, because they answer different halves:

### Corpus 1 — this repo's `src/` (ADR-specified)

| | sites | matcher (a) | matcher (b) | union |
|---|---|---|---|---|
| all Result-returning | **38** | 57.9%¹ | 2.6% | **60.5%** |
| **dropped** | **0** | — | — | — |

¹ Only via the relative-import proxy (see below). Bare-`@zireal/result-kit` recall on `src/` is **0%**.

Two findings, both about the corpus rather than the matcher:

- **A clean library drops zero of its own `Result`s** — all 38 sites are consumed (returned, matched, narrowed). So `src/` **cannot measure dropped-site recall**, the ADR's primary gate; it measures only the *identification ceiling*. This is why Corpus 2 exists.
- **A library imports itself relatively**, so the literal `@zireal/result-kit` specifier never appears and matcher (a) registers 0% unless relative imports resolving into `src/` are treated as the package stand-in (57.9%). That proxy is the faithful simulation — those are the same call sites a consumer writes as `import { ok } from "@zireal/result-kit"` — but it must be stated, not hidden.

The 60.5% ceiling is real signal on real code: the ~40% miss is callback **parameters** (`step`, `fn` — higher-order, invisible without types), internal helpers with **inferred** returns, and **method** calls (`this.toResult()`) — every one a type-only case.

### Corpus 2 — consumer fixture (real dropped sites)

Eleven dropped `Result` sites mirroring the feasibility cases in value-dropped position: direct package calls (`ok`/`err`/`map`/`andThen`/`combine`), renamed imports, local functions with annotated / inferred / alias-masked returns, and generic wrappers.

| | sites | matcher (a) | matcher (b) | union |
|---|---|---|---|---|
| all Result-returning | 26 | 50.0% | 34.6% | 84.6% |
| **dropped** | **11** | 54.5% | 27.3% | **81.8% (9/11)** |

Per-site, the matchers fire exactly where intent says they should:

| dropped site | caught by | note |
|---|---|---|
| `ok(1)`, `err(…)` | (a) | direct package import |
| `map(…)`, `andThen(…)`, `combine(…)` | (a) | package transforms/collections |
| `success(42)` (renamed `ok`) | (a) | import binding survives rename |
| `findUser(…)`, `loadUser(…)` (annotated) | (b) | return type mentions `Result` |
| `retry(() => …)` (generic, annotated) | (b) | annotation mentions `Result` |
| `findUserInferred(…)` | **miss** | inferred return — type-only |
| `retryAliased(…)` (`: Wrapped<T,E>`) | **miss** | alias hides `Result` — type-only |

**Matcher (b) earns its place on consumer code** — 27–35%, versus ~3% on `src/`. The asymmetry is the point: `src/` mostly calls package primitives (matcher a's turf), whereas consumers define their own annotated `Result`-returning functions (matcher b's turf). Both matchers are load-bearing, and (b)'s weight is precisely why Probe 2's parity result matters.

### Verdict

**Oxlint ships the syntax tier.** 81.8% dropped-site recall with two well-defined, documentable blind spots clears ADR 0013's floor by a wide margin. The plugin README states its tier plainly and names what it cannot see: *calls whose `Result` return is inferred (no annotation) or aliased behind another type name.*

### Caveats, stated

- The dropped-site number comes from a **hand-built fixture**, necessarily — `src/` has no dropped sites. It is *representative* (spans direct calls, renames, annotated/inferred/aliased locals, generic wrappers) but not a random real-world sample; the true field number depends on how often consumers annotate their `Result`-returning functions. The two blind spots bound the downside precisely.
- Recall here is **identification** recall; it says nothing about the "consumed" set (what counts as handling), which #60 still settles as a shipped contract per feasibility §1.4.

---

## Probe 2 — oxc-parser ↔ typescript-estree parity for matcher (b)

### Method

Matcher (b) reads a function-like's declared **return-type annotation** and asks "does it mention `Result`?" The two plugin hosts parse differently — the ESLint plugin via `@typescript-eslint/parser` (typescript-estree), the Oxlint plugin via **oxc's own parser** — and TS annotation nodes are exactly the surface the #74 spike flagged as the one place they might diverge. The spike parses the same six cases with both parsers and compares, for each, the annotation node type, its inner `.typeAnnotation` type, and matcher (b)'s verdict computed **by text** and **by structural walk** (a `TSTypeReference` whose `typeName` is `Result`).

### Result — full parity, all six cases

| case | annotation node | inner type | (b) both parsers |
|---|---|---|---|
| `function f(): Result<number, E>` | `TSTypeAnnotation` | `TSTypeReference` | ✅ true |
| `const g = (): Result<number, E> =>` | `TSTypeAnnotation` | `TSTypeReference` | ✅ true |
| `function h(): Result<…> \| undefined` | `TSTypeAnnotation` | `TSUnionType` | ✅ true |
| `function k(): MyResult<number, E>` | `TSTypeAnnotation` | `TSTypeReference` | ✅ **false** (alias — correct) |
| `function m() { … }` (no annotation) | — | — | ✅ null |
| `class C { q(): Result<number, E> }` | `TSTypeAnnotation` | `TSTypeReference` | ✅ true |

Same node-type names, same nesting (`returnType.typeAnnotation`, `typeName.name`), same verdicts — including the aliased case correctly reading `false` and the method case reaching the annotation via `MethodDefinition.value.returnType` on both.

### One portability note (not a mismatch)

At the **raw-parser** layer, oxc emits numeric `start`/`end` spans while typescript-estree emits a `range` tuple. The shared code reads spans defensively (`node.range ?? [node.start, node.end]`), but this only bites a rule that touches raw parser output. Inside the **plugin runtime** both hosts honor ESLint's node contract (`.range` present, `sourceCode.getText(node)` works — [shared-source spike §2](oxlint-eslint-shared-rule-spike.md)), so the shipped rule uses `sourceCode.getText(annotation)` and the note is moot in practice. Verified empirically per the spike's "alpha, differences are bugs" caveat.

### Verdict

**Matcher (b) lives in the shared `rule-core` module verbatim** — no per-host `create()`, no AST shim, no annotation-shape branch. This closes the single open technical risk from the #74 spike and confirms ADR 0014's fully-shared `rule-core` (its §Consequences "worst case, that one matcher branches per host" does **not** obtain).

---

## What this unblocks in #60

1. **Oxlint is in round one** (not deferred) — recall clears the floor. Biome remains deferred per ADR 0013.
2. **`rule-core` is one shared `{ meta, create }` module** for both ESLint and Oxlint, matchers (a) *and* (b) shared — the monorepo layout (ADR 0014 §3) is confirmed, not hoped.
3. **The README capability line is fixed by measurement**: the syntax tier catches ~82% of dropped `Result`s and misses exactly two type-only shapes (inferred return, aliased return), which the Oxlint README must name.

## What this does not answer

- The "consumed" set as a shipped contract — feasibility §1.4 bounds it; still #60's call.
- `no-throw-in-result-fn` / `no-unhandled-err-branch` — unprobed (feasibility §What-this-does-not-answer notes both look strictly easier).
- Field recall on a large third-party corpus — out of scope; the fixture + `src/` bound it from both sides.

## Reproducibility

Both probes are standalone scripts run outside the frozen core tree:

- **Recall** — TS 5.9.3 `createProgram` over `src/` + a consumer fixture; the §2 structural predicate for ground truth; single-file AST matchers (a) and (b); recall reported for all and dropped subsets, per corpus.
- **Parity** — `parseSync` (oxc-parser) vs. `parse` (typescript-estree) over six function shapes; compare annotation node type, inner type, and matcher-(b) text + structural verdicts.

## Sources

- This repo: [`must-use-result-linter-feasibility.md`](must-use-result-linter-feasibility.md) §1.1, §1.4, finding 6, Appendix A; [`oxlint-eslint-shared-rule-spike.md`](oxlint-eslint-shared-rule-spike.md) §2, TL;DR #1; [ADR 0013](../adr/0013-lint-port-scope-oxlint-biome.md); [ADR 0014](../adr/0014-peer-dependency-policy-and-lint-package-layout.md); `docs/spec/v5-core-spec.md` §2.
- Tooling: `oxc-parser@0.141.0`, `@typescript-eslint/parser@8.65.0`, `typescript@5.9.3`, Node 24.17.0.
