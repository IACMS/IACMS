import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long-file',
      INTERNAL_SERVICE_TOKEN: 'test-internal-token-for-unit-tests',
    },
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/generated/**', 'src/server.js'],
    },
  },
});
