import * as RC from '@radix-ui/react-checkbox';
import { Check } from '../icons.js';

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-content">
      <RC.Root
        id={id}
        checked={checked}
        // Radix models the indeterminate state as 'indeterminate'; collapse it
        // to false so consumers only ever deal with a boolean.
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border border-line bg-surface-1 data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid"
      >
        <RC.Indicator>
          <Check aria-hidden className="h-3.5 w-3.5 text-white" />
        </RC.Indicator>
      </RC.Root>
      {label}
    </label>
  );
}
