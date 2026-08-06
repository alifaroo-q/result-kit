---
'@zireal/result-kit': patch
---

`safeTry` now fully unwinds a body whose `finally` itself contains a fallible cleanup step (`yield* safeUnwrap(...)`). Previously a yield reached during short-circuit close re-suspended the generator after a single `.return()`, so outer `finally` blocks never ran and the body was stranded mid-unwind — the same resource-leak class the short-circuit release exists to prevent. `release` now drives `.return()` until the generator reports done, in both the sync and async runners; the async caller's promise still settles only after the full unwind. The first `Err` remains the answer — an `Err` yielded during cleanup cannot re-route the result, matching the existing rule that ignores a `finally`'s `return ok(...)` override.
