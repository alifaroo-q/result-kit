import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROOT } from '../support/bundle';

/**
 * The drift guard for the AI-agent adoption kit ([#65](https://github.com/alifaroo-q/result-kit/issues/65)).
 *
 * `llms.txt` and `llms-full.txt` are **hand-authored distillations**, not
 * generated concatenations — that was the deliberate choice, because a
 * spec-conformant link index teaches an agent nothing without a fetch, and an
 * agent reading `node_modules/` usually cannot fetch. The cost of authoring
 * them by hand is that nothing mechanically diffs them against the source, and
 * the failure mode is silent: an export is renamed, every command stays green,
 * and the brief quietly starts teaching an API that no longer exists.
 *
 * That is the same structural drift the map already flagged for `README.md` —
 * except a stale README misleads a human who can see the compiler disagree,
 * while a stale `llms.txt` is fed to a model as ground truth.
 *
 * So the load-bearing half is pinned here rather than left to review: **every
 * root export must appear in both briefs**, and the counts they state out loud
 * must be true. This does not check prose accuracy — no test can — but it
 * catches the one drift that makes the kit actively wrong.
 */

const read = (name: string) => readFileSync(join(ROOT, name), 'utf8');

/**
 * Pulls the exported names out of the root barrel, split by whether they are
 * types. The barrel is a flat list of `export { … } from './…'` blocks, which
 * is why a parse this small is honest: if it ever stops being flat, the
 * `sanity` block below fails loudly rather than silently under-reporting.
 */
function rootExports(): { values: string[]; types: string[] } {
  const source = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
  const values: string[] = [];
  const types: string[] = [];

  for (const [, body] of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of body.split(',')) {
      const entry = raw.trim();
      if (entry === '') continue;

      const isType = entry.startsWith('type ');
      const name = entry.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();

      (isType ? types : values).push(name);
    }
  }

  return { values, types };
}

const { values, types } = rootExports();

const BRIEFS = ['llms.txt', 'llms-full.txt'] as const;

describe('agent adoption kit', () => {
  it('parses the root barrel into a plausible surface', () => {
    // A guard on the guard: a regex that silently matched nothing would make
    // every assertion below vacuously pass.
    expect(values.length).toBeGreaterThan(30);
    expect(types).toContain('Result');
    expect(values).toContain('ok');
    expect(new Set(values).size).toBe(values.length);
  });

  describe.each(BRIEFS)('%s', (file) => {
    const text = read(file);

    it.each(values)('documents the root export `%s`', (name) => {
      // Word-boundary match so `ok` does not pass on the word "look".
      expect(text).toMatch(new RegExp(`\\b${name}\\b`));
    });

    it.each(types)('documents the root type `%s`', (name) => {
      expect(text).toMatch(new RegExp(`\\b${name}\\b`));
    });

    it('states an export count that is actually true', () => {
      // Both briefs say the number out loud, which is exactly the kind of claim
      // that rots first. `\d+ (free )?functions?` covers both phrasings.
      const claims = [...text.matchAll(/(\d+)\s+(?:free\s+)?(?:function|value)s?\b/g)];

      expect(claims.length).toBeGreaterThan(0);
      for (const [, n] of claims) expect(Number(n)).toBe(values.length);
    });

    it('names every entrypoint and no removed one', () => {
      for (const entry of ['@zireal/result-kit/fluent', '@zireal/result-kit/testing']) {
        expect(text).toContain(entry);
      }

      // The v1 entrypoints are gone. Both briefs name them *as removed* — in a
      // prose table whose left column is deliberately the wrong form — so the
      // guard cannot simply ban the string. What it can ban is a dead
      // entrypoint inside a **fenced code block**, where there is no wrong
      // column and anything written reads as a recommendation.
      const fenced = [...text.matchAll(/```[\s\S]*?```/g)].map(([block]) => block).join('\n');

      for (const dead of ['/core', '/fp-ts', '/nest']) {
        expect(fenced).not.toContain(`@zireal/result-kit${dead}`);
      }
    });
  });

  it('states a type count that is actually true', () => {
    const claim = read('llms-full.txt').match(/(\d+)\s+types\b/);

    expect(claim).not.toBeNull();
    expect(Number(claim![1])).toBe(types.length);
  });

  it('ships the skill with the frontmatter a skill loader needs', () => {
    const skill = read('skills/using-result-kit/SKILL.md');

    expect(skill.startsWith('---\n')).toBe(true);
    expect(skill).toMatch(/^name:\s*using-result-kit$/m);
    expect(skill).toMatch(/^description:\s*\S/m);
  });
});
