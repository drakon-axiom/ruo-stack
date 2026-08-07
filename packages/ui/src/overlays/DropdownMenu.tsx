import * as RM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function DropdownMenu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <RM.Root>
      <RM.Trigger asChild>{trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-40 rounded-[10px] border border-line bg-surface-2 p-1 shadow-e2"
        >
          {items.map((it) => (
            <RM.Item
              key={it.label}
              onSelect={it.onSelect}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-3',
                it.danger ? 'text-danger' : 'text-content-muted data-[highlighted]:text-content',
              )}
            >
              {it.label}
            </RM.Item>
          ))}
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}
