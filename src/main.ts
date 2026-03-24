import './style.css';
import { App } from './core/App';

function mount(): void {
  const root = document.getElementById('app') as HTMLDivElement | null;
  if (!root) {
    throw new Error('Candy Lands could not find the app root.');
  }
  const app = new App(root);
  void app.init();
}

/** Vite may evaluate the entry during dep optimization in Node (no `document`); real load runs in the browser. */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
