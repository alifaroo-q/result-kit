/**
 * Type-checked by `pnpm check` — `"examples"` is in tsconfig's `include`.
 *
 * Its job is narrower than `core.ts`'s and worth stating precisely: it imports
 * through the **bare specifier** `@zireal/result-kit/testing`, so it is the one
 * thing in the repo that fails when that specifier does not resolve for a
 * consumer-shaped import. #28 added `/fluent` and shipped an unresolvable
 * specifier because every in-repo test imports relatively — nothing failed.
 *
 * It does **not** isolate *which* mechanism resolves it. Measured, not assumed:
 * with the `paths` entry deleted, this still compiles, because TypeScript
 * self-resolves the package's own name through `exports` to `dist/`. Only
 * deleting **both** turns it red. So a missing `paths` entry alone is caught by
 * `core.ts`'s hazard instead — it means a stale `dist/` is what got checked.
 *
 * It also compiles the ambient `Matchers` augmentation: the `toBeOkWith` call
 * below only typechecks if importing the subpath brings the augmentation with
 * it. Delete the import and this file stops compiling — which is the assertion.
 */

import { defineError, err, ok } from '@zireal/result-kit';
import type { Result } from '@zireal/result-kit';
import { resultMatchers } from '@zireal/result-kit/testing';
import { expect } from 'vitest';

expect.extend(resultMatchers);

const notFound = defineError(
  'not_found',
  (d: { id: string }) => `User ${d.id} not found`,
);

type User = { id: string; name: string };
type LoadError = ReturnType<typeof notFound>;

function loadUser(id: string): Result<User, LoadError> {
  return id === 'u1' ? ok({ id, name: 'Ada' }) : err(notFound({ id }));
}

expect(loadUser('u1')).toBeOk();
expect(loadUser('u1')).toBeOkWith({ id: 'u1', name: 'Ada' });

expect(loadUser('nope')).toBeErr();
expect(loadUser('nope')).toBeErrWith(notFound({ id: 'nope' }));
expect(loadUser('nope')).toBeErrWith(
  expect.objectContaining({ type: 'not_found' }),
);
