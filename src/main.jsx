import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LiliGame from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LiliGame />
  </StrictMode>
);
