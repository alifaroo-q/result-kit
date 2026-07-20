---
'@zireal/result-kit': patch
---

Add `RECIPES.md`, a task-oriented adoption cookbook shipped in the package: gradual adoption alongside throwing code (`unwrapOrThrow` as the boundary adapter), mapping a `Result` to an HTTP response without changing the `TypedError` shape, testing with plain-data `toEqual`, and the discriminated-union widening gotcha inside `safeTry` bodies with the `satisfies` / `as const` / explicit-type-arg fixes. README now links to it and carries a short widening-gotcha callout.
