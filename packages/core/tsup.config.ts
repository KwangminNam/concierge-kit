import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/node/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
});
