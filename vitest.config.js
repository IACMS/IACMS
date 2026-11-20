import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/tests/**/*.test.js'],
  },
});
