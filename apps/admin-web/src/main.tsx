import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@ruostack/ui';
import { AuthProvider } from './lib/auth.js';
import { App } from './App.js';
import './index.css';

// Admin was dark-only via a hard-coded class on <html>. It now gets the same
// light/dark support as the brand portal, under its own storage key so the two
// realms do not share a preference.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider storageKey="ruostack_admin_theme">
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
