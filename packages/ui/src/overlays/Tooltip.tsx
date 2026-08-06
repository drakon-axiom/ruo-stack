import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/** Mount once near the app root. AppShell already does this. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={200}>{children}</RT.Provider>;
}

/** Used by the collapsed icon rail, where the label is otherwise unavailable. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-content shadow-e2"
        >
          {label}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
