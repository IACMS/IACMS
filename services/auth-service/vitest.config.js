import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    clearMocks: true,
    include: ['tests/**/*.test.js'],
    // Longer timeout for integration tests that hit real DB/Redis
    testTimeout: 15000,
  },
});
