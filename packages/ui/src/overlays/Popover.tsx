import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          align="end"
          sideOffset={6}
          className="z-50 rounded-[10px] border border-line bg-surface-2 p-3 shadow-e2"
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
