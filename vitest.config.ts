import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    // APP_ENV=test is set here so env.ts validation passes and mocks are allowed
    env: {
      APP_ENV: 'test',
    },
    setupFiles: ['./tests/setup.ts'],
    // 60 s is generous for local Docker Postgres; remove the 180 s Neon workaround
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/server/**', 'src/lib/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
