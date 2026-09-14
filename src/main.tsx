import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// The mock API is an opt-in build-time switch. When it is on, wait for the worker
// so the first render never races an unhandled request; otherwise — the normal
// case — the app talks to the real /api on the serving origin.
//
// The condition is written inline rather than imported from config.ts so Vite can
// replace `import.meta.env.VITE_USE_MOCK_API` with a literal here and drop the
// dynamic import entirely — behind a cross-module constant the bundler still emits
// the whole MSW chunk. `lib/config.ts` mirrors this expression for the UI to read.
if (import.meta.env.VITE_USE_MOCK_API === 'true') {
  import('./mocks/browser').then(({ startMockApi }) => startMockApi().finally(mount));
} else {
  mount();
}
