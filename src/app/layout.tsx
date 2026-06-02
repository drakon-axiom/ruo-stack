import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ruo-stack — White-label supplement fulfillment',
  description:
    'Sell supplements under your own brand. We handle inventory, labeling, packaging, and shipping.',
};

// Runs before hydration to apply the saved/system theme and avoid a flash of
// the wrong color scheme. Kept tiny and inlined in <head>.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
