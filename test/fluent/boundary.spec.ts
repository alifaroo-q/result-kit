import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { ENTRIES, ensureBuilt, sourcesFeeding } from '../support/bundle';

/**
 * **The §7.3 fluent-boundary guard** — "the single most important piece of
 * infrastructure in the spec: the only thing standing between the design and a
 * silent regression that erases the differentiator the whole rework is built
 * on."
 *
 * ADR 0001's headline differentiator is a tree-shakable core that class-only
 * neverthrow structurally *cannot* offer. It survives only if the root `.`
 * bundle never contains the fluent wrapper. §7.3 says prose is not sufficient,
 * so this fails loudly instead.
 *
 * **The structural mechanism reads `dist/`, not `src/`** — it is a claim about
 * what a consumer downloads, which is why `publint` / `attw` cannot make it
 * (they check resolution, not bundle contents). It therefore builds first, in
 * `beforeAll`, rather than trusting whatever `dist/` happens to be lying around:
 * a guard that silently reads a stale bundle is worse than no guard, because it
 * reports green.
 *
 * **The behavioural assertions below run against both `src/` and `dist/`**
 * (§10.12) — see the note above `SURFACES`.
 *
 * ### Two independent mechanisms, on purpose
 *
 * 1. **Structural (sourcemaps).** The transitive chunk closure of the root entry
 *    must be fed by no source under `src/fluent/`. This is the strong one: it
 *    sees wrapper code that ships **even if nothing exports it** — dead weight in
 *    the bundle is exactly the tree-shaking regression at issue — and it is immune
 *    to prose, since a doc comment mentioning `ResultChain` is not a *source*.
 *    (`dist/index.js` genuinely does mention `/fluent` in JSDoc today, so a naive
 *    text grep would false-positive, and a false-positive guard is one somebody
 *    disables.)
 * 2. **Behavioural (runtime).** Importing only from `.`, no export may be a
 *    wrapper or produce one. This sees an actual surface leak without depending
 *    on sourcemaps existing at all.
 *
 * Either alone has a blind spot the other covers. Both must hold.
 *
 * **The machinery now lives in [`test/support/bundle.ts`](../support/bundle.ts)**,
 * extracted when [#63](https://github.com/alifaroo-q/result-kit/issues/63) added
 * a third entrypoint with its own §7.3 obligations
 * ([`test/testing/boundary.spec.ts`](../testing/boundary.spec.ts)). The helpers
 * moved verbatim and the assertions here are unchanged; both leaks were
 * re-simulated after the move and this file went red for each.
 */

/** The wrapper classes §7.3 names. */
const WRAPPERS = ['ResultChain', 'ResultAsync'] as const;

beforeAll(ensureBuilt, 120_000);

describe('the §7.3 fluent boundary — structural', () => {
  it('rootBundle_isFedByNoFluentSource', () => {
    const sources = sourcesFeeding(ENTRIES.root);

    expect(sources).not.toEqual(
      expect.arrayContaining([expect.stringContaining('src/fluent/')]),
    );
  });

  it('rootBundle_isFedOnlyByCoreSources', () => {
    const sources = sourcesFeeding(ENTRIES.root);

    // Stated positively too: an empty/garbled source list would satisfy the
    // negative above while proving nothing.
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatch(/^src\/core\//);
    }
  });

  /**
   * The positive control, and it is not ceremony: it is what separates "the
   * wrapper is absent" from "this detector cannot see a wrapper anywhere". The
   * two tests above would pass identically against a broken `sourcesOf`.
   */
  it('detector_findsTheWrapperInTheFluentBundleWhereItBelongs', () => {
    const sources = sourcesFeeding(ENTRIES.fluent);

    expect(sources).toEqual(
      expect.arrayContaining([expect.stringContaining('src/fluent/')]),
    );
  });
});

/**
 * The behavioural assertions run against **both** the source tree and the built
 * bundle, and running them twice is the point (§10.12).
 *
 * They used to import only `src/`, which proved the *source* boundary and left
 * the *shipped* one uncovered — so a packaging regression that pulled the
 * wrapper into the root bundle passed them. Demonstrated before fixing: with a
 * `ResultChain` export bolted onto `dist/index.js`, all five stayed green, and
 * they stayed green against a `dist/` that did not even parse.
 *
 * The structural mechanism reads `dist/`, but via **sourcemaps** — so it is
 * blind in the mirror direction, to anything that changes the emitted bundle
 * without changing the map. Neither mechanism subsumes the other, and neither
 * covers both trees; only running these against both does.
 *
 * `src/` is kept rather than replaced: it fails earlier and more legibly on a
 * source-level regression, and it does not depend on the build succeeding.
 *
 * **What the `dist` pass does and does not cover**, measured rather than
 * assumed. It genuinely reads the emitted file — verified with a marker export
 * that only exists in `dist/`, and by the wrapper-leak simulation above. It does
 * **not** catch a bundle that fails to *link*: vitest's module runner is more
 * permissive than Node's ESM linker, so an `export { Undefined }` bolted onto
 * `dist/index.js` throws under plain `node` but imports fine here. That is an
 * acceptable blind spot — a non-linking bundle is caught by `pnpm build`, by
 * `publint`/`attw`, and by the first consumer to import it. The class this guard
 * exists for is the silent one: a **valid** bundle whose contents are wrong.
 */
const SURFACES = [
  { tree: 'src', load: () => import('../../src/index') },
  { tree: 'dist', load: () => import(pathToFileURL(ENTRIES.root).href) },
] as const;

describe.each(SURFACES)(
  'the §7.3 fluent boundary — behavioural ($tree)',
  ({ load }) => {
    it('rootBarrel_exportsNoWrapper', async () => {
      const surface = (await load()) as Record<string, unknown>;

      for (const wrapper of WRAPPERS) {
        expect(surface).not.toHaveProperty(wrapper);
      }
    });

    it('rootBarrel_exportsNoValueThatIsAWrapperInstance', async () => {
      const surface = (await load()) as Record<string, unknown>;

      for (const value of Object.values(surface)) {
        expect(WRAPPERS).not.toContain(
          (value as { constructor?: { name?: string } })?.constructor?.name,
        );
      }
    });

    /**
     * §7.3's "extend it to cover `safeTry` / `safeUnwrap`". Both are *root*
     * exports (§5.9), so the guard is not that they are absent — it is that the
     * root's return plain data. `/fluent` gets same-named dual constructors
     * returning wrappers (§6.3, #30); the failure this catches is the root's
     * being wired to those by accident.
     */
    it('rootSafeTry_returnsPlainDataNotAWrapper', async () => {
      const { ok, safeTry, safeUnwrap } = await load();

      const result = safeTry(function* () {
        const value = yield* safeUnwrap(ok(1));
        return ok(value + 1);
      });

      expect(result).toEqual({ ok: true, value: 2 });
      expect(result.constructor).toBe(Object);
      expect(WRAPPERS).not.toContain(result.constructor.name);
    });

    it('rootSafeUnwrap_yieldsPlainDataNotAWrapper', async () => {
      const { err, safeUnwrap } = await load();

      const yielded = safeUnwrap(err('boom')).next().value;

      expect(yielded).toEqual({ ok: false, error: 'boom' });
      expect((yielded as object).constructor).toBe(Object);
    });

    it('rootOkAndErr_returnPlainDataNotWrappers', async () => {
      const { err, ok } = await load();

      expect(ok(1).constructor).toBe(Object);
      expect(err('boom').constructor).toBe(Object);
    });
  },
);
