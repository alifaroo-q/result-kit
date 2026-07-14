import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'fp-ts/index': 'src/fp-ts/index.ts',
    'nest/index': 'src/nest/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  treeshake: true,
  exports: true,
  publint: true,
  attw: {
    profile: 'node16',
    level: 'error',
  },
  deps: {
    neverBundle: ['@nestjs/common'],
  },
});
