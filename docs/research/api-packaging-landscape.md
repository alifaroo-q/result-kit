# Research: how high-authority libraries structure API, packaging & ergonomics

> Landscape study for `@zireal/result-kit` **v2** — the lean, zero-dependency rework.
> Resolves the research ticket *"how high-authority libraries structure API, packaging & ergonomics (Result genre + broader)"* ([#9](https://github.com/alifarooq-zk/result-kit/issues/9)).
> Feeds the paradigm decision ([#10](https://github.com/alifarooq-zk/result-kit/issues/10)) and the TypedError decision ([#11](https://github.com/alifarooq-zk/result-kit/issues/11)).

Two levels were studied against **real source** (published tarballs, `package.json` `exports`, type defs), not READMEs: the direct `Result`/`Either` genre, and broader high-authority libraries whose API/packaging decisions transfer.

---

## TL;DR — the through-line

Across **every** cluster the same fork appears, with the same verdict:

- **es-toolkit vs lodash**, **Valibot vs Zod**, **date-fns vs Luxon** — modular standalone functions tree-shake to *bytes*; a class/prototype (or chained builder) ships its **whole method surface** to every consumer because bundlers cannot prune unused methods off an instance.
- Zod itself conceded this by shipping **`zod/mini`** (functional `.check()` API) — its docs state plainly: *"Bundlers are generally not able to treeshake unused method implementations… but they are able to remove unused top-level functions."*
- **But** ergonomics and adoption pull the other way: neverthrow (fluent) is the category leader at **~1.67M weekly downloads**; Zod outships Valibot **~15×** on ergonomics/inference/discoverability despite being far larger.

**The recommended synthesis (converged on by 4 of 6 clusters independently):** a **modular free-function core over a plain, method-less `Result` discriminated union** as the source of truth (genuinely 1 kB-class, tree-shakable, infinitely extensible), with an **optional thin fluent/`pipe` façade** for the ergonomic path. `true-myth` already ships exactly this dual model; Zod was *forced* into it with Mini. This is the central input to the paradigm decision (#10) — recorded here as evidence, **not** decided (that's #10's HITL job).

Result pipelines are typically short (2–5 ops), which **mutes** the verbosity/arity-ceiling penalty that hurts `pipe()` in long validation schemas — so the modular case is stronger here than it is even for Valibot.

---

## Level 1 — Result / Either genre

### Comparison

| Library | Weekly dl | Paradigm | Construct / discriminant | Error channel | Async | Tree-shakable? | Packaging |
|---|---|---|---|---|---|---|---|
| **neverthrow** | ~1.67M | Fluent wrapper (class methods only) | `ok(v)`/`err(e)` → class; `isOk()`/`isErr()` guards, no `_tag` | Generic `E`; **unions on `andThen`** (`E \| F`) | Separate **`ResultAsync`** (thenable/awaitable) + **doubled** `asyncMap`/`asyncAndThen` on sync | ❌ one class bundle, no `exports`, no `sideEffects` | Dual CJS/ESM via legacy fields, single entry |
| **ts-results-es** | ~108K (fork of ts-results ~169K) | Fluent wrapper; statics on `Result.*` | `Ok(v)`/`Err(e)` callable classes; `isOk()`/`isErr()` | Generic `E`; unions on `andThen` | Separate **`AsyncResult`** via `.toAsyncResult()` (clean boundary) | ❌ class-based | Dual + real `exports` map, `./rxjs-operators` subpath. ⚠ eager stack-trace in `Err` ctor |
| **true-myth** | ~629K | **Dual: fluent methods AND curried data-last free functions** | `ok(v)`/`err(e)`; `variant:'Ok'\|'Err'` tag **+** `isOk`/`isErr` | Generic `E`; unions on `andThen` | Separate rich **`Task`** (`all`/`any`/`race`/`timeout`/`withRetries`) | ✅ **free functions individually importable** | **Pure ESM**, rich `exports` (`./result`,`./task`,`./maybe`) |
| **Effect** (`Either`/`Effect`) | ~17M | `.pipe()` + data-first; generator `yield*` | `Effect.succeed/fail`, `Either.right/left` (`_tag`) | **Fully-typed channel `Effect<A,E,R>`**; auto-unions; `catchTag` narrows | **Unified** sync/async; `tryPromise({try,catch})` | Modular but **heavy** runtime baseline; ships `Micro` for libs | ESM+CJS, many subpaths |
| **fp-ts** | ~3.1M (frozen) | **Strict pipe/data-last** functions | `E.right/left` (`_tag`) | Generic **error-first `Either<E,A>`**; **NO auto-union** — needs `chainW`/`mapLeft` | Separate **`TaskEither`** | ✅ modular per-module | Dual `lib/`+`es6/`, predates `exports` map |

### Cross-pollination

- **Rust `std::Result`** — the `?` operator (early-return unwrap with `From`-based error conversion) is the ergonomic crown jewel; TS analog is a generator do-notation (`gen`/`safeTry` via `yield*`). Also `ok_or` → maps cleanly to `fromNullable(value, error)`. Proves a Result type can be fully ergonomic with **no HKT/category-theory layer**.
- **Zod error model** — `safeParse` returns a discriminated union on `success` (a domain `Result`). `ZodError.issues: ZodIssue[]` **accumulates many** structured errors; each `ZodIssue` is a **discriminated union on `code` + code-specific typed payload + `message` + `path`**. This `{ discriminant + typed payload + message }` shape is the gold standard for a structured `TypedError` — it's exactly result-kit's existing `{ type, message, details? }` convention, refined.

### Genre takeaways

1. **Fluent is what the market reaches for** (neverthrow's lead), but **only `true-myth` tree-shakes** — because it ships free functions alongside methods. Classes-only (neverthrow, ts-results) can't.
2. **Union-accumulate `E` on `andThen` by default** (`Result<U, E | F>`). This is the single most valuable inference behavior; all four Result libs do it. **Avoid fp-ts's no-auto-union trap** (the `chainW`/`mapLeft` gymnastics).
3. **Keep `E` generic; layer `TypedError` as an optional convention**, not a mandate baked into `Result<T,E>`. None of the leaders prescribe an error shape — that generality drives adoption.
4. **A fully-typed error channel (Effect) is not worth it for a lean lib** — its value needs the whole runtime + generator + `catchTag` edifice. Ordinary discriminated-union narrowing (`switch (err.type)`) gets ~90% of the safety at zero runtime cost.
5. **Async: adopt a single `ResultAsync` that `implements PromiseLike<Result>`** (awaitable, chain across async without unwrapping). **Avoid neverthrow's method-doubling** (`asyncMap`/`asyncAndThen` bolted on sync) — that is precisely today's `xAsync` anti-pattern. ts-results-es's explicit `.toAsyncResult()` boundary is cleaner.
6. **Discriminant:** keep the plain `{ ok: true } | { ok: false }` union (serializable, `switch`-narrowable, already the v1 shape) + `isOk`/`isErr` guards. Avoid ts-results-es's eager stack capture in `Err`.
7. **Naming converges:** `map`, `mapErr`, `andThen`, `orElse`, `match`, `unwrapOr`, `unwrapOrElse`, `combine`/`all`. Side-effect tee: prefer `inspect`/`inspectErr` (true-myth) over `andTee`. **Ship a `match`** (ts-results-es's omission is a gap).
8. **The `?`/do-notation** (`gen`/`safeTry`) is the highest-ROI ergonomic — optional sugar over the explicit core.

---

## Level 2 — Broader high-authority libraries

### Packaging & tree-shaking mechanics (the transferable core)

| Library | Paradigm | Tree-shaking | Key packaging fact |
|---|---|---|---|
| **lodash** (~75M) | fns + chain wrapper | ❌ CJS monolith; named import = whole lib (~24 kB) | No `exports`, no `sideEffects`; escape hatch is `lodash/x` subpaths |
| **lodash-es** | same fns | ⚠ better but heavy | ESM, `sideEffects:false`, **no `exports` map**; shared internals still drag |
| **es-toolkit** (~10M, rising) | **standalone data-first fns only** | ✅ **decisive** — `pick` **132 B** vs lodash-es 9,520 B; up to **97% smaller** | Dual ESM/CJS, full `exports` with **per-format types (`.d.mts`/`.d.ts`)**, category subpaths + `./compat` + `./fp` |
| **date-fns** (~90M) | standalone pure fns (+ `/fp` curried) | ✅ | **v3 rework**: killed `/esm` submodule hack → **flat files + named exports + `exports` map**, dual `.mjs`/`.cjs` per fn |
| **dayjs** (~58M) | chainable immutable wrapper | ⚠ small *by construction* (~2 kB core) via **opt-in plugins**, not by tree-shaking | `.extend(plugin)` mutates prototype; types via **module augmentation** — anti-pattern for a Result lib |
| **Luxon** (~31M) | monolithic immutable class | ❌ ~22 kB whole class regardless of use | one surface, no subpaths (nothing to split) |
| **Zod** (~180–220M) | **chained builder** | ❌ ~13–17 kB; prototype methods can't be pruned | added **`zod/mini`** functional API to regain tree-shaking |
| **Valibot** (~11–14M, rising) | **modular fns + `pipe()`** | ✅ **~1.37 kB** login schema vs Zod 17.7 kB (~90% less); validator ~106 B | `sideEffects:false`, granular per-fn exports **are** the tree-shaking |
| **remeda** | **data-first AND data-last** (`pipe`), lazy fusion | ✅ | closest utility analog to "standalone fns + `pipe`" |
| **radash** | data-first only | ✅ by construction | **deliberately ships no `pipe`/`chain`** — maintainers rejected it as incompatible with reliable tree-shaking (issue #45) |
| **TanStack** Query/Table | framework-agnostic **core + adapters** | ✅ core `sideEffects:false`, **zero deps, zero peerDeps** | adapters are **separate packages** depending on pinned core; framework as `peerDependency` |
| **ramda** | auto-curried data-last | ❌ historically poor (~15% reduction) | shared internal curry/combinator web defeats bundlers despite `sideEffects:false` |
| **ts-pattern** | fluent `match().with().exhaustive()` | ✅ zero deps | `.exhaustive()` = compile error on unhandled union member |

### Broader takeaways

- **Standalone data-first functions + `sideEffects:false` is the proven tree-shaking recipe** (es-toolkit, date-fns v3, Valibot, remeda). A single class/namespace/chained-builder is the proven **anti-**recipe (lodash, Luxon, Zod-classic).
- **`exports` map is the source of truth:** dual ESM/CJS with **per-condition, per-format type files** — `import` → `.d.mts`/`.mjs`, `require` → `.d.cts`/`.cjs` — to dodge the dual-package "masquerading types" hazard. Keep legacy `main`/`module`/`types` for old resolvers. Export `./package.json`. (result-kit already runs `publint` + `attw` in tsdown — keep them; they catch exactly this class of bug.)
- **Keep a flat, single, self-tree-shakable barrel (`.`)** — do **not** reintroduce a `/esm` deep-path hack (date-fns v2's footgun). Add category subpaths only if the surface grows.
- **`pipe()` is fine *if* you avoid Ramda's mistake:** each operator a standalone, independently-importable, side-effect-free function with **no shared internal curry/combinator machinery**, and **prefer data-first `pipe(value, ...fns)` over auto-currying everything** (auto-curry is what wrecked Ramda's tree-shaking and bloats types). radash's stance (no pipe at all) is the cautious extreme.
- **Architecture after deleting adapters:** ship a **zero-dep, zero-peerDep pure core** (the `@tanstack/query-core` model). Don't stand up a monorepo for a small lib. If a Nest adapter is ever wanted, publish `@zireal/result-kit-nest` as a **separate package** with `@zireal/result-kit` + `@nestjs/common` as **peerDependencies**. fp-ts interop shouldn't ship at all — document a ~10-line userland shim instead. (This corroborates the destination's removal decisions.)
- **`match`/fold:** make it **return a value**, object form `match({ ok, err })` — minimal machinery, and it gets ts-pattern-style exhaustiveness *for free* because both keys are required by the type. Reserve a fluent `.with().exhaustive()` matcher only for open-ended typed-error unions.
- **dayjs `.extend(plugin)` is not relevant** — a Result type has no large optional domains to defer, and prototype-mutation + augmentation-typing are exactly what a lean lib should avoid. Extension = another pure function.

---

## Implications for the open decisions

**Paradigm decision (#10)** — evidence points to: *modular free-function core over a plain method-less `Result` union (source of truth, tree-shakable) + optional thin fluent/`pipe` façade*. The tension is real (fluent wins ergonomics/adoption; modular wins size/extensibility), but result-kit's stated "lean, zero-dependency" identity + short Result pipelines weight it toward modular-core. `true-myth` is the reference implementation of the dual model; a **decision + ADR with rejected alternatives** is still owed by #10.

**TypedError decision (#11)** — keep `E` generic with **auto-union on `andThen`**; keep `{ type, message, details?, cause? }` as an **optional** structured convention, refined toward the Zod `ZodIssue` shape (discriminant + typed payload + message, optionally `path`); consider `fromNullable(value, error)` (Rust `ok_or`) and an opt-in **accumulating** combinator (Zod-style `issues[]`) with **pure formatter helpers** rather than a baked presentation. Do **not** adopt an Effect-style fully-typed channel.

**Downstream fog (still gated on #10):**
- *Async strategy* — a single `ResultAsync implements PromiseLike<Result>`; **retire the doubled `xAsync` surface**.
- *Packaging* — flat barrel + `sideEffects:false` + dual per-format `exports`; keep `publint`/`attw`.
- *`match` ergonomics* — value-returning object fold.
- *`?`/do-notation* — an optional `gen`/`safeTry` generator helper (newly surfaced as worth its own consideration).

---

### Sources

Result genre: neverthrow (npm, `dist/index.d.ts` @8.2.0), ts-results-es (`src/result.ts`,`asyncresult.ts` @7.1.0), true-myth (`dist/*.d.ts` @9.4.0), Effect (effect.website docs, v4 beta), fp-ts (Either/TaskEither), Rust `std::result`, Zod error model (zod.dev). Broader: es-toolkit (toss.tech, es-toolkit.dev/bundle-size, package.json), date-fns v3 (blog, PR #910), dayjs (day.js.org/docs/plugin), Luxon (bundlephobia), Zod vs Valibot (valibot.dev/guides/comparison, builder.io, zod.dev/packages/mini), remeda (remedajs.com), radash (issue #45), TanStack (query-core/react-query package.json), ramda (issue #2355), ts-pattern (github). Download counts pulled live from the npm downloads API.
