---
'@zireal/result-kit': minor
---

Add `defineErrors` and the `ErrorsOf<T>` type — the canonical way to declare a registry of error constructors and derive the union of their outputs in one line, instead of hand-writing `ReturnType<typeof a> | ReturnType<typeof b> | …`.

```ts
import { defineErrors } from '@zireal/result-kit';
import type { ErrorsOf } from '@zireal/result-kit';

const appErrors = defineErrors({ notFound, forbidden });
type AppError = ErrorsOf<typeof appErrors>;
```

`ErrorsOf` is constructor-based, so every variant keeps its own typed payload and the discriminant stays literal for exhaustive `switch (error.type)` narrowing. `defineErrors` is a constrained identity — it type-checks the bag so a non-constructor entry is caught at the registration site. Both are additive: the manual `ReturnType<…>` union stays fully supported, and `ErrorsOf` also accepts a plain object literal of constructors.
