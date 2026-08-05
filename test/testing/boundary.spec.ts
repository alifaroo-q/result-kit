import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ENTRIES,
  bareImportsOf,
  ensureBuilt,
  sourcesFeeding,
} from '../support/bundle';

/**
 * **The §7.3 boundary guard, extended to `/testing`** — required by
 * [ADR 0014](../../docs/adr/0014-peer-dependency-policy-and-lint-package-layout.md)
 * ("the §7.3 boundary test extended to `/testing`"), shipped in
 * [#63](https://github.com/alifaroo-q/result-kit/issues/63).
 *
 * `/testing` makes **two** claims a consumer cannot check by reading the
 * manifest, so both are asserted against the built bundle:
 *
 * 1. **It is off the root's path.** Matcher code must never reach the `.`
 *    chunk graph — the same tree-shaking property `/fluent` has, for the same
 *    reason (ADR 0001). It must also not drag `/fluent` in: `/testing`
 *    delegates to the *core* `expectOk` / `expectErr`, never to the wrapper.
 * 2. **The `vitest` peer is optional in fact, not just in the manifest**
 *    (ADR 0014 §1). `peerDependenciesMeta.optional` is a claim about
 *    *installation*; what makes it safe is that the emitted `dist/testing/`
 *    chunk contains no `vitest` specifier at all, because the module imports
 *    only vitest *types*. `publint` and `attw` cannot see this — they check
 *    that declared entrypoints resolve, not what the emitted code reaches for.
 *
 * Each block carries a **positive control** for the same reason the fluent
 * guard does: "the matchers are absent from the root" and "this detector cannot
 * see matchers anywhere" are otherwise indistinguishable.
 */

/** Every matcher §63 ships. Named here so a silent drop fails loudly. */
const MATCHERS = ['toBeOk', 'toBeOkWith', 'toBeErr', 'toBeErrWith'] as const;

beforeAll(ensureBuilt, 120_000);

describe('the §7.3 boundary for /testing — structural', () => {
  it('rootBundle_isFedByNoTestingSource', () => {
    const sources = sourcesFeeding(ENTRIES.root);

    expect(sources).not.toEqual(
      expect.arrayContaining([expect.stringContaining('src/testing/')]),
    );
  });

  it('testingBundle_isFedByNoFluentSource', () => {
    const sources = sourcesFeeding(ENTRIES.testing);

    expect(sources).not.toEqual(
      expect.arrayContaining([expect.stringContaining('src/fluent/')]),
    );
  });

  /**
   * The positive control. Without it, the two negatives above pass identically
   * against a `sourcesFeeding` that returns nothing for `/testing`.
   */
  it('detector_findsTheMatchersInTheTestingBundleWhereTheyBelong', () => {
    const sources = sourcesFeeding(ENTRIES.testing);

    expect(sources).toEqual(
      expect.arrayContaining([expect.stringContaining('src/testing/')]),
    );
  });
});

describe('the §7.3 boundary for /testing — the optional vitest peer', () => {
  it('testingBundle_importsNoBareSpecifierAtRuntime', () => {
    const bare = bareImportsOf(ENTRIES.testing);

    expect(bare).toEqual([]);
  });

  /**
   * The positive control for the detector above: it must be able to *see* a
   * bare specifier when one is genuinely there. `node:` builtins in the test
   * tree are not part of `dist/`, so the control uses this spec file's own
   * source, which imports `vitest` bare.
   */
  it('detector_findsABareSpecifierWhenOneIsPresent', () => {
    const bare = bareImportsOf(new URL(import.meta.url).pathname);

    expect(bare).toContain('vitest');
  });
});

/**
 * Run against **both** trees, for the reason §10.12 records on the fluent
 * guard: `src/` fails earlier and does not depend on the build, `dist/` is the
 * only one that sees a packaging regression.
 */
const SURFACES = [
  {
    tree: 'src',
    root: () => import('../../src/index'),
    testing: () => import('../../src/testing/index'),
  },
  {
    tree: 'dist',
    root: () => import(pathToFileURL(ENTRIES.root).href),
    testing: () => import(pathToFileURL(ENTRIES.testing).href),
  },
] as const;

describe.each(SURFACES)(
  'the §7.3 boundary for /testing — behavioural ($tree)',
  ({ root, testing }) => {
    it('rootBarrel_exportsNoMatcher', async () => {
      const surface = (await root()) as Record<string, unknown>;

      for (const matcher of [...MATCHERS, 'resultMatchers']) {
        expect(surface).not.toHaveProperty(matcher);
      }
    });

    it('testingEntry_exportsTheMatcherBag', async () => {
      const { resultMatchers } = (await testing()) as {
        resultMatchers: Record<string, unknown>;
      };

      expect(Object.keys(resultMatchers).sort()).toEqual([...MATCHERS].sort());
    });

    it('testingEntry_exportsNothingElse', async () => {
      const surface = (await testing()) as Record<string, unknown>;

      expect(Object.keys(surface)).toEqual(['resultMatchers']);
    });
  },
);
