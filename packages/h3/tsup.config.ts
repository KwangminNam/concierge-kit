import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ['h3'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
});
