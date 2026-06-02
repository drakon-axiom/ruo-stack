import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ruo-stack — White-label supplement fulfillment',
  description:
    'Sell supplements under your own brand. We handle inventory, labeling, packaging, and shipping.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
