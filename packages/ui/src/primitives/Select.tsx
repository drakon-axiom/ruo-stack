import * as RS from '@radix-ui/react-select';
import { cn } from '../lib/cn.js';
import { Check, ChevronDown } from '../icons.js';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  id,
  className,
  disabled,
}: {
  options: SelectOption[];
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <RS.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger
        id={id}
        className={cn(
          'inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px]',
          'border border-line bg-field px-3 text-base text-content md:min-h-0 md:py-2 md:text-sm',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <RS.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="h-4 w-4 text-content-faint" />
      </RS.Trigger>

      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={4}
          className="z-50 overflow-hidden rounded-[10px] border border-line bg-surface-2 shadow-e2"
        >
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-content-muted outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-content"
              >
                <RS.ItemText>{o.label}</RS.ItemText>
                <RS.ItemIndicator>
                  <Check aria-hidden className="h-4 w-4 text-accent" />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
