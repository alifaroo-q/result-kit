import { describe, expect, it } from 'vitest';

import { allImports } from './bundle';

/**
 * Tests for the §7.3 guards' **detector**, as distinct from the guards.
 *
 * §7.3's closing note is that "a guard is code, and untested code does not
 * work", and this function is the proof: it reported `dist/testing/index.js`
 * importing `vitest` — the exact opposite of the truth — because a JSDoc
 * example in the source shows that import and tsdown carries the comment into
 * the emitted chunk. Every boundary assertion downstream is only as honest as
 * this function, and the boundary specs' positive controls prove it can see
 * *something*, not that it sees the right things.
 */

describe('allImports — what it must find', () => {
  it('findsABareSpecifierOnAnImportStatement', () => {
    expect(allImports(`import { expect } from 'vitest';`)).toEqual(['vitest']);
  });

  it('findsARelativeSpecifier', () => {
    expect(allImports(`import { isOk } from "../result-abc.js";`)).toEqual([
      '../result-abc.js',
    ]);
  });

  it('findsASideEffectOnlyImport', () => {
    // No `from`, so a `from`-anchored scanner would miss it — and a
    // side-effect import is exactly how an auto-registering module would sneak
    // a dependency into a chunk.
    expect(allImports(`import 'node:assert';`)).toEqual(['node:assert']);
  });

  it('findsASpecifierOnAReExport', () => {
    expect(allImports(`export { ok } from './result.js';`)).toEqual([
      './result.js',
    ]);
  });

  it('findsEverySpecifierWhenSeveralArePresent', () => {
    const code = [
      `import { a } from 'alpha';`,
      `import { b } from './beta.js';`,
      `export { c } from 'gamma';`,
    ].join('\n');

    expect(allImports(code)).toEqual(['alpha', './beta.js', 'gamma']);
  });

  it('findsASpecifierRegardlessOfQuoteStyle', () => {
    expect(allImports(`import a from "x";\nimport b from 'y';`)).toEqual([
      'x',
      'y',
    ]);
  });

  it('findsNothingInAModuleThatImportsNothing', () => {
    expect(allImports(`export const resultMatchers = {};`)).toEqual([]);
  });
});

describe('allImports — what it must not mistake for an import', () => {
  it('ignoresAnImportInsideABlockComment', () => {
    // The live regression: `src/testing/index.ts` documents its own setup in a
    // fenced example, and tsdown emits that comment into the chunk.
    const code = [
      `/**`,
      ` * \`\`\`ts`,
      ` * import { expect } from 'vitest';`,
      ` * import { resultMatchers } from '@zireal/result-kit/testing';`,
      ` * \`\`\``,
      ` */`,
      `export const resultMatchers = {};`,
    ].join('\n');

    expect(allImports(code)).toEqual([]);
  });

  it('ignoresAnImportInsideALineComment', () => {
    expect(allImports(`// import { expect } from 'vitest';`)).toEqual([]);
  });

  it('ignoresAnImportInsideAnIndentedLineComment', () => {
    expect(allImports(`    // import { expect } from 'vitest';`)).toEqual([]);
  });

  it('findsARealImportOnTheLineAfterACommentedOne', () => {
    // Stripping must remove the comment, not swallow what follows it.
    const code = [`// import { x } from 'ghost';`, `import { y } from 'real';`]
      .join('\n');

    expect(allImports(code)).toEqual(['real']);
  });

  it('findsARealImportAfterABlockCommentOnTheSameLine', () => {
    expect(allImports(`/* import 'ghost'; */ import 'real';`)).toEqual([
      'real',
    ]);
  });

  it('keepsAnImportOnALineHoldingAProtocolRelativeUrl', () => {
    // A trailing `//` is deliberately *not* treated as a comment start, so a
    // `https://` in a string cannot eat a real import sharing its line.
    const code = `const doc = "https://example.com"; import 'real';`;

    expect(allImports(code)).toEqual(['real']);
  });
});
