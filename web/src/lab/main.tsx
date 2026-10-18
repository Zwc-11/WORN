import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LabApp } from './LabApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabApp />
  </StrictMode>,
);
