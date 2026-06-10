import { AppShell } from '@/components/app-shell/AppShell';

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
