import { AppShell } from '@/components/app-shell/AppShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
