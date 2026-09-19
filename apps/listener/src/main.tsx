import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.js';
import { registerServiceWorker } from './lib/sw-register.js';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('no #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
