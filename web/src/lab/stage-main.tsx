import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StageDemo } from './StageDemo';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StageDemo />
  </StrictMode>,
);
