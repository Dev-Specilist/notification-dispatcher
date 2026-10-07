import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      swcrc: false,
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          useDefineForClassFields: false,
        },
        keepClassNames: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.int-spec.ts',
        'src/**/*.contract.ts',
        'src/**/testing/**',
        'src/main.ts',
        'src/worker.ts',
      ],
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int-spec.ts'],
          globalSetup: ['./src/shared/database/testing/postgres.global-setup.ts'],
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          env: { SHUTDOWN_DRAIN_MS: '200' },
        },
      },
    ],
  },
});
