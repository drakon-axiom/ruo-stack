import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@ruostack/ui';
import { AuthProvider } from './lib/auth.js';
import { OnboardingProvider } from './lib/onboarding.js';
import { App } from './App.js';
import './index.css';

// ThemeProvider owns the html.dark class now. It keeps the existing
// `ruostack_theme` key, so a user who already chose light or dark keeps that
// choice; only users with nothing stored fall through to the OS preference.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider storageKey="ruostack_theme">
      <BrowserRouter>
        <AuthProvider>
          <OnboardingProvider>
            <App />
          </OnboardingProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
