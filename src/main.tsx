import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

async function boot() {
  // versão estática (demonstração no navegador): a API e a vida do escritório rodam aqui dentro, sem servidor
  if (import.meta.env.VITE_STATIC_DEMO) (await import('./demo/backend')).installStaticBackend();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
