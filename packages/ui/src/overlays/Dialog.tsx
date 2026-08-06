import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from '../icons.js';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface-2 shadow-e3">
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <RD.Title className="text-lg font-semibold text-content">{title}</RD.Title>
              {description && (
                <RD.Description className="mt-1 text-sm text-content-muted">{description}</RD.Description>
              )}
            </div>
            <RD.Close
              aria-label="Close"
              className="rounded-md p-1 text-content-faint transition-colors duration-fast hover:text-content"
            >
              <X aria-hidden className="h-4 w-4" />
            </RD.Close>
          </div>

          <div className="px-5 py-4">{children}</div>

          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
