import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts'], tsconfig: './tsconfig.json' },
  },
});
