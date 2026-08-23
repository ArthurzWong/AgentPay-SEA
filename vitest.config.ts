import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.{ts,tsx}', 'api/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,ts}'],
      exclude: ['tests/**', 'src/**']
    }
  }
});
