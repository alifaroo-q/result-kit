---
'@zireal/result-kit': minor
---

Add `expectOk` / `expectErr` assertion helpers to the root barrel

`expectOk(result)` narrows a `Result` to its value, throwing a descriptive error
on `Err`. `expectErr(result)` narrows a `Result` to its error, throwing on `Ok`.

Both use `JSON.stringify` in their error messages for readability. They are
pure, framework-agnostic functions — no peer dependency, no test-framework
coupling. The existing userland helper in `RECIPES.md` is replaced by the
built-in.
