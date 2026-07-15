# ADR 0008 — v2 migration & breaking-change story (ships as `5.0.0`)

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Ali Farooq
- **Ticket:** [Decide: the v2 migration & breaking-change story](https://github.com/alifarooq-zk/result-kit/issues/19)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8)
- **Builds on:** every prior ADR — [0001 paradigm](./0001-v2-core-api-paradigm.md), [0002 TypedError](./0002-v2-typederror-model.md), [0003 Result shape](./0003-v2-result-type-shape.md), [0004 API surface](./0004-v2-api-surface-method-inventory.md), [0005 async](./0005-v2-async-strategy.md), [0006 package layout](./0006-v2-package-layout-entrypoints.md), [0007 do-notation](./0007-v2-do-notation-helper.md)
- **Evidence:** the npm registry itself (`npm view @zireal/result-kit time/versions/dist-tags`, `api.npmjs.org/downloads/*`), captured in §1 and §4

## Context

ADRs 0001–0007 locked every design decision for the rework this map calls **v2**. This ADR — the map's final ticket — decides how that rework reaches consumers: the migration guide's scope, whether a codemod ships, and the changelog / version-bump plan.

Two of those three were expected to be routine. The version-bump plan was not, because charting this ticket surfaced a fact no prior ADR knew.

### The discovery: `2.0.0` is permanently unpublishable

The npm registry's `time` field and its `versions` array disagree:

```
time:      1.0.0  1.0.1  1.0.2  1.1.0  2.0.0  3.0.0  3.0.1  4.0.0  1.2.0
versions:  1.0.0  1.0.1  1.0.2  1.1.0
dist-tags: latest → 1.1.0
```

`2.0.0`, `3.0.0`, `3.0.1`, `4.0.0` **and `1.2.0`** were published between 2026-03-27 and 2026-03-30, then unpublished (corroborated by `CHANGELOG.md`'s hand-written `## [1.1.0] - 2026-03-30 (Rollback)` block and commit `7b1382e`). **npm permanently retires an unpublished version number — it can never be reused.**

Three consequences fall out immediately:

1. **The rework cannot ship as `2.0.0`.** The number the entire map is named after does not exist and cannot be created.
2. **`package.json` sits on a burned version.** It declares `1.2.0` — itself unpublishable — while npm's `latest` is `1.1.0`. There is also **no `v1.2.0` git tag**.
3. **Changesets cannot get us out.** It bumps only relative to `package.json`, so a `major` computes `1.2.0 → 2.0.0` and `changeset publish` would 403.

### The second fact: there is no installed base

| Metric | Value |
|---|---|
| Total downloads since first publish (2026-03-24) | **1,170** |
| Last week / last month | 104 / 136 |
| Peak day | 381 on **2026-03-27** — the day of the v2→v4 publish churn |
| `latest` | still `1.1.0` |

The peak coincides exactly with the botched release burst, so the bulk is the project's own CI and registry mirrors. Real adoption is effectively zero. This fact sets the cost ceiling for every migration artifact below.

## Decision

### 1. The rework ships as `5.0.0`

The first major above **every** burned number.

The decisive argument is not "next free number" — it is **semver honesty**. Those burned versions were genuinely published for a few days. Anyone who installed one holds a `^2.0.0`, `^3.0.0`, or `^4.0.0` range and a lockfile pinning a version that no longer resolves; their next install re-resolves that range. Therefore:

| Candidate | A stale `^2.0.0` resolves to it? | Verdict |
|---|---|---|
| `2.0.1` | **yes** — delivers a total API rewrite as a semver **patch** | rejected |
| `2.1.0` | **yes** — delivers it as a **minor** | rejected |
| **`5.0.0`** | **no** — above `^2` / `^3` / `^4` alike | **adopted** |

`5.0.0` is the only candidate under which the semver contract cannot lie. Precedent for the gap: **Angular skipped version 3 outright** to realign its router versioning.

### 2. "v2" is an internal codename; `5.0.0` is the only number users see

ADRs 0001–0007 say "v2" throughout. They are **not renamed**. ADRs are append-only historical records — retitling seven files to match a fact discovered *after* those decisions were taken would rewrite history and rot every cross-reference in the ADRs and in the map's Decisions-so-far index.

- **Contributor-facing** (ADRs 0001–0007, `CONTEXT.md`, the map): "v2" stands as the codename for the rework.
- **Consumer-facing** (`README.md`, `MIGRATION.md`, `CHANGELOG.md`, release notes): **`5.0.0` only**. Users never encounter "v2" and never learn a mapping.

This ADR is the single place the mapping is recorded.

### 3. Version bump: hand-set, no changeset

Changesets has no exact-version mechanism, so the execution effort:

1. Sets `package.json` `version` directly: `1.2.0` → **`5.0.0`**.
2. Hand-writes the `## 5.0.0` `CHANGELOG.md` entry (§7).
3. Adds **no changeset** for the rework. `changesets/action` publishes the current `package.json` version when nothing is pending.
4. Resumes normal changeset flow from `5.0.1` / `5.1.0` onward.

This overrides the `CLAUDE.md` "add a changeset for any consumer-facing change" rule **for this release only** — the tool cannot express the jump. Precedent exists: `CHANGELOG.md` already carries a hand-written rollback entry.

**Rejected — a fake `4.0.0` waypoint** (set `package.json` to `4.0.0`, let a `major` changeset compute `5.0.0`). Keeps changesets authoritative, but commits a version to `main` that is both false and burned: a lie in the repository's history to satisfy a tool.

### 4. No codemod

Two reasons beyond the ~0 installed base:

- **It could only cover the easy half.** Renames are mechanical, but `pipe` / `pipeAsync` are **cut outright** (ADR 0004 §4), and choosing between the `/fluent` wrapper and `safeTry` (ADR 0007) at each call site is a **design judgement per site**. `/fp-ts` and `/nest` are removed and need human rewrites. A codemod would leave every genuinely hard site untouched while signalling the job was done.
- **It fights the destination.** ADR 0006 makes v2 zero-dep / zero-peerDep; a codemod means adopting `ts-morph` or `jscodeshift` plus tests, docs, and maintenance for a lean-down effort.

The `MIGRATION.md` rename table (§5) **is** the migration tool — it doubles as a find-and-replace recipe, with the §6 collision as its one explicit exception.

### 5. Migration guide: root `MIGRATION.md`, six areas

Root placement: `docs/` holds **contributor** material (`adr/`, `research/`, `agents/`); this is the one document aimed at **consumers**. Linked from `README.md` and the `5.0.0` changelog entry.

Ordered so the biggest break comes first — **the ESM-only jump outranks every rename**, because it changes whether the package loads at all:

1. **Before you start** — ESM-only, Node **≥22.12**, TypeScript **≥6.0** (ADR 0006). A CJS consumer must load via `require(esm)` or dynamic `import()`.
2. **Rename table** — `Success`/`Failure` → `Ok`/`Err`; `success`/`failure`/`fail` → `ok`/`err`; `isSuccess`/`isFailure` → `isOk`/`isErr`; `mapError` → `mapErr`; `match` keys `onSuccess`/`onFailure` → `ok`/`err`; static `ResultKit.*` → free-function imports.
3. **The 10 cuts** (ADR 0004 §4) and their replacements — `bimap`, `flatten`, `unwrap`, `unwrapSuccess`/`unwrapFailure`, `tap`, `filterSuccesses`/`filterFailures`, `pipe`/`pipeAsync`.
4. **`pipe`/`pipeAsync` → `/fluent` or `safeTry`** — prose plus before/after; a per-site design call, not a substitution.
5. **Removed entrypoints** — `/nest` and `/fp-ts` (§6).
6. **Net-new** — `safeTry` / `safeUnwrap` (ADR 0007), `defineError` (ADR 0002 §4), the `/fluent` entrypoint, `unwrapOrThrow`, `inspect` / `inspectErr`.

### 6. Removed entrypoints: bare note, one mandatory warning

Both `/fp-ts` and `/nest` get a **prose pointer only** — no shim is shipped, no replacement is provided. They are out of scope per the map; the guide states the removal and stops.

- **`/fp-ts`** (`toEither`, `fromEither`, `toTaskEither`, `fromTaskEither`): removed. Convert at your own boundary — `isOk(r) ? right(r.value) : left(r.error)`. No shim ships; no `fp-ts` devDep is retained to typecheck one.
- **`/nest`** (`toHttpException`, `unwrapOrThrow`, `unwrapPromise`, `HttpExceptionDescriptor`, `NestErrorOptions`): removed, no replacement. Map `Result` to HTTP in your own exception filter or interceptor.

**⚠️ The `unwrapOrThrow` collision — the migration's only silent breakage.** This warning is **mandatory** wherever the removals are documented:

| | v1 `/nest` `unwrapOrThrow` | v2 core `unwrapOrThrow` (ADR 0004 §5, net-new) |
|---|---|---|
| Throws | an `HttpException` | a plain throw on `Err` |
| Purpose | HTTP boundary mapping | honest extractor |

The name survives find-and-replace, **still typechecks**, and silently stops producing HTTP responses. Every other break in this migration is loud — a missing export or a type error. This one is not, which is why it is called out explicitly rather than left to the rename table.

### 7. `CHANGELOG.md` `## 5.0.0`: jump + headline breaks + link

Contains, in order:

1. **Why `5.0.0` and not `2.0.0`** — the burned-number explanation. The changelog is the **only** artifact that can answer this, because "why does this jump from 1.1.0 to 5.0.0?" only occurs to someone reading the release.
2. **Breaking** — one-liners: ESM-only / Node ≥22.12 / TS ≥6.0; core API reworked to free functions; `/nest` + `/fp-ts` removed; `fp-ts` and `@nestjs/common` dependencies dropped.
3. **Added** — `/fluent`, `safeTry` / `safeUnwrap`, `defineError`, `unwrapOrThrow`, `inspect` / `inspectErr`.
4. **→ See `MIGRATION.md`.**

It deliberately **does not restate the rename table**. `MIGRATION.md` is its single source of truth; a second copy in an append-only changelog would drift on the first edit and never be reconciled.

### 8. Deprecate the 1.x line

After `5.0.0` publishes:

```sh
npm deprecate "@zireal/result-kit@1.x" \
  "v1 is unmaintained. v5 is a full rework: see MIGRATION.md"
```

`5.0.0` takes over `latest` automatically, but that reaches nobody pinned to `^1.0.0` — and given the version jump, a pinned consumer has no reason to go looking for a `5`. `npm deprecate` only prints a warning; it never breaks a build.

## Rejected alternatives

- **Ship as `2.0.1` or `2.1.0`** (reclaim the "2" line, keeping every ADR's "v2" literally true). Rejected — a stale `^2.0.0` caret resolves straight to either, delivering a full API rewrite as a patch/minor. Doc consistency is not worth breaking the semver contract; §2 solves the naming instead.
- **Rename ADRs 0001–0007 to "v5".** Vocabulary consistency for contributors — but rewrites decision history to match a later discovery and rots cross-links across seven files plus the map index. Rejected — ADRs are append-only; §2 records the mapping once.
- **Market "v2" to users** (docs say "v2 (ships as 5.0.0)"). Zero doc churn — but pushes the mapping onto every consumer, who must hold a name and a different number. Rejected — confusion belongs with us, not them.
- **Fake `4.0.0` waypoint + `major` changeset.** Keeps changesets authoritative — but commits a false, burned version to `main`. Rejected (§3).
- **Changeset for content, hand-edit the version in the Version Packages PR.** Yields a tool-generated changelog *and* the right number — but a manual override inside CI that any careless merge silently reverts to the 403-ing `2.0.0`. Rejected — fragile.
- **Ship a rename codemod.** Best UX for the mechanical half — but new tooling, tests, docs and maintenance against a zero-dep lean-down, for ~0 users, still unable to touch `pipe` / `fp-ts` / `nest`. Rejected (§4).
- **Backlog the codemod on demand** (as [#18](https://github.com/alifarooq-zk/result-kit/issues/18) did for formatters). Explicit and reversible — but the download data says the demand will not arrive; a ticket for it is ceremony. Rejected — reconsider if a real consumer ever asks.
- **A typechecked `examples/fp-ts-shim.ts`.** CI would prove the shim correct and it could never rot — but retains `fp-ts` in devDeps forever to guard a feature we deleted. Rejected; then the shim itself was cut (§6).
- **A full copy-paste fp-ts shim block in the guide.** ~20 lines, zero deps, genuinely unblocks an fp-ts consumer — rejected as still more than a removed, out-of-scope entrypoint with no users earns.
- **A worked Nest exception-filter recipe.** Gives Nest users a working path — but bakes NestJS architecture opinions into the package this map spent its whole length removing NestJS from. Rejected.
- **`MIGRATION.md` under `docs/migration/v1-to-v5.md`.** Scales to a future v5→v6 guide — but buries a consumer doc among contributor material. Rejected — root.
- **Migration as a README section.** Renders on npm, nothing extra to maintain — but the README (209 lines, needing a full rewrite anyway) would be dominated by a six-area migration block in the document new users read first. Rejected — link to `MIGRATION.md`.
- **Inline the rename table into the changelog.** Standalone release notes, no second click — but two copies that drift (§7). Rejected.
- **Leave 1.x undeprecated.** No nagging, honest about ~0 adoption — but a genuinely pinned consumer never learns `5.0.0` exists. Rejected — one command (§8).

## Consequences

- **The map is complete.** This was its final ticket; every design decision (ADRs 0001–0007) and the migration story are now settled, and no fog remains. **The v2 spec is handoff-ready** for the separate execution effort.
- **The map's destination is amended in one respect:** "a clean breaking major" is now specifically **`5.0.0`**, not `2.0.0`. The rework's *content* is untouched — every prior ADR stands exactly as accepted.
- **The execution effort inherits a precise release checklist:** hand-set `package.json` to `5.0.0` · hand-write the `## 5.0.0` changelog entry · add **no** changeset for the rework · write root `MIGRATION.md` (six areas, §5) · rewrite `README.md` against the v2 surface · `npm deprecate` 1.x post-publish · resume changesets at 5.0.1+.
- **`unwrapOrThrow` is a coordination constraint on the execution effort**, not just a doc line. It is the one break that survives find-and-replace and still typechecks; §6's warning must land in `MIGRATION.md` and in the `5.0.0` changelog's Breaking list.
- **No codemod exists**, so the rename table in `MIGRATION.md` is load-bearing — it must be complete enough to drive a find-and-replace, with the §6 collision as its stated exception.
- **Two repo-hygiene defects are recorded here but deliberately not acted on** (this map is planning-only; they belong to the execution effort):
  - `dist/` is **checked into the working tree** and stale since May, while `.gitignore` (47 bytes) does not cover it.
  - There is **no `v1.2.0` git tag**, despite `package.json` and `CHANGELOG.md` both claiming that version — which is itself burned. Tag hygiene should restart from `v5.0.0`.
- **Changesets is knowingly bypassed once.** The `CLAUDE.md` release rule ("add a changeset for any consumer-facing change") holds for every release *except* this one; §3 is the documented exception, and normal flow resumes at `5.0.1`.
