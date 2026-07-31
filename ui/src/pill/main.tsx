import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { PillHarnessApp } from './PillHarnessApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PillHarnessApp />
  </StrictMode>
);
