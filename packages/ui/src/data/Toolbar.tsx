import type { ReactNode } from 'react';

/** Filter/search row above a table. Wraps on narrow viewports. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}
