# ADR 0010 — v2 formatter helpers over accumulated `TypedError[]`

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Ali Farooq
- **Ticket:** [Formatter helpers for accumulated TypedError[] (post-v2)](https://github.com/alifarooq-zk/result-kit/issues/18)
- **Map:** [Map: @zireal/result-kit v2 — lean, dependency-free core rework](https://github.com/alifarooq-zk/result-kit/issues/8) (complete)
- **Builds on:** [ADR 0001 — v2 core API paradigm](./0001-v2-core-api-paradigm.md), [ADR 0002 — v2 TypedError model](./0002-v2-typederror-model.md), [ADR 0004 — v2 full API surface / method inventory](./0004-v2-api-surface-method-inventory.md)
- **Amends:** [ADR 0004 §4](./0004-v2-api-surface-method-inventory.md) — which **rejected** these helpers and deferred them past the rework. This ADR reverses that deferral. It does not reverse ADR 0002.
- **Evidence:** [`docs/research/api-packaging-landscape.md`](../research/api-packaging-landscape.md); zod's current formatter surface, read from [zod.dev/error-formatting](https://zod.dev/error-formatting) and [zod.dev/v4/changelog](https://zod.dev/v4/changelog) rather than from recollection.

## Context

`combineWithAllErrors` yields a flat `TypedError[]` — the `ZodError.issues[]` analog, and the whole of the accumulation story (spec §5.4). ADR 0004 §4 declined to ship presentation helpers over it: net-new surface against a "lean-down, not feature-expansion" destination, v1 had none, and formatting an array is a userland `.map()`. It was deferred to [#18](https://github.com/alifarooq-zk/result-kit/issues/18) as a post-release additive minor.

**This ADR ships them in `5.0.0` instead**, at the maintainer's direction, before the release rather than after it. Two consequences follow, and only the second is a cost:

- The API **freezes with them included**, so there is no additive-minor churn and no changeset (spec §8.2 already suspends changesets for this release). The 5.0.0 surface is coherent in one cut rather than two.
- The design freezes **without field feedback**. Mitigated by shipping the smallest surface that covers the real shapes, and by the fact that both functions are pure, standalone, and independently tree-shakable — an unused one costs a consumer nothing, which is precisely the property ADR 0001 exists to preserve.

## Decision

### 1. Two pure functions in the root barrel: `groupByType` and `prettifyErrors`

Both take `readonly TypedError[]` and are free, data-first, standalone functions in the flat root barrel — no new entrypoint, which spec §7.1 forbids anyway ("no category subpaths"), and no methods, so a consumer who imports neither ships neither.

```ts
groupByType(errors): { [K in E['type']]?: Extract<E, { type: K }>[] }
prettifyErrors(errors): string
```

### 2. The zod tree formatters are **not** portable, and this is the load-bearing finding

Zod moved in 4.x from `.format()` / `.flatten()` **methods** on `ZodError` to **top-level, tree-shakable functions** — `z.treeifyError()`, `z.prettifyError()`, `z.flattenError()` — deprecating `z.formatError()`. That migration is a direct endorsement of this project's thesis and of ADR 0001's `zod/mini` citation: it is the same move, made by the incumbent, for the same bundling reason.

**Its output shapes do not transfer, for two independently verified reasons:**

1. **All three are driven by `path`, and this library has no `path`.** [ADR 0002 §3](./0002-v2-typederror-model.md) rejected a top-level `path` explicitly — *"validation-specific and meaningless for most variants; it belongs inside a validation error's typed `details` payload."* `treeifyError` and the deprecated `formatError` are **entirely** path-derived: with no path there is no tree, and no `formErrors`-vs-`fieldErrors` split either, since that split is just `path.length === 0`.
2. **`combineWithAllErrors` does not record which input failed.** It returns a flat `E[]`, pushing `result.error` with no index ([`src/core/collections.ts`](../../src/core/collections.ts)). So even a *positional* key is unavailable after the fact — the information does not exist in the value being formatted. Any keyed shape must therefore key on something **intrinsic to the error**.

The one intrinsic key is `type` — this library's discriminant, and the structural analog of `ZodIssue.code`. That is not a compromise: it is the field ADR 0002 built the whole model around, and grouping on it is what #18 itself proposed first.

So the mapping is:

| zod | here | why |
|---|---|---|
| `z.prettifyError` | **`prettifyErrors`** | Ports cleanly — needs only `message` |
| `z.flattenError` | **`groupByType`** | Re-keyed on `type`; the `path`-derived form/field split has no meaning here |
| `z.treeifyError` | — | Not portable without `path` (ADR 0002 §3) |
| `z.formatError` | — | Deprecated upstream; same path dependency |

### 3. `groupByType` returns a **partial** record

```ts
export function groupByType<E extends TypedError<string, unknown>>(
  errors: readonly E[],
): { [K in E['type']]?: Extract<E, { type: K }>[] };
```

Each present key holds the **narrowed** variant, so `groups.not_found` is `NotFound[]`, not `TypedError[]` — the discriminant survives grouping, which is the entire point of grouping on it.

**The keys are optional, and that is a correctness decision, not conservatism.** A union member that happens not to occur at runtime has no key. A non-optional `Record<E['type'], E[]>` would type `groups.forbidden` as `Forbidden[]` and hand back `undefined`, which is the silent-wrong-value class this project has spent §10.6 through §10.13 removing. Zod's own `fieldErrors` is typed loosely enough to have the same hazard; we decline to copy it. The cost is one `?.` at the call site.

### 4. `prettifyErrors` emits one line per error, `type` included, no path pretense

```
✖ not_found: No user u1
✖ forbidden: Not permitted
```

- **One line per error**, `✖` per line, matching zod's marker so the output is familiar at a glance.
- **`type` is included** because it is the actionable discriminant and the only structured field we have. It is *not* rendered in zod's `→ at <path>` slot: that slot means **location**, ours would mean **classification**, and reusing the visual form for a different meaning would mislead precisely the reader who knows zod.
- **`details` is never read** — arbitrary, possibly large, possibly nested; a one-liner is the wrong place for it, and `groupByType` is the programmatic path to it. **This is not redaction.** `defineError` accepts a message *function* over the payload, so `message` may already carry interpolated fields; `prettifyErrors` neither adds to nor strips from it. A first draft of this ADR claimed the stronger "no payload disclosure" property, and the test written to assert it failed — correctly. Keep sensitive fields out of `message`; no formatter can undo that choice.
- **An empty array returns an empty string**, not a placeholder — a formatter that invents text for "no errors" cannot be composed into a larger message.

## Alternatives considered

- **`prettifyErrors` only.** Genuinely tempting: with `Object.groupBy` in ES2024 and available on the Node 22.12 floor, `groupByType` is close to a one-liner. Rejected because the one-liner loses **half** the typing — and the precise half matters, because a first draft of this ADR overstated it. `Object.groupBy` does keep the literal keys: it returns `Partial<Record<'not_found' | 'forbidden', AppError[]>>`, so the *key* set is right and optionality is right. What it loses is the per-group **value** narrowing — `groups.not_found` is `AppError[]`, not `NotFound[]`, so reading `details` gives the union's payload rather than the variant's. That is the whole benefit, and it is worth two exported names; claiming the keys were lost too was simply wrong.
- **A third `flatten` returning `{ messages, byType }`.** More literally parallel to `z.flattenError`. Rejected: `byType` duplicates `groupByType`, and the `formErrors` half it exists to mirror has no meaning without `path` — copying the shape would import zod's vocabulary without zod's semantics.
- **Add `path` to `TypedError` and port `treeify`.** Rejected — reverses [ADR 0002 §3](./0002-v2-typederror-model.md) on a settled question, makes a validation-specific field structural for every variant, and inherits [zod#4213](https://github.com/colinhacks/zod/issues/4213), where the `properties` / `items` wrapper keys are reported as verbose and conceptually collidable with real field names.
- **Methods on a wrapper.** Rejected — this is the exact prototype-method shape ADR 0001 rejected and zod 4 walked back.
- **Keep deferring to a 5.1.0 minor** (ADR 0004's position). Overridden by the maintainer, for §1's reasons.

## Consequences

- The root barrel gains **two** free functions: **27 → 29 values**. Spec §5.9's export list and §5's group tables are updated; no existing signature changes.
- ADR 0004's "no formatters in the rework" line is **superseded**, and ADR 0004 is append-only — this ADR is the amendment, recorded here rather than by editing it.
- **ADR 0002 is untouched and reaffirmed.** No `path`; the four-field shape stands. This ADR's central finding is a *consequence* of ADR 0002, not a challenge to it.
- `TypedError` gains a second consumer inside the library, so its shape is now load-bearing for presentation as well as narrowing — a reason to be more, not less, conservative about changing it.
- #18 closes with the rework rather than after it, and nothing on the map is left open behind the release.
