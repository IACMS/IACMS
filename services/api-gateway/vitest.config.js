import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    // Force all graphql imports to resolve to the single workspace-root
    // instance. This prevents the "@graphql-tools/utils" local node_modules
    // copy of graphql from conflicting with the one in tests.
    dedupe: ['graphql'],
    alias: {
      graphql: resolve('../../node_modules/graphql'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

