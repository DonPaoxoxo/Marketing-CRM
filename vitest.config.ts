import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    // Node by default; the component smoke tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock so the rest of the suite stays fast.
    environment: 'node',
    // One worker per CPU core is the default. On a 16-core machine with little
    // free memory, that many jsdom workers ran it out and the OS killed one
    // (exit 134) — a different file each run, reported only as "23 of 24 files".
    // A fixed ceiling keeps the suite deterministic wherever it runs.
    maxWorkers: 4,
    // The route smoke tests render whole pages over the fixture workspace. Alone
    // they take about a second; on a machine short of memory they occasionally
    // passed the 5-second default — a different page each run, never a real
    // failure. The ceiling is for slow machines, not slow code.
    testTimeout: 20_000,
    // The server lives outside src/, so include it explicitly.
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['./src/test/setup-dom.ts'],
    // The component tests render the app against the mock API, which is opt-in
    // now that a real one exists. Without this they would render the signed-out
    // shell and every assertion would be about the login page.
    env: { VITE_USE_MOCK_API: 'true' },
  },
});
