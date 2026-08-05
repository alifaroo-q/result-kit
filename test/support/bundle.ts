import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';

/**
 * The shared machinery behind the spec §7.3 boundary guards.
 *
 * Extracted when `/testing` landed ([#63](https://github.com/alifaroo-q/result-kit/issues/63)):
 * §7.3's claim is now made about **three** entrypoints, and a second copy of a
 * guard is a guard that gets fixed in one place. Every helper here was moved
 * verbatim from `test/fluent/boundary.spec.ts`, where it was proved to go red;
 * both callers re-prove it independently.
 *
 * Not a `.spec.ts`, so vitest's default `include` does not collect it.
 */

export const ROOT = resolve(import.meta.dirname, '../..');
export const DIST = join(ROOT, 'dist');

/** The built entry for each `exports` branch that emits code. */
export const ENTRIES = {
  root: join(DIST, 'index.js'),
  fluent: join(DIST, 'fluent/index.js'),
  testing: join(DIST, 'testing/index.js'),
} as const;

async function newestMtime(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  const times = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    }),
  );
  return Math.max(0, ...times);
}

/**
 * Builds `dist/` when it is missing or older than `src/`.
 *
 * These guards are claims about `dist/`, so reading whatever happens to be
 * lying around would report green about a stale bundle — the exact failure mode
 * they exist to prevent.
 */
export async function ensureBuilt(): Promise<void> {
  const stale =
    !existsSync(ENTRIES.root) ||
    (await newestMtime(join(ROOT, 'src'))) > statSync(ENTRIES.root).mtimeMs;

  if (stale) {
    execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'pipe' });
  }
}

/**
 * Comments removed, so a JSDoc *example* is not mistaken for an import.
 *
 * This is the same false-positive class §7.3's note warns about for naive text
 * greps, and it bit for real: `src/testing/index.ts`'s module doc shows
 * `import { expect } from 'vitest'` in a fenced sample, which tsdown carries
 * into `dist/testing/index.js` — so the un-stripped scanner reported the
 * shipped bundle importing `vitest`, the exact opposite of the truth.
 *
 * Only block comments and whole-line `//` comments are stripped; a trailing
 * `//` is left alone so a `https://` inside a string cannot eat the rest of a
 * line that also holds a real import.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every import specifier in a chunk. Bare ones included — see `importsOf`.
 *
 * Exported so [`bundle.spec.ts`](./bundle.spec.ts) can test it directly. This
 * is the piece that reported the *opposite of the truth* about the shipped
 * bundle, and a guard whose detector is untested is a guard that reports green
 * for the wrong reason — §7.3's own closing note.
 */
export function allImports(code: string): string[] {
  return [
    ...stripComments(code).matchAll(/(?:from|import)\s*["']([^"']+)["']/g),
  ].map((m) => m[1] as string);
}

/** Static *relative* specifiers — enough, because the build emits no dynamic ones. */
function importsOf(code: string): string[] {
  return allImports(code).filter((s) => s.startsWith('.'));
}

/**
 * Every chunk the entry pulls in, transitively — the actual unit a consumer
 * downloads. Checking only the entry file would miss code parked in a shared
 * chunk, which is a live possibility: rolldown already splits the core into one
 * (`transforms-*.js`) precisely because more than one entrypoint uses it.
 */
export function chunkClosure(entry: string): string[] {
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

/**
 * Every **bare** specifier the entry's closure imports — i.e. everything the
 * shipped bundle asks a package manager to resolve.
 *
 * This is how the zero-installed-dependency promise is checked on the artifact
 * rather than on the manifest (ADR 0014 §0). `publint`/`attw` cannot make this
 * claim: they check that declared entrypoints resolve, not what the emitted
 * code reaches for.
 */
export function bareImportsOf(entry: string): string[] {
  return [
    ...new Set(
      chunkClosure(entry).flatMap((chunk) =>
        allImports(readFileSync(chunk, 'utf8')).filter(
          (s) => !s.startsWith('.'),
        ),
      ),
    ),
  ];
}

/**
 * The `src/` files that fed a chunk, via its sourcemap.
 *
 * A missing map would make the structural check vacuously green — the exact
 * failure mode this guard exists to prevent. Throw instead.
 */
export function sourcesOf(chunk: string): string[] {
  const mapPath = `${chunk}.map`;

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

/** The `src/` files feeding an entry's whole chunk closure. */
export function sourcesFeeding(entry: string): string[] {
  return chunkClosure(entry).flatMap(sourcesOf);
}
