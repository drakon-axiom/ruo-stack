import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from '../icons.js';

/** Right side-sheet on desktop, bottom sheet below md.
 *
 *  Radix supplies the focus trap, Escape handling, scroll lock, and focus
 *  restoration — all of which the previous hand-rolled drawer lacked. */
export function Drawer({
  open,
  onOpenChange,
  title,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RD.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-line bg-surface-2 shadow-e3
                     md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-l"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <RD.Title className="text-lg font-semibold text-content">{title}</RD.Title>
            <RD.Close
              aria-label="Close"
              className="rounded-md p-1 text-content-faint transition-colors duration-fast hover:text-content"
            >
              <X aria-hidden className="h-4 w-4" />
            </RD.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
