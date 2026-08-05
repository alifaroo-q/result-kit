---
'@zireal/result-kit': minor
---

Add the optional `@zireal/result-kit/testing` entrypoint: four Vitest matchers — `toBeOk`, `toBeOkWith`, `toBeErr`, `toBeErrWith` — registered with `expect.extend(resultMatchers)`.

```ts
// vitest.setup.ts
import { expect } from 'vitest';
import { resultMatchers } from '@zireal/result-kit/testing';

expect.extend(resultMatchers);
```

```ts
expect(await loadPlan(id)).toBeOkWith({ kind: 'noop' });
expect(await loadPlan(bad)).toBeErrWith(missingBaseItem());
expect(await loadPlan(bad)).toBeErrWith(
  expect.objectContaining({ type: 'missing_base_item' }),
);
```

Both `*With` matchers are deep equality; partial matching is Vitest's own `expect.objectContaining`, which they honour. Failure messages are delegated to the existing `expectOk` / `expectErr`, so a wrong-branch failure reports the branch you actually got rather than diffing against the wrong half. The matchers **assert** — they do not narrow, because a Vitest matcher cannot; keep using `expectOk` / `expectErr` to read `.value` afterwards.

`vitest` is now declared as an **optional** peer dependency. Optional peers are never installed, and the shipped `dist/testing/` chunk imports no bare specifier at all, so the core artifact's zero-install-footprint promise is unchanged — a consumer who installs `@zireal/result-kit` for `ok` / `err` / `Result` still pulls in nothing. That is asserted against the built bundle, not just the manifest. (ADR 0014 §0–§1, closing ADR 0011's deferred Option A.)

Round one is Vitest-only. On Jest or any other runner, the framework-agnostic `expectOk` / `expectErr` remain the supported path.
