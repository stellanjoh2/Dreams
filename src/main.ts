import './style.css';
import { App } from './core/App';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Candy Lands could not find the app root.');
}

const app = new App(root);
void app.init();
