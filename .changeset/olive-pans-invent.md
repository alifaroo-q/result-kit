---
'@zireal/result-kit': minor
---

Add `matchType` to the root barrel — exhaustive, expression-form dispatch over a `TypedError` union.

`switch (error.type)` narrows, but it is a statement and it is not exhaustive-checked without a `never` helper in the default branch. `matchType` makes exhaustiveness the type: one arm per variant, each receiving its own narrowed variant, returning the union of the arms' return types.

```ts
import { matchType } from '@zireal/result-kit';

const status = matchType(error, {
  not_found: () => 404,
  forbidden: () => 403,
  conflict: (e) => (e.details!.slug ? 409 : 400),
});
//    ^? number — a missing arm, or an arm keyed on a tag the union
//       does not have, is a compile error
```

A catch-all is an optional **third argument** rather than a `_` key in the handler bag, and it is typed to the variants you did **not** handle:

```ts
matchType(error, { not_found: () => 404 }, (e) => {
  //                                        ^? forbidden | conflict
  logUnexpected(e);
  return 500;
});
```

That residual narrowing is the reason for the third-parameter shape: a `_` arm sharing the object cannot be narrowed to the leftovers under any formulation, so it would hand back the variants you just handled.

It operates on the error, not on the `Result` — compose it under `match`'s `err` branch:

```ts
match(result, { ok: () => 200, err: (e) => matchType(e, { /* … */ }) });
```

Two `TypedError` facts it makes prominent: `details` stays optional after the tag narrows (arms read `e.details!.id`), and only a *closed* tag union can be exhausted — a bare `TypedError` has an open `string` tag, so any set of arms satisfies it. Reaching a tag with no arm and no fallback throws rather than returning `undefined` under a type promising a value; that is only reachable by defeating the types.

Purely additive — no existing signature changes, and a consumer who does not import it ships none of it.
