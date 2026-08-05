# PROTOTYPE — `matchType` exhaustiveness typing (issue #73)

Throwaway. Delete once the verdict lands in the issue / an ADR.

**Question** (#73): does `matchType`'s compile-time exhaustiveness hold against
`ErrorsOf` unions **without `any`**, with each handler receiving its narrowed
variant — and what is the default-arm story?

**Run:** `pnpm exec tsc -p prototype/matchtype-73` — silence means every probe
holds. `candidates.ts` has the signatures, `probes.ts` the assertions. Checked
on the repo's own TS **7.0.2**; positive control verified (flipping one
`Expect<Equals<…>>` turns it red).

## Answers

**Yes, it holds — with one signature shape, not the obvious one.**

| # | Design | Verdict |
|---|--------|---------|
| A | one naked `U` shared by every arm | **dead** — `U` never infers; result is silently `unknown`, even with homogeneous arms. Worse than §5.3's `match` trap, which at least errors. |
| B | infer the bag `H extends Arms<E>`, return `ReturnType<H[keyof H]>` | works, but silently accepts an arm for a tag not in the union |
| **B2** | B **+** `H & Record<Exclude<keyof H, E['type']>, never>` | **the one to ship** |
| C | B2 with an `_` arm in the same bag (overload pair) | works; `_` sees the **whole** union |
| D | C, curried, trying to narrow `_` to the residual | **dead** — `H` absorbs `_`, the `Exclude` resolves too early, arm lands on `never` |
| D2 | fallback as its **own third parameter** | works — `_` **is** narrowed to the residual variants |

Point by point:

- **Exhaustiveness holds.** A missing arm is a compile error (`Property
  'conflict' is missing … but required in type 'Arms<AppError>'`).
- **Stray arms need B2.** Under plain B, `teapot: () => 'nope'` compiles — the
  constraint is satisfied by a bag with extra keys, and object freshness does
  not fire against a type parameter. A typo'd tag becomes a dead arm. B2's
  `Record<Exclude<keyof H, E['type']>, never>` rejects it, and the error points
  at the offending arm rather than the call.
- **Per-arm narrowing holds**, including `defineError`'s payload asymmetry:
  `not_found` sees `{ id: string } | undefined`, the no-payload `forbidden` sees
  `undefined` (its `TData` is `never`).
- **No `any`.** Nothing in the signatures uses it, and `IsAny` on the results is
  `false`. Every arm's return is unioned, so heterogeneous arms give
  `string | number` rather than the first-candidate lock §5.3 documents.
- **Hand-written unions behave identically** to `ErrorsOf` ones — nothing here
  depends on `defineErrors`.

## Hazards found

1. **`details` is optional**, so every arm reads `v.details!.id`. Narrowing the
   *tag* does not make the payload non-optional. Not a `matchType` bug — a
   `TypedError` fact `matchType` makes prominent, since it lands in the hero
   snippet.
2. **The bare `TypedError` cannot be exhausted.** Its default open `string` tag
   maps to an index signature, so *any* bag satisfies it — including `{}`,
   which returns `never`. Exhaustiveness is a property of a closed tag union,
   not of the API.
3. **Unresolved `E` degrades honestly**, unlike §10.9's `SettledOr` story: a
   generic wrapper over `E extends TypedError` cannot supply arms at all, and
   the mapped type says so instead of silently widening.

## Verdict

**Promote — `matchType` ships** (#64 leaves Explore).

The shipped signature is **B2 + D2**: exhaustive object-literal bag with the
stray-arm clause, and the default arm as an **optional third parameter**, so it
sees only the residual variants.

```ts
matchType(error, {
  not_found: (e) => 404,
  forbidden: (e) => 403,
  conflict:  (e) => 409,
})                                  // exhaustive; missing arm = compile error

matchType(error, { not_found: (e) => 404 }, (e) => 500)
//                                              ^ e: forbidden | conflict
```

Rejected: the `_`-in-the-bag form (C). It reads better but cannot narrow its
own arm — it would hand the user every variant including the ones they just
handled, which is the same "typed honestly or not at all" line §10.9 draws.
Residual narrowing is the whole reason to prefer this over `switch`, so the
form that can't deliver it does not ship.
