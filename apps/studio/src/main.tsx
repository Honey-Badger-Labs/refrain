import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Studio } from './Studio.js';

const container = document.getElementById('root');
if (!container) throw new Error('no #root');
createRoot(container).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
