import { defineConfig } from 'vitest/config';
import { nestPlugin } from '../../tests/setup/nest-plugin.mjs';

export default defineConfig({
  plugins: [nestPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
  },
});
