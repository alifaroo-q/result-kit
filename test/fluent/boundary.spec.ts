import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

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
 * **This guard reads `dist/`, not `src/`** — it is a claim about what a consumer
 * downloads, which is why `publint` / `attw` cannot make it (they check
 * resolution, not bundle contents). It therefore builds first, in `beforeAll`,
 * rather than trusting whatever `dist/` happens to be lying around: a guard that
 * silently reads a stale bundle is worse than no guard, because it reports
 * green.
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
 */

const ROOT = resolve(__dirname, '../..');
const DIST = join(ROOT, 'dist');
const ROOT_ENTRY = join(DIST, 'index.js');
const FLUENT_ENTRY = join(DIST, 'fluent/index.js');

/** The wrapper classes §7.3 names. `ResultAsync` arrives in #29 — guarded now. */
const WRAPPERS = ['ResultChain', 'ResultAsync'] as const;

async function newestMtime(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  const times = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory()
        ? newestMtime(full)
        : statSync(full).mtimeMs;
    }),
  );
  return Math.max(0, ...times);
}

/** Static import specifiers — enough, because the build emits no dynamic ones. */
function importsOf(code: string): string[] {
  return [...code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('.'));
}

/**
 * Every chunk the entry pulls in, transitively — the actual unit a consumer
 * downloads. Checking only the entry file would miss a wrapper parked in a
 * shared chunk, which is a live possibility: rolldown already splits the core
 * into one (`transforms-*.js`) precisely because both entrypoints use it.
 */
function chunkClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const chunk = queue.pop() as string;
    if (seen.has(chunk) || !existsSync(chunk)) continue;
    seen.add(chunk);

    for (const spec of importsOf(readFileSync(chunk, 'utf8'))) {
      queue.push(resolve(dirname(chunk), spec));
    }
  }

  return [...seen];
}

/** The `src/` files that fed a chunk, via its sourcemap. */
function sourcesOf(chunk: string): string[] {
  const mapPath = `${chunk}.map`;

  // A missing map would make the structural check vacuously green — the exact
  // failure mode this guard exists to prevent. Fail instead.
  if (!existsSync(mapPath)) {
    throw new Error(
      `No sourcemap for ${chunk}. The §7.3 structural guard reads sourcemaps; ` +
        `without them it would pass vacuously. Re-enable \`sourcemap: true\` in tsdown.config.ts.`,
    );
  }

  const { sources } = JSON.parse(readFileSync(mapPath, 'utf8')) as {
    sources: string[];
  };

  return sources.map((source) =>
    posix.normalize(relative(ROOT, resolve(dirname(chunk), source))),
  );
}

beforeAll(async () => {
  const stale =
    !existsSync(ROOT_ENTRY) ||
    (await newestMtime(join(ROOT, 'src'))) > statSync(ROOT_ENTRY).mtimeMs;

  if (stale) {
    execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'pipe' });
  }
}, 120_000);

describe('the §7.3 fluent boundary — structural', () => {
  it('rootBundle_isFedByNoFluentSource', () => {
    const sources = chunkClosure(ROOT_ENTRY).flatMap(sourcesOf);

    expect(sources).not.toEqual(
      expect.arrayContaining([expect.stringContaining('src/fluent/')]),
    );
  });

  it('rootBundle_isFedOnlyByCoreSources', () => {
    const sources = chunkClosure(ROOT_ENTRY).flatMap(sourcesOf);

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
   * three tests above would pass identically against a broken `sourcesOf`.
   */
  it('detector_findsTheWrapperInTheFluentBundleWhereItBelongs', () => {
    const sources = chunkClosure(FLUENT_ENTRY).flatMap(sourcesOf);

    expect(sources).toEqual(
      expect.arrayContaining([expect.stringContaining('src/fluent/')]),
    );
  });
});

describe('the §7.3 fluent boundary — behavioural', () => {
  it('rootBarrel_exportsNoWrapper', async () => {
    const surface = (await import('../../src/index')) as Record<string, unknown>;

    for (const wrapper of WRAPPERS) {
      expect(surface).not.toHaveProperty(wrapper);
    }
  });

  it('rootBarrel_exportsNoValueThatIsAWrapperInstance', async () => {
    const surface = (await import('../../src/index')) as Record<string, unknown>;

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
    const { ok, safeTry, safeUnwrap } = await import('../../src/index');

    const result = safeTry(function* () {
      const value = yield* safeUnwrap(ok(1));
      return ok(value + 1);
    });

    expect(result).toEqual({ ok: true, value: 2 });
    expect(result.constructor).toBe(Object);
    expect(WRAPPERS).not.toContain(result.constructor.name);
  });

  it('rootSafeUnwrap_yieldsPlainDataNotAWrapper', async () => {
    const { err, safeUnwrap } = await import('../../src/index');

    const yielded = safeUnwrap(err('boom')).next().value;

    expect(yielded).toEqual({ ok: false, error: 'boom' });
    expect((yielded as object).constructor).toBe(Object);
  });

  it('rootOkAndErr_returnPlainDataNotWrappers', async () => {
    const { err, ok } = await import('../../src/index');

    expect(ok(1).constructor).toBe(Object);
    expect(err('boom').constructor).toBe(Object);
  });
});
